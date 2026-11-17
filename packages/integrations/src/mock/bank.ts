import type { BankAccountRef, BankProvider, DateRange } from '../providers.js';
import type { BankTransactionRecord } from '../records.js';
import { CUSTOMERS, LANDLORD, SUPPLIERS } from './catalog.js';
import { businessTimes, compactDate, eachDay, isWeekend, seededRandom } from './random.js';

/** 잔액을 이어 계산하기 시작하는 날(이보다 앞선 기간을 달라고 하면 그 날부터) */
const ANCHOR = '2024-01-01';
/** 잔액이 이 밑으로 내려가는 출금은 만들지 않는다 */
const MIN_BALANCE = 1_000_000;

type Event = Omit<BankTransactionRecord, 'date' | 'time' | 'balance' | 'externalId'>;

/** 공급가액(10원 단위) + 부가세 10% — 정수로만 계산한다 */
const vatIncluded = (supply: number) => (supply / 10) * 11;

const out = (description: string, counterparty: string | null, amount: number): Event => ({
  description,
  counterparty,
  deposit: 0,
  withdrawal: amount,
});
const into = (description: string, counterparty: string | null, amount: number): Event => ({
  description,
  counterparty,
  deposit: amount,
  withdrawal: 0,
});

/** 계좌·날짜마다 정해지는 하루치 거래(정기 이체 + 평일 매출 입금·매입 송금) */
function dayEvents(accountId: string, date: string): Event[] {
  const rng = seededRandom('bank', accountId, date);
  const day = Number(date.slice(8, 10));
  const events: Event[] = [];
  if (day === 5) events.push(out('임대료', LANDLORD.name, 2_200_000));
  if (day === 10) {
    events.push(out('국민연금', '국민연금공단', rng.amount(700_000, 1_100_000, 10)));
    events.push(out('건강보험', '국민건강보험공단', rng.amount(600_000, 950_000, 10)));
    events.push(out('고용보험', '근로복지공단', rng.amount(100_000, 200_000, 10)));
  }
  if (day === 15) events.push(out('전기요금', '한국전력공사', rng.amount(150_000, 450_000, 10)));
  if (day === 20) events.push(out('카드대금', '신한카드', rng.amount(1_500_000, 4_000_000, 1)));
  if (day === 21) events.push(into('예금이자', null, rng.amount(5_000, 40_000, 1)));
  if (day === 25) {
    events.push(out('급여', '급여 일괄이체', rng.amount(12_000_000, 16_000_000, 1_000)));
  }
  if (!isWeekend(date)) {
    if (rng.chance(0.6)) {
      const c = rng.pick(CUSTOMERS);
      events.push(into('타행입금', c.name, vatIncluded(rng.amount(300_000, 5_000_000, 10_000))));
    }
    if (rng.chance(0.4)) {
      const s = rng.pick(SUPPLIERS);
      events.push(out('타행이체', s.name, vatIncluded(rng.amount(200_000, 3_000_000, 10_000))));
    }
  }
  const times = businessTimes(rng, events.length);
  return events.map((e, i) => ({ ...e, time: times[i] }));
}

/**
 * 모의 은행: 계좌마다 정해진 거래를 만든다. 잔액은 기준일부터 이어 계산하므로
 * 어느 기간을 달라고 해도 같은 날의 거래·잔액이 같다. 거래 고유번호(externalId)는 날짜 + 순번이다.
 */
export class MockBankProvider implements BankProvider {
  async testConnection() {
    return { ok: true, message: '모의 은행이 준비되었습니다.' };
  }

  async fetchTransactions(
    account: BankAccountRef,
    range: DateRange,
  ): Promise<BankTransactionRecord[]> {
    const start = range.from < ANCHOR ? range.from : ANCHOR;
    let balance = seededRandom('bank-opening', account.id).amount(60_000_000, 120_000_000, 1_000);
    const records: BankTransactionRecord[] = [];
    for (const date of eachDay(start, range.to)) {
      dayEvents(account.id, date).forEach((e, i) => {
        if (e.withdrawal > 0 && balance - e.withdrawal < MIN_BALANCE) return;
        balance += e.deposit - e.withdrawal;
        if (date >= range.from) {
          records.push({ ...e, date, balance, externalId: `${compactDate(date)}-${i}` });
        }
      });
    }
    return records;
  }
}
