import { assertWon, MoneyError } from './money.js';

/**
 * 재고 수량·원가 계산(이동평균).
 * - 수량은 소수 셋째 자리까지라 1/1000 정수(milli)로 바꿔 계산한다(부동소수 오차 없음).
 * - 원가는 품목별로 회사 전체(모든 창고)를 하나로 보고 이동평균한다. 창고 이동은 원가를 바꾸지 않는다.
 * - 같은 날에는 들어온 것을 먼저 처리한다(같은 날 입고 뒤 출고를 나중에 입력해도 재고 부족이 아니다).
 */

/** 수량 → 1/1000 정수 */
export function toMilli(qty: number): number {
  const m = Math.round(qty * 1000);
  if (!Number.isSafeInteger(m)) throw new MoneyError('수량이 너무 큽니다.');
  return m;
}

export function fromMilli(milli: number): number {
  return milli / 1000;
}

/** a × b ÷ c 를 정수로(반올림, 큰 수도 정확히). c 는 0 이 아니어야 한다. */
function mulDivRound(a: number, b: number, c: number): number {
  const sign = Math.sign(a) * Math.sign(b) * Math.sign(c);
  const num = BigInt(Math.abs(a)) * BigInt(Math.abs(b));
  const den = BigInt(Math.abs(c));
  const q = (num * 2n + den) / (den * 2n);
  return sign * Number(q);
}

/** 줄 공급가액 = 수량 × 단가(원 미만 절사) */
export function lineSupply(qty: number, unitPrice: number): number {
  assertWon(unitPrice, '단가');
  if (unitPrice < 0) throw new MoneyError('단가는 0 이상이어야 합니다.');
  const m = toMilli(qty);
  if (m <= 0) throw new MoneyError('수량은 0보다 커야 합니다.');
  const supply = (BigInt(m) * BigInt(unitPrice)) / 1000n;
  if (supply > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError('금액이 너무 큽니다.');
  return Number(supply);
}

/**
 * 원가 방식
 * - fixed: 금액이 정해진 이동(입고·구매·구매반품·기초재고). amount 를 그대로 쓴다.
 * - average: 이동평균 단가로 금액을 정하는 이동(출고·판매·판매반품·재고조정).
 * - none: 금액이 없는 이동(창고 간 이동). 품목 원가에 영향이 없다.
 */
export type Costing = 'fixed' | 'average' | 'none';

export interface StockMove {
  id: string;
  itemId: string;
  warehouseId: string;
  /** YYYY-MM-DD */
  date: string;
  /** 같은 날 입력 순서 */
  seq: number;
  /** 들어오면 +, 나가면 - (소수 셋째 자리까지) */
  qty: number;
  costing: Costing;
  /** fixed 일 때 금액(들어오면 +, 나가면 -) */
  amount?: number;
  lotNo?: string | null;
}

export interface CostResult {
  /** 이동마다 금액(들어오면 +, 나가면 -) */
  amounts: Map<string, number>;
  /** 품목별 기말 수량·금액 */
  balances: Map<string, { qty: number; value: number }>;
}

/** 처리 순서: 날짜 → 같은 날은 들어온 것 먼저 → 입력 순서 */
export function sortMoves<T extends Pick<StockMove, 'date' | 'seq' | 'qty'>>(moves: T[]): T[] {
  return [...moves].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || Number(b.qty > 0) - Number(a.qty > 0) || a.seq - b.seq,
  );
}

/** 이동평균으로 이동마다 금액을 정한다. */
export function costMoves(moves: StockMove[]): CostResult {
  const amounts = new Map<string, number>();
  const state = new Map<
    string,
    { qty: number; value: number; lastUnit: [number, number] | null }
  >();
  for (const move of sortMoves(moves)) {
    const s = state.get(move.itemId) ?? { qty: 0, value: 0, lastUnit: null };
    const m = toMilli(move.qty);
    let amount = 0;
    if (move.costing === 'none') {
      amount = 0;
    } else if (move.costing === 'fixed') {
      amount = move.amount ?? 0;
      assertWon(amount);
    } else if (m > 0) {
      // 평균 단가로 들어옴(판매 반품·재고 증가): 지금 평단, 재고가 없으면 마지막 평단
      if (s.qty > 0) amount = mulDivRound(m, s.value, s.qty);
      else if (s.lastUnit) amount = mulDivRound(m, s.lastUnit[0], s.lastUnit[1]);
    } else if (m < 0) {
      // 평균 단가로 나감: 남은 수량을 모두 내보내면 남은 금액 전부(끝전이 남지 않게)
      const out = -m;
      if (s.qty > 0) amount = out >= s.qty ? -s.value : -mulDivRound(out, s.value, s.qty);
      else if (s.lastUnit) amount = -mulDivRound(out, s.lastUnit[0], s.lastUnit[1]);
    }
    if (move.costing !== 'none') {
      s.qty += m;
      s.value += amount;
      if (s.qty > 0) s.lastUnit = [s.value, s.qty];
    }
    amounts.set(move.id, amount);
    state.set(move.itemId, s);
  }
  const balances = new Map<string, { qty: number; value: number }>();
  for (const [itemId, s] of state) balances.set(itemId, { qty: fromMilli(s.qty), value: s.value });
  return { amounts, balances };
}

export interface Shortage {
  itemId: string;
  warehouseId: string;
  lotNo: string | null;
  date: string;
  /** 모자란 수량(양수) */
  short: number;
}

/**
 * 재고 부족 찾기: 품목·창고(LOT 를 쓰면 LOT 까지)별 누적 수량이 어느 날이든 0보다 작아지는 곳.
 * 같은 칸에서 처음 부족해지는 날 하나만 돌려준다.
 */
export function stockShortages(moves: StockMove[], options: { byLot?: boolean } = {}): Shortage[] {
  const running = new Map<string, number>();
  const found = new Map<string, Shortage>();
  for (const move of sortMoves(moves)) {
    const lot = options.byLot ? (move.lotNo ?? null) : null;
    const key = `${move.itemId}|${move.warehouseId}|${lot ?? ''}`;
    const next = (running.get(key) ?? 0) + toMilli(move.qty);
    running.set(key, next);
    if (next < 0 && !found.has(key)) {
      found.set(key, {
        itemId: move.itemId,
        warehouseId: move.warehouseId,
        lotNo: lot,
        date: move.date,
        short: fromMilli(-next),
      });
    }
  }
  return [...found.values()];
}
