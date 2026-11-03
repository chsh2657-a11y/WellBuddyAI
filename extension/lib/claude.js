// Thin wrapper around the official Anthropic SDK (bundled in vendor/).
// - Streams every request (long outputs + server tools).
// - Resumes server-tool turns that stop with `pause_turn`.
// - Opts into server-side refusal fallbacks on models that support them.
// - Prompt-caches the static system prompt and the growing conversation.

import Anthropic from '../vendor/anthropic-sdk.mjs';

export { Anthropic };

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (기본·최고 품질)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름·저렴)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 저렴)' },
];

// Models that accept `fallbacks: "default"` on the Claude API.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Dynamic-filtering web tools (_20260209) run on Opus 4.6+/Sonnet 4.6+;
// other models (e.g. Haiku) use the basic variants.
const DYNAMIC_WEB_TOOL_MODELS = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6))/;

/** Server-side web search + web fetch tools for the given model. */
export function webTools(model) {
  const dynamic = DYNAMIC_WEB_TOOL_MODELS.test(model);
  return [
    { type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 8 },
    { type: dynamic ? 'web_fetch_20260209' : 'web_fetch_20250910', name: 'web_fetch', max_uses: 8 },
  ];
}

// Set once the API rejects the fallback opt-in, so later calls skip it.
let fallbackRejected = false;

export class RefusalError extends Error {
  constructor(details) {
    super('요청이 안전 정책에 따라 처리되지 않았습니다. 자료나 요청 표현을 바꿔 다시 시도해 주세요.');
    this.name = 'RefusalError';
    this.details = details;
  }
}

export class TruncatedError extends Error {
  constructor() {
    super('응답이 최대 길이에서 끊겼습니다. 분량을 줄여 다시 시도해 주세요.');
    this.name = 'TruncatedError';
  }
}

export function createClient(apiKey) {
  return new Anthropic({
    apiKey,
    // The key is the user's own and is stored only in this browser profile.
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    timeout: 15 * 60 * 1000,
  });
}

const BILLING_URL = 'https://console.anthropic.com/settings/billing';
const KEYS_URL = 'https://console.anthropic.com/settings/keys';

/** True when the API refused the request because the account has no API credits left. */
export function isCreditError(err) {
  if (!(err instanceof Anthropic.APIError)) return false;
  const msg = String(err.error?.error?.message ?? err.message ?? '');
  return /credit balance/i.test(msg);
}

/** Links that help the user fix an error (shown as buttons next to the message). */
export function errorActions(err) {
  if (isCreditError(err)) return [{ label: '크레딧 충전 페이지 열기', url: BILLING_URL }];
  if (err instanceof Anthropic.AuthenticationError) return [{ label: 'API 키 페이지 열기', url: KEYS_URL }];
  return [];
}

/** Human-readable Korean message for an error thrown by runTurn. */
export function describeError(err) {
  if (err instanceof RefusalError || err instanceof TruncatedError) return err.message;
  if (err instanceof Anthropic.APIUserAbortError) return '작업을 중지했습니다.';
  if (isCreditError(err)) {
    return 'Anthropic API 크레딧이 부족합니다. API는 Claude 구독(Pro·Max)과 별도로 선불 크레딧으로 결제됩니다. Anthropic 콘솔의 Billing에서 크레딧을 충전한 뒤 다시 시도해 주세요. 충전이 반영되기까지 몇 분 걸릴 수 있습니다.';
  }
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요.';
  if (err instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 해당 모델이나 기능(웹 검색 등)을 사용할 권한이 없습니다. Anthropic 콘솔에서 웹 검색 사용 설정과 권한을 확인해 주세요.';
  if (err instanceof Anthropic.NotFoundError) return '선택한 모델을 찾을 수 없습니다. 설정에서 다른 모델을 선택해 주세요.';
  if (err instanceof Anthropic.RateLimitError) return '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
  if (err instanceof Anthropic.BadRequestError) return `요청 형식 오류: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return 'Anthropic 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.';
  if (err instanceof Anthropic.APIConnectionError) return '네트워크 연결에 실패했습니다. 인터넷 연결을 확인해 주세요.';
  if (err instanceof Anthropic.APIError) return `API 오류 (${err.status ?? '알 수 없음'}): ${err.message}`;
  return err?.message || String(err);
}

function statusForBlock(block) {
  if (block.type === 'server_tool_use') {
    if (block.name === 'web_search') return `검색: ${block.input?.query ?? ''}`;
    if (block.name === 'web_fetch') return `원문 읽기: ${block.input?.url ?? ''}`;
    return `도구 사용: ${block.name}`;
  }
  if (block.type === 'web_fetch_tool_result' && block.content?.type === 'web_fetch_tool_error') {
    return `원문을 읽지 못했습니다 (${block.content.error_code})`;
  }
  if (block.type === 'web_search_tool_result' && !Array.isArray(block.content)) {
    return `검색 실패 (${block.content?.error_code ?? '알 수 없음'})`;
  }
  return null;
}

function openStream(client, params, useFallback, signal) {
  if (useFallback) {
    return client.beta.messages.stream(
      { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' },
      { signal },
    );
  }
  return client.messages.stream(params, { signal });
}

/**
 * Runs one assistant turn (resuming `pause_turn` as needed).
 *
 * @returns {Promise<{text: string, assistantMessages: object[], usage: object|null, model: string}>}
 *   assistantMessages must be appended to the conversation unchanged.
 */
export async function runTurn({
  client,
  model,
  effort = 'high',
  system,
  messages,
  tools,
  outputFormat,
  maxTokens = 64000,
  onText,
  onStatus,
  signal,
}) {
  const assistantMessages = [];
  let text = '';
  let working = [...messages];
  let useFallback = FALLBACK_MODELS.has(model) && !fallbackRejected;
  let lastUsage = null;

  for (let round = 0; round < 8; round++) {
    const params = {
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: working,
      thinking: { type: 'adaptive' },
      output_config: outputFormat ? { effort, format: outputFormat } : { effort },
      cache_control: { type: 'ephemeral' },
    };
    if (tools?.length) params.tools = tools;

    let message;
    try {
      const stream = openStream(client, params, useFallback, signal);
      stream.on('text', (delta) => {
        text += delta;
        onText?.(delta, text);
      });
      stream.on('contentBlock', (block) => {
        const status = statusForBlock(block);
        if (status) onStatus?.(status);
      });
      message = await stream.finalMessage();
    } catch (err) {
      // If the fallback opt-in itself is rejected (e.g. the account or model
      // does not accept it), retry once without it before surfacing the error.
      if (useFallback && err instanceof Anthropic.BadRequestError && !isCreditError(err) && round === 0 && !text) {
        useFallback = false;
        fallbackRejected = true;
        round -= 1;
        continue;
      }
      throw err;
    }

    lastUsage = message.usage ?? lastUsage;
    assistantMessages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'pause_turn') {
      // Server-side tool loop hit its iteration cap: send the partial turn
      // back unchanged and the server resumes where it stopped.
      working = [...working, { role: 'assistant', content: message.content }];
      onStatus?.('자료 확인을 이어서 진행합니다');
      continue;
    }
    if (message.stop_reason === 'refusal') {
      throw new RefusalError(message.stop_details ?? null);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new TruncatedError();
    }
    return { text, assistantMessages, usage: lastUsage, model: message.model };
  }
  throw new Error('자료 확인이 너무 길어져 중단했습니다. 다시 시도해 주세요.');
}

/** Single structured-output request (no tools, no history). Returns parsed JSON. */
export async function runJson({ client, model, effort = 'medium', system, content, schema, onStatus, signal }) {
  const { text } = await runTurn({
    client,
    model,
    effort,
    system,
    messages: [{ role: 'user', content }],
    outputFormat: { type: 'json_schema', schema },
    maxTokens: 32000,
    onStatus,
    signal,
  });
  return JSON.parse(text);
}
