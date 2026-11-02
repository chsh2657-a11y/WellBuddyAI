// AI thumbnail: an AI-generated background illustration (no text) with the
// Korean headline typeset on top, so the copy is always spelled exactly.

import { runTurn } from './claude.js';
import { thumbnailSvgMessage, imageModelPrompt } from './prompts.js';
import { extractSvg } from './parse.js';
import {
  ensureFonts, fitText, font, roundRect, luminance, hexToRgb, loadImage, drawCover,
} from './canvas.js';

export const THUMB_W = 1280;
export const THUMB_H = 720;

export const PROVIDER_LABEL = {
  'claude-svg': 'Claude 일러스트',
  openai: 'OpenAI 이미지 모델',
  gemini: 'Google Gemini 이미지 모델',
};

/** Removes anything executable or external from model-written SVG. */
export function sanitizeSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('일러스트 SVG를 해석하지 못했습니다');
  }
  doc.querySelectorAll('script, foreignObject, iframe, image, use[href^="http"], a, text, tspan').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) el.removeAttribute(attr.name);
      else if (/url\(\s*['"]?(?!#)/i.test(value)) el.removeAttribute(attr.name);
    }
  });
  doc.querySelectorAll('style').forEach((st) => {
    st.textContent = st.textContent.replace(/@import[^;]+;?/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');
  });
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(THUMB_W));
  svg.setAttribute('height', String(THUMB_H));
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${THUMB_W} ${THUMB_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  return new XMLSerializer().serializeToString(svg);
}

async function backgroundFromClaude({ client, settings, system, spec, signal, onStatus }) {
  onStatus?.('썸네일 일러스트를 그리는 중입니다 (Claude)');
  const { text } = await runTurn({
    client,
    model: settings.model,
    effort: 'medium',
    system,
    messages: [{ role: 'user', content: thumbnailSvgMessage({ spec }) }],
    maxTokens: 32000,
    signal,
  });
  const raw = extractSvg(text);
  if (!raw) throw new Error('일러스트 SVG가 응답에 없습니다');
  const svg = sanitizeSvg(raw);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function backgroundFromOpenAI({ settings, spec, signal, onStatus }) {
  if (!settings.openaiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다');
  onStatus?.(`썸네일 그림을 생성하는 중입니다 (${settings.openaiModel})`);
  const model = settings.openaiModel || 'gpt-image-1';
  const body = { model, prompt: imageModelPrompt(spec), n: 1 };
  if (model.startsWith('dall-e')) Object.assign(body, { size: '1792x1024', response_format: 'b64_json' });
  else Object.assign(body, { size: '1536x1024' });
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.openaiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI 이미지 생성 실패 (${res.status}): ${json?.error?.message || ''}`);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI 응답에 이미지가 없습니다');
  return loadImage(`data:image/png;base64,${b64}`);
}

async function backgroundFromGemini({ settings, spec, signal, onStatus }) {
  if (!settings.geminiKey) throw new Error('Gemini API 키가 설정되지 않았습니다');
  const model = settings.geminiModel || 'gemini-2.5-flash-image';
  onStatus?.(`썸네일 그림을 생성하는 중입니다 (${model})`);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imageModelPrompt(spec) }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
    }),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini 이미지 생성 실패 (${res.status}): ${json?.error?.message || ''}`);
  const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const data = part?.inlineData || part?.inline_data;
  if (!data?.data) throw new Error('Gemini 응답에 이미지가 없습니다');
  return loadImage(`data:${data.mimeType || data.mime_type || 'image/png'};base64,${data.data}`);
}

/** Composites the background and the Korean copy into a 1280×720 JPEG data URL. */
export async function composeThumbnail(bgImage, spec) {
  await ensureFonts();
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, THUMB_W, THUMB_H);
  base.addColorStop(0, '#0B1630');
  base.addColorStop(1, '#13284F');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  if (bgImage) drawCover(ctx, bgImage, 0, 0, THUMB_W, THUMB_H);

  // Readability scrim behind the copy.
  const scrim = ctx.createLinearGradient(0, 0, THUMB_W * 0.82, 0);
  scrim.addColorStop(0, 'rgba(7, 14, 30, 0.90)');
  scrim.addColorStop(0.55, 'rgba(7, 14, 30, 0.70)');
  scrim.addColorStop(1, 'rgba(7, 14, 30, 0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);

  const accent = spec.accent || '#22C3A6';
  const x = 84;
  const maxWidth = 660;

  const l1 = fitText(ctx, spec.line1, { weight: 800, maxSize: 104, minSize: 60, maxWidth, maxLines: 2 });
  const l1Height = l1.lines.length * l1.size * 1.18;
  let l2 = null;
  let l2Height = 0;
  if (spec.line2) {
    l2 = fitText(ctx, spec.line2, { weight: 700, maxSize: 50, minSize: 32, maxWidth: maxWidth - 56, maxLines: 1 });
    l2Height = l2.size * 1.9;
  }
  const barH = 12;
  const gap = 34;
  const total = barH + gap + l1Height + (l2 ? gap + l2Height : 0);
  let y = (THUMB_H - total) / 2;

  ctx.fillStyle = accent;
  roundRect(ctx, x, y, 92, barH, 6);
  ctx.fill();
  y += barH + gap;

  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  ctx.font = font(800, l1.size);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18;
  for (const line of l1.lines) {
    ctx.fillText(line, x, y + l1.size * 0.04);
    y += l1.size * 1.18;
  }
  ctx.shadowBlur = 0;

  if (l2) {
    y += gap;
    ctx.font = font(700, l2.size);
    const textW = Math.max(...l2.lines.map((ln) => ctx.measureText(ln).width));
    const padX = 28;
    const pillH = l2.size * 1.9;
    const { r, g, b } = hexToRgb(accent);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    roundRect(ctx, x, y, textW + padX * 2, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = luminance(accent) > 0.45 ? '#0B1220' : '#FFFFFF';
    ctx.fillText(l2.lines[0], x + padX, y + (pillH - l2.size) / 2 + l2.size * 0.02);
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Generates the thumbnail. Returns {dataUrl, provider, note}.
 * If the chosen image provider fails, falls back to the Claude illustration
 * and reports that in `note` (shown outside the post).
 */
export async function generateThumbnail({ client, settings, system, spec, signal, onStatus }) {
  const order = [settings.imageProvider || 'claude-svg'];
  if (order[0] !== 'claude-svg') order.push('claude-svg');
  const errors = [];
  for (const provider of order) {
    try {
      const fn = provider === 'openai' ? backgroundFromOpenAI : provider === 'gemini' ? backgroundFromGemini : backgroundFromClaude;
      const bg = await fn({ client, settings, system, spec, signal, onStatus });
      onStatus?.('썸네일에 한글 문구를 얹는 중입니다');
      const dataUrl = await composeThumbnail(bg, spec);
      const note = errors.length
        ? `${PROVIDER_LABEL[order[0]]} 생성에 실패해 ${PROVIDER_LABEL[provider]}로 썸네일을 만들었습니다. (${errors.join(' / ')})`
        : '';
      return { dataUrl, provider, note };
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      errors.push(err?.message || String(err));
    }
  }
  throw new Error(`썸네일을 만들지 못했습니다: ${errors.join(' / ')}`);
}
