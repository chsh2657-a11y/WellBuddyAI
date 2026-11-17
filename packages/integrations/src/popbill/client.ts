import { createHash, createHmac } from 'node:crypto';
import { ProviderError } from '../registry.js';

export const LINKHUB_AUTH_URL = 'https://auth.linkhub.co.kr';
export const POPBILL_HOSTS = {
  test: 'https://popbill-test.linkhub.co.kr',
  production: 'https://popbill.linkhub.co.kr',
} as const;
export type PopbillEnvironment = keyof typeof POPBILL_HOSTS;
const LINKHUB_API_VERSION = '2.0';

export interface PopbillOptions {
  linkId: string;
  secretKey: string;
  /** 팝빌 연동회원 사업자번호(숫자 10자리) */
  corpNum: string;
  environment?: string;
  /** 팝빌 회원 아이디(선택) */
  userId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 서명 시각(테스트에서 고정) */
  now?: () => Date;
}

/** 팝빌 오류 응답 { code: 음수, message } */
function popbillError(prefix: string, status: number, json: unknown): ProviderError {
  const body = (json ?? {}) as { code?: number | string; message?: string };
  const detail = body.message ? `${body.message} (${body.code ?? status})` : `HTTP ${status}`;
  return new ProviderError('PROVIDER_FAILED', `${prefix}: ${detail}`);
}

/**
 * 팝빌(링크허브) API 호출(P2-13·14). 공식 SDK(popbill·linkhub)와 같은 방식:
 * 1) 링크허브 인증 서버에 HMAC-SHA256 으로 서명한 토큰 요청(LinkID·SecretKey, 대상 사업자번호·권한 범위)
 * 2) 받은 세션 토큰으로 서비스 호출. GET·POST 외 동작은 X-HTTP-Method-Override 로 보낸다.
 */
export class PopbillClient {
  readonly environment: PopbillEnvironment;
  private readonly options: PopbillOptions;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    options: PopbillOptions,
    /** 서비스 권한 범위(세금계산서 110, 홈택스 세금계산서 111, 홈택스 현금영수증 141 …) */
    private readonly scopes: string[],
  ) {
    if (!options.linkId || !options.secretKey) {
      throw new ProviderError('PROVIDER_FAILED', '팝빌 LinkID·SecretKey 가 없습니다.');
    }
    const corpNum = (options.corpNum ?? '').replace(/\D/g, '');
    if (corpNum.length !== 10) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        '팝빌 연동회원 사업자번호(10자리)를 입력해 주세요.',
      );
    }
    this.options = { ...options, corpNum };
    const env = (options.environment || 'test').trim().toLowerCase();
    if (!(env in POPBILL_HOSTS)) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        '팝빌 환경은 test·production 중 하나로 입력해 주세요.',
      );
    }
    this.environment = env as PopbillEnvironment;
  }

  get corpNum() {
    return this.options.corpNum;
  }

  private get serviceId() {
    return this.environment === 'test' ? 'POPBILL_TEST' : 'POPBILL';
  }

  private async send(url: string, init: RequestInit) {
    let res: Response;
    try {
      res = await (this.options.fetch ?? fetch)(url, {
        ...init,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
    } catch (e) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `팝빌에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const json: unknown = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /** 링크허브 서명: POST\n{본문 SHA-256(base64)}\n{시각}\n2.0\n{경로} 를 SecretKey(base64)로 HMAC */
  signature(body: string, xDate: string, uri: string): string {
    const bodyDigest = createHash('sha256').update(body).digest('base64');
    const target = `POST\n${bodyDigest}\n${xDate}\n${LINKHUB_API_VERSION}\n${uri}`;
    return createHmac('sha256', Buffer.from(this.options.secretKey, 'base64'))
      .update(target)
      .digest('base64');
  }

  async sessionToken(refresh = false): Promise<string> {
    if (!refresh && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const uri = `/${this.serviceId}/Token`;
    const body = JSON.stringify({
      access_id: this.options.corpNum,
      scope: ['member', ...this.scopes],
    });
    const xDate = (this.options.now?.() ?? new Date()).toISOString();
    const { status, json } = await this.send(`${LINKHUB_AUTH_URL}${uri}`, {
      method: 'POST',
      headers: {
        'x-lh-date': xDate,
        'x-lh-version': LINKHUB_API_VERSION,
        authorization: `LINKHUB ${this.options.linkId} ${this.signature(body, xDate, uri)}`,
        'content-type': 'application/json',
      },
      body,
    });
    const token = json as { session_token?: string; expiration?: string } | null;
    if (status !== 200 || !token?.session_token) {
      throw popbillError('팝빌 인증에 실패했습니다', status, json);
    }
    const expiration = token.expiration ? Date.parse(token.expiration) : NaN;
    this.token = {
      value: token.session_token,
      // 만료 1분 전까지 쓴다(만료 시각이 없으면 25분)
      expiresAt: Number.isFinite(expiration) ? expiration - 60_000 : Date.now() + 25 * 60_000,
    };
    return token.session_token;
  }

  /** 서비스 호출. GET·POST 외(ISSUE·CANCELISSUE 등)는 POST + X-HTTP-Method-Override */
  async request<T>(method: string, uri: string, body?: unknown): Promise<T> {
    const token = await this.sessionToken();
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json;charset=utf-8',
    };
    if (this.options.userId) headers['x-pb-userid'] = this.options.userId;
    if (method !== 'GET' && method !== 'POST') headers['x-http-method-override'] = method;
    const { status, json } = await this.send(`${POPBILL_HOSTS[this.environment]}${uri}`, {
      method: method === 'GET' ? 'GET' : 'POST',
      headers,
      body: body === undefined ? (method === 'GET' ? undefined : '') : JSON.stringify(body),
    });
    if (status !== 200) throw popbillError('팝빌', status, json);
    return json as T;
  }
}

/** YYYY-MM-DD → YYYYMMDD */
export const popbillDate = (date: string) => date.replaceAll('-', '');

/** YYYYMMDD(또는 YYYYMMDDHHmmss) → YYYY-MM-DD */
export function popbillIsoDate(value: unknown): string | null {
  const s = String(value ?? '').replace(/\D/g, '');
  return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

export function amount(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
