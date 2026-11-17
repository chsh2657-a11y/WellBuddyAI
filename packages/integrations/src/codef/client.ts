import { constants, publicEncrypt } from 'node:crypto';
import { ProviderError } from '../registry.js';

/** CODEF 서버(샌드박스: 고정 샘플, 데모: 개발용 실데이터, 정식: 운영) */
export const CODEF_HOSTS = {
  sandbox: 'https://sandbox.codef.io',
  development: 'https://development.codef.io',
  production: 'https://api.codef.io',
} as const;
export type CodefEnvironment = keyof typeof CODEF_HOSTS;
export const CODEF_OAUTH_URL = 'https://oauth.codef.io/oauth/token';
/** 정상 처리 결과 코드 */
export const CODEF_OK = 'CF-00000';

export interface CodefOptions {
  clientId: string;
  clientSecret: string;
  /** 계정 비밀번호 RSA 암호화용 공개키(CODEF 콘솔에서 발급, PEM 머리글 없이) */
  publicKey?: string;
  environment?: string;
  /** 계정 연결로 발급받은 Connected ID */
  connectedId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface CodefResult<T = unknown> {
  code: string;
  message: string;
  extraMessage: string;
  data: T;
}

export function codefEnvironment(value: string | undefined): CodefEnvironment {
  const env = (value || 'development').trim().toLowerCase();
  if (env in CODEF_HOSTS) return env as CodefEnvironment;
  throw new ProviderError(
    'PROVIDER_FAILED',
    'CODEF 환경은 sandbox·development·production 중 하나로 입력해 주세요.',
  );
}

/** CODEF 응답은 URL 인코딩된 JSON 이다(공백은 +) */
function decodeBody(text: string): unknown {
  let decoded: string;
  try {
    decoded = decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    decoded = text;
  }
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * CODEF API 호출(P2-10~12). 공식 SDK(easycodef-node)와 같은 방식:
 * OAuth 토큰(Client ID·Secret) → 상품 요청(JSON 을 URL 인코딩한 본문) → URL 인코딩 응답을 풀어 결과 코드 확인.
 * 토큰이 만료되면(invalid_token) 한 번 다시 받는다.
 */
export class CodefClient {
  readonly environment: CodefEnvironment;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: CodefOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new ProviderError('PROVIDER_FAILED', 'CODEF Client ID·Secret 이 없습니다.');
    }
    this.environment = codefEnvironment(options.environment);
  }

  get connectedId(): string | null {
    return this.options.connectedId?.trim() || null;
  }

  requireConnectedId(): string {
    const id = this.connectedId;
    if (!id) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        'CODEF 계정이 연결되지 않았습니다. 설정 > 연동관리에서 은행·카드사·홈택스 계정을 연결해 주세요.',
      );
    }
    return id;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await (this.options.fetch ?? fetch)(url, {
        ...init,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      });
    } catch (e) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `CODEF 에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async accessToken(refresh = false): Promise<string> {
    if (!refresh && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString(
      'base64',
    );
    const res = await this.send(CODEF_OAUTH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials&scope=read',
    });
    const json = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (res.status === 401 || res.status === 400) {
      throw new ProviderError('PROVIDER_FAILED', 'CODEF Client ID·Secret 이 올바르지 않습니다.');
    }
    if (!res.ok || !json?.access_token) {
      throw new ProviderError('PROVIDER_FAILED', `CODEF 토큰을 받지 못했습니다(${res.status}).`);
    }
    // 만료 1분 전에 새로 받는다(기본 유효기간 7일)
    const ttl = (json.expires_in ?? 7 * 24 * 3600) * 1000;
    this.token = { value: json.access_token, expiresAt: Date.now() + ttl - 60_000 };
    return json.access_token;
  }

  /** 상품 요청. 결과 코드가 정상이 아니면 공급자 오류 */
  async request<T = unknown>(path: string, params: Record<string, unknown>): Promise<T> {
    const result = await this.requestRaw<T>(path, params);
    if (result.code !== CODEF_OK) {
      const detail = [result.message, result.extraMessage].filter(Boolean).join(' ');
      throw new ProviderError(
        'PROVIDER_FAILED',
        `CODEF: ${detail || '처리하지 못했습니다'} (${result.code})`,
      );
    }
    return result.data;
  }

  async requestRaw<T = unknown>(
    path: string,
    params: Record<string, unknown>,
    retried = false,
  ): Promise<CodefResult<T>> {
    const token = await this.accessToken(retried);
    const res = await this.send(`${CODEF_HOSTS[this.environment]}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: encodeURIComponent(JSON.stringify(params)),
    });
    const body = decodeBody(await res.text()) as {
      error?: string;
      result?: { code?: string; message?: string; extraMessage?: string };
      data?: T;
    } | null;
    if (res.status === 401 && body?.error === 'invalid_token' && !retried) {
      return this.requestRaw(path, params, true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        'CODEF 요청 권한이 없습니다. 상품 사용 신청을 확인해 주세요.',
      );
    }
    if (!res.ok || !body?.result) {
      throw new ProviderError('PROVIDER_FAILED', `CODEF 요청이 실패했습니다(${res.status}).`);
    }
    return {
      code: body.result.code ?? '',
      message: body.result.message ?? '',
      extraMessage: body.result.extraMessage ?? '',
      data: body.data as T,
    };
  }

  /** 계정 비밀번호를 RSA(PKCS#1 v1.5)로 암호화한다 */
  encrypt(plain: string): string {
    const key = this.options.publicKey?.replace(/-----[^-]+-----|\s/g, '');
    if (!key) throw new ProviderError('PROVIDER_FAILED', 'CODEF RSA 공개키가 없습니다.');
    try {
      return publicEncrypt(
        {
          key: `-----BEGIN PUBLIC KEY-----\n${key}\n-----END PUBLIC KEY-----`,
          padding: constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(plain),
      ).toString('base64');
    } catch {
      throw new ProviderError('PROVIDER_FAILED', 'CODEF RSA 공개키 형식이 올바르지 않습니다.');
    }
  }

  /** 연결 테스트: 토큰 발급(Client ID·Secret 확인)과 계정 연결 여부 */
  async test() {
    try {
      await this.accessToken(true);
      return {
        ok: true,
        message: this.connectedId
          ? `CODEF(${this.environment})에 연결했습니다. 계정이 연결되어 있습니다.`
          : `CODEF(${this.environment}) 인증에 성공했습니다. 이제 계정을 연결해 주세요.`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** YYYY-MM-DD → YYYYMMDD */
export const codefDate = (date: string) => date.replaceAll('-', '');

/** YYYYMMDD → YYYY-MM-DD(형식이 아니면 null) */
export function isoDate(value: unknown): string | null {
  const s = String(value ?? '').replace(/\D/g, '');
  return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

/** HHMMSS → HH:MM:SS */
export function isoTime(value: unknown): string | null {
  const s = String(value ?? '').replace(/\D/g, '');
  if (s.length < 4) return null;
  const t = s.padEnd(6, '0');
  return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

/** '1,000' · '-1000' · 1000 → 정수(원). 읽을 수 없으면 0 */
export function won(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** 후보 필드 중 처음으로 값이 있는 것(CODEF 상품마다 이름이 조금씩 다르다) */
export function pick(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = item[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/** data 가 배열이거나 { list } 모양이거나 한 건(객체)일 때 모두 배열로 */
export function listOf(data: unknown, key?: string): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const inner = key ? (data as Record<string, unknown>)[key] : undefined;
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    if (!key) return [data as Record<string, unknown>];
  }
  return [];
}
