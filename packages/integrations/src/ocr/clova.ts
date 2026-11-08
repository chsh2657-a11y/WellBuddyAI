import { randomUUID } from 'node:crypto';
import type { OcrProvider } from '../providers.js';
import type { ReceiptFields } from '../records.js';
import { ProviderError } from '../registry.js';
import { errorMessage, type HttpOptions, requestJson, TINY_PNG } from './http.js';
import { estimateConfidence, receiptFields } from './normalize.js';

const FORMATS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff',
  'application/pdf': 'pdf',
};

export interface ClovaOptions extends HttpOptions {
  /** API Gateway 의 영수증 OCR 호출 주소 */
  invokeUrl: string;
  secretKey: string;
}

/** CLOVA 응답의 한 필드: { text, formatted: { value } } */
interface ClovaField {
  text?: string;
  formatted?: { value?: string; year?: string; month?: string; day?: string };
}

const value = (f: ClovaField | undefined) => f?.formatted?.value || f?.text || null;

function dateOf(f: ClovaField | undefined) {
  const d = f?.formatted;
  if (d?.year && d.month && d.day) {
    return `${d.year}-${d.month.padStart(2, '0')}-${d.day.padStart(2, '0')}`;
  }
  return f?.text ?? null;
}

interface ClovaReceipt {
  storeInfo?: { name?: ClovaField; bizNum?: ClovaField };
  paymentInfo?: { date?: ClovaField };
  totalPrice?: { price?: ClovaField };
  subTotal?: { taxPrice?: ClovaField[] }[];
  subResults?: { items?: { name?: ClovaField; price?: { price?: ClovaField } }[] }[];
}

/** 네이버 CLOVA OCR 영수증 특화 모델로 읽는다(P2-17) */
export class ClovaOcrProvider implements OcrProvider {
  constructor(private readonly options: ClovaOptions) {
    if (!/^https:\/\//.test(options.invokeUrl ?? '')) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        'CLOVA OCR Invoke URL 은 https:// 로 시작해야 합니다.',
      );
    }
    if (!options.secretKey)
      throw new ProviderError('PROVIDER_FAILED', 'CLOVA OCR Secret Key 가 없습니다.');
  }

  private call(data: Buffer, format: string) {
    return requestJson(
      'CLOVA OCR',
      this.options.invokeUrl,
      {
        method: 'POST',
        headers: { 'X-OCR-SECRET': this.options.secretKey },
        body: {
          version: 'V2',
          requestId: randomUUID(),
          timestamp: Date.now(),
          images: [{ format, name: 'receipt', data: data.toString('base64') }],
        },
      },
      this.options,
    );
  }

  private static failure(status: number, json: unknown): string | null {
    if (status === 401 || status === 403) return 'CLOVA OCR Secret Key 가 올바르지 않습니다.';
    if (status === 404) return 'CLOVA OCR Invoke URL 이 올바르지 않습니다.';
    if (status >= 400) return `CLOVA OCR 요청이 실패했습니다(${status}): ${errorMessage(json)}`;
    return null;
  }

  /** 작은 이미지로 주소·키만 확인한다(빈 이미지라 400 이 와도 인증은 통과한 것) */
  async testConnection() {
    try {
      const { status, json } = await this.call(TINY_PNG, 'png');
      if (status === 401 || status === 403 || status === 404 || status >= 500) {
        return { ok: false, message: ClovaOcrProvider.failure(status, json)! };
      }
      return { ok: true, message: 'CLOVA OCR 에 연결했습니다.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async extractReceipt(file: { data: Buffer; mimeType: string }): Promise<ReceiptFields> {
    const format = FORMATS[file.mimeType];
    if (!format) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        'CLOVA OCR 은 JPG·PNG·TIFF 이미지와 PDF 만 읽을 수 있습니다.',
      );
    }
    const { status, json } = await this.call(file.data, format);
    const failed = ClovaOcrProvider.failure(status, json);
    if (failed) throw new ProviderError('PROVIDER_FAILED', failed);
    const image = (
      json as {
        images?: { inferResult?: string; message?: string; receipt?: { result?: ClovaReceipt } }[];
      } | null
    )?.images?.[0];
    if (!image || image.inferResult !== 'SUCCESS') {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `CLOVA OCR 이 영수증을 읽지 못했습니다: ${image?.message ?? '응답 없음'}`,
      );
    }
    const r = image.receipt?.result ?? {};
    const fields = receiptFields({
      date: dateOf(r.paymentInfo?.date),
      merchantName: value(r.storeInfo?.name),
      bizNo: value(r.storeInfo?.bizNum),
      totalAmount: value(r.totalPrice?.price),
      vatAmount: value(r.subTotal?.[0]?.taxPrice?.[0]),
      items: (r.subResults ?? []).flatMap((s) =>
        (s.items ?? []).map((i) => ({ name: value(i.name), amount: value(i.price?.price) })),
      ),
    });
    return { ...fields, confidence: estimateConfidence(fields) };
  }
}
