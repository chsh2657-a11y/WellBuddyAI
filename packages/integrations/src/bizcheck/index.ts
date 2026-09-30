import type { BizCheckProvider, BizNoStatus } from '../providers.js';
import { ProviderError } from '../registry.js';
import { errorMessage, type HttpOptions, requestJson } from '../ocr/http.js';

/** 번호 형식만 확인(내장): 검증번호가 맞는 번호만 넘어오므로 모두 valid */
export class FormatBizCheckProvider implements BizCheckProvider {
  async testConnection() {
    return { ok: true, message: '내장 기능이라 외부 연결이 필요 없습니다.' };
  }

  async check(bizNos: string[]) {
    return new Map(bizNos.map((b) => [b, 'valid' as BizNoStatus]));
  }
}

export const NTS_STATUS_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/status';
/** 한 번에 조회할 수 있는 번호 수 */
const NTS_BATCH = 100;

export interface NtsOptions extends HttpOptions {
  /** 공공데이터포털 인증키(인코딩·디코딩 어느 쪽이든) */
  serviceKey: string;
}

/** 국세청 사업자등록 상태조회(공공데이터포털): 01 계속, 02 휴업, 03 폐업, 빈 값은 미등록 */
export class NtsBizCheckProvider implements BizCheckProvider {
  constructor(private readonly options: NtsOptions) {
    if (!options.serviceKey) {
      throw new ProviderError('PROVIDER_FAILED', '공공데이터포털 서비스키가 없습니다.');
    }
  }

  private get url() {
    const key = this.options.serviceKey.trim();
    // 인코딩된 키(% 포함)는 그대로, 디코딩된 키는 인코딩해서 붙인다
    return `${NTS_STATUS_URL}?serviceKey=${key.includes('%') ? key : encodeURIComponent(key)}`;
  }

  private async request(bizNos: string[]) {
    const { status, json } = await requestJson(
      '국세청 사업자 상태조회',
      this.url,
      { method: 'POST', headers: { accept: 'application/json' }, body: { b_no: bizNos } },
      this.options,
    );
    const body = json as {
      status_code?: string;
      data?: { b_no?: string; b_stt_cd?: string }[];
    } | null;
    if (status === 401 || status === 403) {
      throw new ProviderError('PROVIDER_FAILED', '공공데이터포털 서비스키가 올바르지 않습니다.');
    }
    if (status >= 400 || body?.status_code !== 'OK') {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `국세청 사업자 상태조회가 실패했습니다(${status}): ${errorMessage(json)}`,
      );
    }
    return body.data ?? [];
  }

  async testConnection() {
    try {
      await this.request(['1248100998']);
      return { ok: true, message: '국세청 사업자 상태조회에 연결했습니다.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async check(bizNos: string[]) {
    const result = new Map<string, BizNoStatus>();
    const unique = [...new Set(bizNos)];
    for (let i = 0; i < unique.length; i += NTS_BATCH) {
      for (const row of await this.request(unique.slice(i, i + NTS_BATCH))) {
        if (!row.b_no) continue;
        const code = row.b_stt_cd;
        result.set(
          row.b_no,
          code === '01'
            ? 'active'
            : code === '02'
              ? 'suspended'
              : code === '03'
                ? 'closed'
                : 'unregistered',
        );
      }
    }
    for (const b of unique) if (!result.has(b)) result.set(b, 'unknown');
    return result;
  }
}
