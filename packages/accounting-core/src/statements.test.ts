import { describe, expect, it } from 'vitest';
import {
  accountNormalBalance,
  STANDARD_ACCOUNTS,
  type StatementGroup,
} from './chart-of-accounts.js';
import { validateJournal } from './journal.js';
import { type AccountTotals, balanceSheet, incomeStatement, trialBalance } from './statements.js';
import { purchaseLines, receiptLines, salesLines, type TemplateLine } from './templates.js';

/** 템플릿 분개들을 계정별 합계로 모은다(API 의 집계 쿼리와 같은 역할). */
function ledger(entries: TemplateLine[][]): AccountTotals[] {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const lines of entries) {
    expect(validateJournal(lines)).toEqual([]);
    for (const l of lines) {
      const t = totals.get(l.accountCode) ?? { debit: 0, credit: 0 };
      t.debit += l.debit;
      t.credit += l.credit;
      totals.set(l.accountCode, t);
    }
  }
  return [...totals.entries()].map(([code, t]) => {
    const def = STANDARD_ACCOUNTS.find((a) => a.code === code)!;
    return {
      accountId: code,
      code,
      name: def.name,
      group: def.group as StatementGroup,
      normalBalance: accountNormalBalance(def),
      ...t,
    };
  });
}

const capital: TemplateLine[] = [
  { accountCode: '103', debit: 10_000_000, credit: 0 },
  { accountCode: '331', debit: 0, credit: 10_000_000 },
];
const buyGoods = purchaseLines({ supply: 2_000_000, vatType: 'taxable', expenseCode: '146' });
const sell = salesLines({ supply: 3_000_000, vatType: 'taxable' });
const cogs: TemplateLine[] = [
  { accountCode: '451', debit: 2_000_000, credit: 0 },
  { accountCode: '146', debit: 0, credit: 2_000_000 },
];
const rent: TemplateLine[] = [
  { accountCode: '819', debit: 500_000, credit: 0 },
  { accountCode: '103', debit: 0, credit: 500_000 },
];
const collect = receiptLines(3_300_000, '108', '103');
const allowance: TemplateLine[] = [
  { accountCode: '835', debit: 30_000, credit: 0 },
  { accountCode: '109', debit: 0, credit: 30_000 },
];

describe('시산표·재무제표', () => {
  const accounts = ledger([capital, buyGoods, sell, cogs, rent, collect, allowance]);

  it('합계잔액시산표는 차변·대변 합계와 잔액 합계가 각각 같다', () => {
    const tb = trialBalance(accounts);
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.debitBalance).toBe(tb.totals.creditBalance);
    expect(tb.rows.map((r) => r.code)).toEqual([...tb.rows.map((r) => r.code)].sort());
  });

  it('손익계산서: 매출 - 매출원가 - 판관비 = 순이익', () => {
    const is = incomeStatement(accounts);
    expect(is.revenue).toBe(3_000_000);
    expect(is.costOfSales).toBe(2_000_000);
    expect(is.grossProfit).toBe(1_000_000);
    expect(is.sga).toBe(530_000);
    expect(is.operatingIncome).toBe(470_000);
    expect(is.netIncome).toBe(470_000);
  });

  it('재무상태표: 자산 = 부채 + 자본(당기순이익 포함), 차감 계정은 자산에서 뺀다', () => {
    const bs = balanceSheet(accounts, 470_000);
    expect(bs.balanced).toBe(true);
    // 예금 10,000,000 - 500,000 + 3,300,000 / 외상매출금 3,300,000 - 3,300,000 / 대손충당금 -30,000 / 부가세대급금 200,000
    expect(bs.totalAssets).toBe(12_800_000 + 200_000 - 30_000);
    // 외상매입금 2,200,000 + 부가세예수금 300,000
    expect(bs.totalLiabilities).toBe(2_500_000);
    expect(bs.totalEquity).toBe(10_470_000);
    const quick = bs.assets.find((s) => s.group === 'quick_assets')!;
    expect(quick.lines.find((l) => l.code === '109')!.amount).toBe(-30_000);
    expect(bs.undistributedIncome).toEqual({ priorPeriods: 0, currentPeriod: 470_000 });
  });

  it('지난 기간 손익을 마감하지 않았어도 자산 = 부채 + 자본이 성립한다', () => {
    // 전체 누적 순이익 470,000 중 당기분이 170,000 이라면 300,000 은 전기 미처분이익
    const bs = balanceSheet(accounts, 170_000);
    expect(bs.balanced).toBe(true);
    expect(bs.undistributedIncome).toEqual({ priorPeriods: 300_000, currentPeriod: 170_000 });
  });
});

describe('표준 계정과목', () => {
  it('코드가 중복되지 않고, 채권·채무 계정은 거래처 필수다', () => {
    const codes = STANDARD_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of ['108', '110', '120', '251', '253']) {
      expect(STANDARD_ACCOUNTS.find((a) => a.code === code)?.requiresPartner).toBe(true);
    }
  });

  it('차감 계정은 정상 잔액이 반대다', () => {
    const find = (code: string) => STANDARD_ACCOUNTS.find((a) => a.code === code)!;
    expect(accountNormalBalance(find('101'))).toBe('debit');
    expect(accountNormalBalance(find('109'))).toBe('credit');
    expect(accountNormalBalance(find('251'))).toBe('credit');
    expect(accountNormalBalance(find('402'))).toBe('debit');
    expect(accountNormalBalance(find('801'))).toBe('debit');
  });
});
