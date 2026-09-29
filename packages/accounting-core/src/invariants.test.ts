import { describe, expect, it } from 'vitest';
import {
  accountNormalBalance,
  STANDARD_ACCOUNTS,
  STATEMENT_GROUPS,
  SYSTEM_ACCOUNTS,
} from './chart-of-accounts.js';
import { depreciationSchedule, disposalProfit } from './depreciation.js';
import { type FxSide, revaluationLines, settlementLines } from './fx.js';
import { reverseLines, validateJournal } from './journal.js';
import { type BalanceRow, carryForwardLines } from './periods.js';
import { type AccountTotals, balanceSheet, incomeStatement, trialBalance } from './statements.js';
import { paymentLines, purchaseLines, receiptLines, salesLines } from './templates.js';
import { VAT_TYPES } from './vat.js';

/**
 * 회계 불변식: 어떤 거래를 어떻게 섞어도 항상 성립해야 하는 관계를
 * 고정 시드의 무작위 전표 수백 건으로 확인한다(P1-23 단계 완료 기준).
 */

/** mulberry32: 시드가 같으면 같은 수열 */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Line {
  accountCode: string;
  debit: number;
  credit: number;
  partnerId: string | null;
}

const byCode = new Map(STANDARD_ACCOUNTS.map((a) => [a.code, a]));
const PARTNERS = ['한빛', '누리', '다온'];

function generate(seed: number, count: number): Line[][] {
  const r = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const amount = (max = 5_000_000) => 1 + Math.floor(r() * max);
  const partnerFor = (code: string) => (byCode.get(code)?.requiresPartner ? pick(PARTNERS) : null);
  const toLines = (
    template: { accountCode: string; debit: number; credit: number; withPartner?: boolean }[],
    partner: string,
  ): Line[] =>
    template.map((t) => ({
      accountCode: t.accountCode,
      debit: t.debit,
      credit: t.credit,
      partnerId: t.withPartner || byCode.get(t.accountCode)?.requiresPartner ? partner : null,
    }));

  const entries: Line[][] = [];
  const counterCodes = ['401', '811', '813', '819', '830', '108', '251', '253', '331', '120'];
  for (let i = 0; i < count; i++) {
    const kind = r();
    let lines: Line[];
    if (kind < 0.2) {
      const vatType = pick(VAT_TYPES);
      lines = toLines(
        salesLines({
          supply: amount(),
          vatType,
          receivableCode: pick([SYSTEM_ACCOUNTS.accountsReceivable, '101', '103']),
        }),
        pick(PARTNERS),
      );
    } else if (kind < 0.4) {
      lines = toLines(
        purchaseLines({
          supply: amount(),
          vatType: pick(VAT_TYPES),
          expenseCode: pick(['146', '830', '811', '813', '212']),
          payableCode: pick([SYSTEM_ACCOUNTS.accountsPayable, '253', '101', '103']),
          deductible: r() < 0.8,
        }),
        pick(PARTNERS),
      );
    } else if (kind < 0.55) {
      lines = toLines(
        receiptLines(amount(), pick(counterCodes), pick(['101', '103'])),
        pick(PARTNERS),
      );
    } else if (kind < 0.7) {
      lines = toLines(
        paymentLines(amount(), pick(counterCodes), pick(['101', '103'])),
        pick(PARTNERS),
      );
    } else if (kind < 0.74) {
      // 기말 외화평가(외화예금·외화채권·외화채무)
      const [code, side] = pick<[string, FxSide]>([
        ['103', 'asset'],
        ['108', 'asset'],
        ['251', 'liability'],
      ]);
      const adjustment = (r() < 0.5 ? -1 : 1) * amount(300_000);
      lines = toLines(revaluationLines(code, side, adjustment), pick(PARTNERS));
    } else if (kind < 0.78) {
      // 외화 채권 회수·채무 상환(외환차익·차손)
      const side = pick<FxSide>(['asset', 'liability']);
      lines = toLines(
        settlementLines({
          side,
          accountCode: side === 'asset' ? '108' : '251',
          bookKrw: amount(),
          settledKrw: amount(),
        }),
        pick(PARTNERS),
      );
    } else if (kind < 0.82) {
      // 월 감가상각 + 처분: (차) 누계액·대금·처분손실 / (대) 자산·처분이익
      const cost = 1_001 + amount(20_000_000);
      const schedule = depreciationSchedule({
        method: pick(['straight_line', 'declining_balance'] as const),
        cost,
        usefulLifeYears: 1 + Math.floor(r() * 10),
        acquisitionDate: '2026-01-01',
      });
      const accumulated = schedule[Math.floor(r() * schedule.length)]!.accumulated;
      const proceeds = r() < 0.3 ? 0 : amount(cost);
      const profit = disposalProfit(cost, accumulated, proceeds);
      lines = [
        { accountCode: '818', debit: accumulated, credit: 0, partnerId: null },
        { accountCode: '213', debit: 0, credit: accumulated, partnerId: null },
        { accountCode: '213', debit: accumulated, credit: 0, partnerId: null },
        { accountCode: '103', debit: proceeds, credit: 0, partnerId: null },
        { accountCode: '970', debit: profit < 0 ? -profit : 0, credit: 0, partnerId: null },
        { accountCode: '212', debit: 0, credit: cost, partnerId: null },
        { accountCode: '914', debit: 0, credit: profit > 0 ? profit : 0, partnerId: null },
      ].filter((l) => l.debit > 0 || l.credit > 0);
    } else if (kind < 0.9 || entries.length === 0) {
      // 여러 줄 대체전표: 마지막 줄로 차대를 맞춘다(차감 계정·매출할인 포함 아무 계정)
      const n = 2 + Math.floor(r() * 4);
      lines = [];
      let net = 0;
      for (let k = 0; k < n - 1; k++) {
        const code = pick(STANDARD_ACCOUNTS).code;
        const value = amount(2_000_000);
        const debit = r() < 0.5;
        lines.push({
          accountCode: code,
          debit: debit ? value : 0,
          credit: debit ? 0 : value,
          partnerId: partnerFor(code),
        });
        net += debit ? value : -value;
      }
      if (net === 0) continue;
      const code = pick(STANDARD_ACCOUNTS).code;
      lines.push({
        accountCode: code,
        debit: net < 0 ? -net : 0,
        credit: net > 0 ? net : 0,
        partnerId: partnerFor(code),
      });
    } else {
      // 앞의 전표 하나를 역분개
      lines = reverseLines(pick(entries));
    }
    entries.push(lines);
  }
  return entries;
}

function totalsOf(entries: Line[][]): AccountTotals[] {
  const sums = new Map<string, { debit: number; credit: number }>();
  for (const line of entries.flat()) {
    const s = sums.get(line.accountCode) ?? { debit: 0, credit: 0 };
    s.debit += line.debit;
    s.credit += line.credit;
    sums.set(line.accountCode, s);
  }
  return [...sums.entries()].map(([code, s]) => {
    const account = byCode.get(code)!;
    return {
      accountId: code,
      code,
      name: account.name,
      group: account.group,
      normalBalance: accountNormalBalance(account),
      ...s,
    };
  });
}

/** 손익 계정의 (대변 - 차변) 합계 = 당기순이익(정상잔액 방향과 무관하게) */
function rawNetIncome(totals: AccountTotals[]) {
  return totals
    .filter((a) => STATEMENT_GROUPS[a.group].statement === 'IS')
    .reduce((s, a) => s + a.credit - a.debit, 0);
}

describe.each([1, 7, 42, 2026, 90210])('회계 불변식 (시드 %i)', (seed) => {
  const entries = generate(seed, 400);
  const totals = totalsOf(entries);

  it('만든 전표는 모두 복식부기 규칙을 지킨다', () => {
    for (const e of entries) expect(validateJournal(e)).toEqual([]);
  });

  it('합계잔액시산표: 차변 합계 = 대변 합계, 잔액 합계도 같다', () => {
    const tb = trialBalance(totals);
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.debitBalance).toBe(tb.totals.creditBalance);
  });

  it('손익계산서 당기순이익 = 손익 계정 (대변 - 차변) 합계', () => {
    expect(incomeStatement(totals).netIncome).toBe(rawNetIncome(totals));
  });

  it('재무상태표: 자산 = 부채 + 자본(당기순이익 포함)', () => {
    const netIncome = incomeStatement(totals).netIncome;
    const bs = balanceSheet(totals, netIncome);
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
    expect(bs.undistributedIncome).toEqual({ priorPeriods: 0, currentPeriod: netIncome });
  });

  it('전기이월: 이월 분개는 차대가 맞고, 다음 연도 기초 재무상태표 = 전년도 말 재무상태표', () => {
    const rows = new Map<string, BalanceRow>();
    for (const line of entries.flat()) {
      const key = `${line.accountCode}:${line.partnerId ?? ''}`;
      const row = rows.get(key) ?? {
        accountId: line.accountCode,
        partnerId: line.partnerId,
        group: byCode.get(line.accountCode)!.group,
        debit: 0,
        credit: 0,
      };
      row.debit += line.debit;
      row.credit += line.credit;
      rows.set(key, row);
    }
    const { lines, netIncome } = carryForwardLines(
      [...rows.values()],
      SYSTEM_ACCOUNTS.retainedEarnings,
    );
    expect(netIncome).toBe(incomeStatement(totals).netIncome);
    expect(validateJournal(lines)).toEqual([]);

    const closing = balanceSheet(totals, netIncome);
    const openingTotals = totalsOf([lines.map((l) => ({ ...l, accountCode: l.accountId }))]);
    const opening = balanceSheet(openingTotals, incomeStatement(openingTotals).netIncome);
    expect(opening.undistributedIncome.currentPeriod).toBe(0);
    expect(opening.totalAssets).toBe(closing.totalAssets);
    expect(opening.totalLiabilities).toBe(closing.totalLiabilities);
    expect(opening.totalEquity).toBe(closing.totalEquity);

    // 다음 해에 거래가 더 쌓여도 대차는 계속 맞는다
    const nextYear = [
      lines.map((l) => ({ ...l, accountCode: l.accountId })),
      ...generate(seed + 1, 200),
    ];
    const nextTotals = totalsOf(nextYear);
    expect(trialBalance(nextTotals).balanced).toBe(true);
    expect(balanceSheet(nextTotals, incomeStatement(nextTotals).netIncome).balanced).toBe(true);
  });
});
