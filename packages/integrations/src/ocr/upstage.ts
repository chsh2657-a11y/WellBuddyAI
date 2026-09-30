import type { OcrProvider } from '../providers.js';
import type { ReceiptFields } from '../records.js';
import { ProviderError } from '../registry.js';
import { errorMessage, type HttpOptions, requestJson, TINY_PNG } from './http.js';
import { estimateConfidence, receiptFields } from './normalize.js';

export const UPSTAGE_URL = 'https://api.upstage.ai/v1/information-extraction/chat/completions';

const field = (description: string) => ({ type: 'string', description });

/** 뽑을 값(Upstage 정보 추출은 스키마의 설명을 보고 값을 찾는다) */
const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    date: field('거래일(승인일)'),
    merchant_name: field('판매자(가맹점) 상호'),
    business_number: field('판매자 사업자등록번호'),
    total_amount: field('부가세를 포함한 합계(결제 금액)'),
    vat_amount: field('부가세'),
    items: {
      type: 'array',
      description: '품목',
      items: {
        type: 'object',
        properties: { name: field('품목 이름'), amount: field('품목 금액') },
      },
    },
  },
};

export interface UpstageOptions extends HttpOptions {
  apiKey: string;
}

/** Upstage 정보 추출(Information Extract)로 영수증을 읽는다(P2-17) */
export class UpstageOcrProvider implements OcrProvider {
  constructor(private readonly options: UpstageOptions) {
    if (!options.apiKey) throw new ProviderError('PROVIDER_FAILED', 'Upstage API Key 가 없습니다.');
  }

  private call(data: Buffer, mimeType: string) {
    return requestJson(
      'Upstage',
      UPSTAGE_URL,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body: {
          model: 'information-extract',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${data.toString('base64')}` },
                },
              ],
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'receipt', schema: RECEIPT_SCHEMA },
          },
        },
      },
      this.options,
    );
  }

  /** 작은 이미지로 인증만 확인한다(401·403 이면 키 오류) */
  async testConnection() {
    try {
      const { status, json } = await this.call(TINY_PNG, 'image/png');
      if (status === 401 || status === 403) {
        return { ok: false, message: 'Upstage API Key 가 올바르지 않습니다.' };
      }
      if (status >= 500) {
        return {
          ok: false,
          message: `Upstage 가 응답하지 않습니다(${status}): ${errorMessage(json)}`,
        };
      }
      return { ok: true, message: 'Upstage 에 연결했습니다.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async extractReceipt(file: { data: Buffer; mimeType: string }): Promise<ReceiptFields> {
    const { status, json } = await this.call(file.data, file.mimeType);
    if (status === 401 || status === 403) {
      throw new ProviderError('PROVIDER_FAILED', 'Upstage API Key 가 올바르지 않습니다.');
    }
    if (status >= 400) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `Upstage 요청이 실패했습니다(${status}): ${errorMessage(json)}`,
      );
    }
    const content = (json as { choices?: { message?: { content?: unknown } }[] } | null)
      ?.choices?.[0]?.message?.content;
    let raw: Record<string, unknown>;
    try {
      raw = typeof content === 'string' ? JSON.parse(content) : {};
    } catch {
      throw new ProviderError('PROVIDER_FAILED', 'Upstage 응답을 읽지 못했습니다.');
    }
    const fields = receiptFields({
      date: raw.date,
      merchantName: raw.merchant_name,
      bizNo: raw.business_number,
      totalAmount: raw.total_amount,
      vatAmount: raw.vat_amount,
      items: Array.isArray(raw.items) ? raw.items : [],
    });
    return { ...fields, confidence: estimateConfidence(fields) };
  }
}
