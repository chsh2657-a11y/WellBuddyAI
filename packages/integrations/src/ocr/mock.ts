import { createHash } from 'node:crypto';
import { addDays, splitTotal, todayInKorea } from '@wellbuddy/accounting-core';
import { CASH_MERCHANTS, MERCHANTS } from '../mock/catalog.js';
import { seededRandom } from '../mock/random.js';
import type { OcrProvider } from '../providers.js';
import type { ReceiptFields } from '../records.js';
import { normalizeAmount, normalizeDate } from './normalize.js';

/**
 * 모의 OCR(개발·데모). 파일 이름이 `YYYYMMDD_가맹점_금액[_사업자번호]` 이면 그 값을 읽은 것처럼 돌려주고,
 * 아니면 파일 내용으로 정한 샘플(같은 파일이면 같은 가맹점·금액)을 낮은 신뢰도로 돌려준다.
 */
export class MockOcrProvider implements OcrProvider {
  async testConnection() {
    return { ok: true, message: '모의 OCR 이 준비되었습니다.' };
  }

  async extractReceipt(file: { data: Buffer; filename: string }): Promise<ReceiptFields> {
    const base = file.filename.replace(/\.[^.]+$/, '');
    const [date, merchantName, amount, biz] = base.split('_');
    const parsedDate = normalizeDate(date);
    const total = normalizeAmount(amount);
    if (parsedDate && merchantName && total) {
      const known = [...MERCHANTS, ...CASH_MERCHANTS].find((m) => m.name === merchantName);
      const exempt = known && 'exempt' in known && known.exempt;
      return {
        date: parsedDate,
        merchantName,
        bizNo: biz !== undefined ? biz.replace(/\D/g, '') || null : (known?.bizNo ?? null),
        totalAmount: total,
        vatAmount: splitTotal(total, exempt ? 'exempt' : 'taxable').vat,
        confidence: 0.95,
      };
    }

    const rng = seededRandom('ocr', createHash('sha256').update(file.data).digest('hex'));
    const merchant = rng.pick(MERCHANTS);
    const totalAmount = rng.amount(merchant.min, merchant.max, merchant.unit);
    return {
      date: addDays(todayInKorea(), -rng.int(0, 6)),
      merchantName: merchant.name,
      bizNo: merchant.bizNo,
      totalAmount,
      vatAmount: splitTotal(totalAmount, merchant.exempt ? 'exempt' : 'taxable').vat,
      confidence: 0.7,
      items: [{ name: merchant.category, amount: totalAmount }],
    };
  }
}
