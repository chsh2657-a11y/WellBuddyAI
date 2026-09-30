import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  askJson,
  type Claude,
  type ClaudeOptions,
  createClaude,
  testClaude,
} from '../ai/anthropic.js';
import type { OcrProvider } from '../providers.js';
import type { ReceiptFields } from '../records.js';
import { ProviderError } from '../registry.js';
import { receiptFields } from './normalize.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
/** Claude 가 받는 이미지 한 장의 최대 크기 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM = [
  '당신은 한국 영수증(카드 매출전표·간이영수증·현금영수증·세금계산서 사본)을 읽는 경리 담당자입니다.',
  '- 이미지에 보이는 값만 적습니다. 보이지 않거나 흐려서 확실하지 않은 값은 null 입니다.',
  '- date 는 거래일(승인일)을 YYYY-MM-DD 로 적습니다.',
  '- merchantName 과 bizNo 는 판매자(가맹점)의 상호와 사업자등록번호입니다. 카드사·구매자의 번호가 아닙니다.',
  '- bizNo 는 숫자 10자리만 적습니다.',
  '- totalAmount 는 부가세를 포함한 합계(결제 금액), vatAmount 는 부가세입니다. 원 단위 정수로 적습니다.',
  '- items 는 품목 이름과 금액입니다. 없으면 빈 배열입니다.',
  '- confidence 는 0~1 사이 값으로, 읽은 값이 맞을 가능성입니다. 영수증이 아니거나 잘 보이지 않으면 낮게 줍니다.',
].join('\n');

const ReceiptSchema = z.object({
  date: z.string().nullable(),
  merchantName: z.string().nullable(),
  bizNo: z.string().nullable(),
  totalAmount: z.number().nullable(),
  vatAmount: z.number().nullable(),
  items: z.array(z.object({ name: z.string(), amount: z.number() })),
  confidence: z.number(),
});

/** Claude Vision 으로 영수증을 읽는다(P2-17). 이미지(JPG·PNG·WEBP·GIF)와 PDF 를 받는다. */
export class ClaudeOcrProvider implements OcrProvider {
  private readonly claude: Claude;

  constructor(options: ClaudeOptions) {
    this.claude = createClaude(options);
  }

  testConnection() {
    return testClaude(this.claude);
  }

  async extractReceipt(file: { data: Buffer; mimeType: string }): Promise<ReceiptFields> {
    const data = file.data.toString('base64');
    let block: Anthropic.Beta.BetaContentBlockParam;
    if (file.mimeType === 'application/pdf') {
      block = {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data },
      };
    } else if ((IMAGE_TYPES as readonly string[]).includes(file.mimeType)) {
      if (file.data.length > MAX_IMAGE_BYTES) {
        throw new ProviderError('PROVIDER_FAILED', '5MB 이하 이미지만 Claude 로 읽을 수 있습니다.');
      }
      block = {
        type: 'image',
        source: { type: 'base64', media_type: file.mimeType as ImageType, data },
      };
    } else {
      throw new ProviderError(
        'PROVIDER_FAILED',
        'Claude 는 JPG·PNG·WEBP·GIF 이미지와 PDF 만 읽을 수 있습니다. 사진을 JPG 로 바꿔 올려 주세요.',
      );
    }
    const raw = await askJson(this.claude, {
      system: SYSTEM,
      effort: 'low',
      schema: ReceiptSchema,
      content: [block, { type: 'text', text: '이 영수증의 값을 읽어 주세요.' }],
    });
    return receiptFields(raw);
  }
}
