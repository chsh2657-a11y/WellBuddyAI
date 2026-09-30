import { createHash } from 'node:crypto';
import { addDays } from '@wellbuddy/accounting-core';

/**
 * 모의 데이터용 결정적 난수. 같은 씨앗(계좌·날짜 등)이면 언제 불러도 같은 값을 낸다.
 * 그래서 겹치는 기간을 다시 수집하면 같은 거래가 나오고, 중복 제거로 건너뛴다.
 */
export interface Rng {
  /** 0 이상 1 미만 */
  next(): number;
  /** min 이상 max 이하 정수 */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** min~max 사이 금액을 unit 단위로 */
  amount(min: number, max: number, unit: number): number;
}

export function seededRandom(...parts: (string | number)[]): Rng {
  let state = createHash('sha256').update(parts.join('\u001f')).digest().readUInt32LE(0);
  // mulberry32
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (items) => items[int(0, items.length - 1)]!,
    amount: (min, max, unit) => int(Math.ceil(min / unit), Math.floor(max / unit)) * unit,
  };
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** 0 일요일 … 6 토요일 */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export const isWeekend = (date: string) => weekday(date) === 0 || weekday(date) === 6;

export const compactDate = (date: string) => date.replace(/-/g, '');

/** 업무 시간(08:00~18:59) 안의 시각들을 오름차순으로 */
export function businessTimes(rng: Rng, count: number): string[] {
  return Array.from({ length: count }, () => rng.int(8 * 3600, 19 * 3600 - 1))
    .sort((a, b) => a - b)
    .map((s) =>
      [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
        .map((n) => String(n).padStart(2, '0'))
        .join(':'),
    );
}
