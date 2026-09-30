import type { CardProvider, CardRef, DateRange } from '../providers.js';
import type { CardApprovalRecord } from '../records.js';
import { MERCHANTS } from './catalog.js';
import { businessTimes, eachDay, isWeekend, seededRandom } from './random.js';

/** 카드·날짜마다 정해지는 하루치 승인. 가끔 같은 날 취소가 뒤따른다 */
function dayApprovals(cardId: string, date: string): CardApprovalRecord[] {
  const rng = seededRandom('card', cardId, date);
  const count = isWeekend(date) ? rng.int(0, 1) : rng.int(0, 3);
  const times = businessTimes(rng, count);
  const records: CardApprovalRecord[] = [];
  for (const time of times) {
    const m = rng.pick(MERCHANTS);
    const amount = rng.amount(m.min, m.max, m.unit);
    const approval: CardApprovalRecord = {
      date,
      time,
      merchantName: m.name,
      merchantBizNo: m.bizNo,
      amount,
      vatAmount: m.exempt ? 0 : Math.round(amount / 11),
      approvalNo: String(rng.int(10_000_000, 99_999_999)),
      installmentMonths: amount >= 300_000 && rng.chance(0.3) ? rng.pick([2, 3, 6]) : null,
      cancelled: false,
      category: m.category,
    };
    records.push(approval);
    if (rng.chance(0.05)) records.push({ ...approval, cancelled: true });
  }
  return records;
}

/** 모의 카드사: 카드마다 정해진 승인·취소 내역을 만든다 */
export class MockCardProvider implements CardProvider {
  async testConnection() {
    return { ok: true, message: '모의 카드사가 준비되었습니다.' };
  }

  async fetchApprovals(card: CardRef, range: DateRange): Promise<CardApprovalRecord[]> {
    return eachDay(range.from, range.to).flatMap((date) => dayApprovals(card.id, date));
  }
}
