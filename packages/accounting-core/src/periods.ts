import { Decimal } from 'decimal.js';
import { STATEMENT_GROUPS, type StatementGroup } from './chart-of-accounts.js';

/** YYYY-MM-DD 문자열로 날짜를 다룬다(시간대 영향 없음). */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: IsoDate): [number, number, number] {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`날짜 형식이 아닙니다: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function iso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 날짜에 일수를 더한다(음수 가능). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 그 달 1일에 개월 수를 더한 날짜의 1일 */
export function addMonthsToMonthStart(date: IsoDate, months: number): IsoDate {
  const [y, m] = parts(date);
  const index = y * 12 + (m - 1) + months;
  return iso(Math.floor(index / 12), (index % 12) + 1, 1);
}

export interface DateRange {
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * 날짜가 속한 회계연도. 시작월이 1이면 1/1~12/31, 4이면 4/1~다음 해 3/31.
 * 표시 이름은 시작 연도(시작월이 1이 아니면 "2026-2027").
 */
export function fiscalYearOf(date: IsoDate, startMonth: number): DateRange & { label: string } {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError('회계연도 시작월은 1~12 입니다.');
  }
  const [y, m] = parts(date);
  const startYear = m >= startMonth ? y : y - 1;
  const startDate = iso(startYear, startMonth, 1);
  const endDate = addDays(addMonthsToMonthStart(startDate, 12), -1);
  const label = startMonth === 1 ? String(startYear) : `${startYear}-${startYear + 1}`;
  return { startDate, endDate, label };
}

/** 회계연도를 달 단위 기간 12개로 나눈다. */
export function monthlyPeriods(fiscalYearStart: IsoDate): (DateRange & { periodNo: number })[] {
  return Array.from({ length: 12 }, (_, i) => {
    const startDate = addMonthsToMonthStart(fiscalYearStart, i);
    return {
      periodNo: i + 1,
      startDate,
      endDate: addDays(addMonthsToMonthStart(fiscalYearStart, i + 1), -1),
    };
  });
}

// ── 전기이월 ─────────────────────────────────────────────

export interface BalanceRow {
  accountId: string;
  partnerId: string | null;
  group: StatementGroup;
  debit: number;
  credit: number;
  /** 외화 전표 줄이면 통화와 외화 순액(차변 +, 대변 −, 소수 둘째 자리 문자열) */
  currency?: string | null;
  foreignNet?: string | null;
}

export interface CarryForwardLine {
  accountId: string;
  partnerId: string | null;
  debit: number;
  credit: number;
  /** 외화 잔액도 함께 이월한다(외화 금액은 원화 금액과 같은 쪽 기준) */
  currency?: string | null;
  foreignAmount?: string | null;
}

/**
 * 회계연도 말 잔액으로 다음 연도 기초잔액 분개를 만든다.
 * - 재무상태표 계정: (계정, 거래처)별 잔액을 그대로 이월
 * - 손익계산서 계정: 당기순이익으로 합쳐 이월이익잉여금 계정에 더한다
 * 결과는 항상 차변 합계 = 대변 합계다.
 */
export function carryForwardLines(
  rows: readonly BalanceRow[],
  retainedEarningsAccountId: string,
): { lines: CarryForwardLine[]; netIncome: number } {
  interface Balance {
    accountId: string;
    partnerId: string | null;
    currency: string | null;
    net: number;
    foreignNet: Decimal;
  }
  const balances = new Map<string, Balance>();
  let netIncome = 0;
  const add = (
    accountId: string,
    partnerId: string | null,
    net: number,
    currency: string | null = null,
    foreignNet: string | null = null,
  ) => {
    const key = `${accountId}:${partnerId ?? ''}:${currency ?? ''}`;
    const b = balances.get(key) ?? {
      accountId,
      partnerId,
      currency,
      net: 0,
      foreignNet: new Decimal(0),
    };
    b.net += net;
    if (foreignNet) b.foreignNet = b.foreignNet.plus(foreignNet);
    balances.set(key, b);
  };
  for (const r of rows) {
    if (STATEMENT_GROUPS[r.group].statement === 'IS') {
      netIncome += r.credit - r.debit;
    } else {
      add(r.accountId, r.partnerId, r.debit - r.credit, r.currency ?? null, r.foreignNet ?? null);
    }
  }
  if (netIncome !== 0) add(retainedEarningsAccountId, null, -netIncome);
  const lines = [...balances.values()]
    .filter((b) => b.net !== 0)
    .map(({ accountId, partnerId, net, currency, foreignNet }) => ({
      accountId,
      partnerId,
      debit: Math.max(net, 0),
      credit: Math.max(-net, 0),
      ...(currency
        ? {
            currency,
            foreignAmount: (net > 0 ? foreignNet : foreignNet.negated()).toFixed(2),
          }
        : {}),
    }));
  return { lines, netIncome };
}

/** b - a 일수 */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
