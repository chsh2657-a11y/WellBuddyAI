import { daysBetween, type IsoDate } from './periods.js';

/** 채권·채무 연령 구간(경과일 상한). 마지막 구간은 그 이상 전부 */
export const AGING_BOUNDS = [30, 60, 90, 180] as const;
export const AGING_LABELS = ['30일 이내', '31~60일', '61~90일', '91~180일', '180일 초과'] as const;

export interface AgingItem {
  /** 채권이 생긴 날(외상매출) 또는 채무가 생긴 날(외상매입) */
  date: IsoDate;
  amount: number;
}

/**
 * 잔액을 발생일별로 나눈다(선입선출: 받거나 갚은 돈은 오래된 것부터 지운 것으로 본다).
 * 즉 남은 잔액은 가장 최근에 생긴 채권·채무부터 채운다.
 * 잔액이 음수(선수·선급 상태)면 첫 구간에 그대로 둔다.
 */
export function agingBuckets(
  items: readonly AgingItem[],
  balance: number,
  asOf: IsoDate,
  bounds: readonly number[] = AGING_BOUNDS,
): number[] {
  const buckets = new Array<number>(bounds.length + 1).fill(0);
  if (balance <= 0) {
    buckets[0] = balance;
    return buckets;
  }
  let remaining = balance;
  const newestFirst = [...items]
    .filter((i) => i.amount > 0)
    .sort((x, y) => (x.date < y.date ? 1 : -1));
  for (const item of newestFirst) {
    if (remaining <= 0) break;
    const take = Math.min(item.amount, remaining);
    const age = Math.max(0, daysBetween(item.date, asOf));
    const index = bounds.findIndex((b) => age <= b);
    buckets[index === -1 ? bounds.length : index]! += take;
    remaining -= take;
  }
  // 발생 내역보다 잔액이 크면(기초잔액 등) 가장 오래된 구간에 둔다
  if (remaining > 0) buckets[bounds.length]! += remaining;
  return buckets;
}
