import { describe, expect, it } from 'vitest';
import {
  costMoves,
  lineSupply,
  type StockMove,
  sortMoves,
  stockShortages,
  toMilli,
} from './inventory.js';

let seq = 0;
const move = (
  date: string,
  qty: number,
  costing: StockMove['costing'],
  amount?: number,
  extra: Partial<StockMove> = {},
): StockMove => ({
  id: `m${++seq}`,
  itemId: 'A',
  warehouseId: 'W1',
  date,
  seq,
  qty,
  costing,
  amount,
  ...extra,
});

describe('수량·공급가액', () => {
  it('수량은 1/1000 정수로 바꿔 부동소수 오차 없이 계산한다', () => {
    expect(toMilli(0.1 + 0.2)).toBe(300);
    expect(lineSupply(3, 1_000)).toBe(3_000);
    expect(lineSupply(1.5, 999)).toBe(1_498); // 1,498.5 → 원 미만 절사
    expect(lineSupply(0.001, 1_000_000)).toBe(1_000);
    // 큰 수도 정확히: 999,999.999 × 9,999,999 = 9,999,998,990,000.001
    expect(lineSupply(999_999.999, 9_999_999)).toBe(9_999_998_990_000);
    // 원 단위로 다룰 수 있는 범위를 넘으면 거부
    expect(() => lineSupply(999_999_999_999, 99_999_999)).toThrow();
  });

  it('수량 0·음수, 단가 음수·소수는 거부한다', () => {
    expect(() => lineSupply(0, 100)).toThrow();
    expect(() => lineSupply(-1, 100)).toThrow();
    expect(() => lineSupply(1, -100)).toThrow();
    expect(() => lineSupply(1, 10.5)).toThrow();
  });
});

describe('이동평균', () => {
  it('입고 금액으로 평단을 만들고, 출고는 평단으로, 전량 출고는 남은 금액 전부', () => {
    const moves = [
      move('2026-10-01', 10, 'fixed', 10_000), // 평단 1,000
      move('2026-10-02', 5, 'fixed', 6_000), // 15개 16,000 → 평단 1,066.67
      move('2026-10-03', -4, 'average'), // 4 × 16,000/15 = 4,266.67 → 4,267
      move('2026-10-04', -11, 'average'), // 남은 11개 전부 = 11,733
    ];
    const { amounts, balances } = costMoves(moves);
    expect(moves.map((m) => amounts.get(m.id))).toEqual([10_000, 6_000, -4_267, -11_733]);
    expect(balances.get('A')).toEqual({ qty: 0, value: 0 });
  });

  it('같은 날에는 들어온 것을 먼저 처리한다(나중에 입력한 입고도 먼저)', () => {
    const out = move('2026-10-05', -2, 'average');
    const inn = move('2026-10-05', 2, 'fixed', 3_000);
    expect(sortMoves([out, inn]).map((m) => m.id)).toEqual([inn.id, out.id]);
    const { amounts } = costMoves([out, inn]);
    expect(amounts.get(out.id)).toBe(-3_000);
    expect(stockShortages([out, inn])).toEqual([]);
  });

  it('평균 단가로 들어오는 반품은 지금 평단(재고가 없으면 마지막 평단)', () => {
    const moves = [
      move('2026-10-01', 4, 'fixed', 10_000), // 평단 2,500
      move('2026-10-02', -4, 'average'), // -10,000, 재고 0
      move('2026-10-03', 1, 'average'), // 반품: 마지막 평단 2,500
    ];
    const { amounts, balances } = costMoves(moves);
    expect(amounts.get(moves[2]!.id)).toBe(2_500);
    expect(balances.get('A')).toEqual({ qty: 1, value: 2_500 });
  });

  it('창고 이동(none)은 금액이 없고 품목 원가를 바꾸지 않는다', () => {
    const moves = [
      move('2026-10-01', 3, 'fixed', 3_000),
      move('2026-10-02', -1, 'none', undefined, { warehouseId: 'W1' }),
      move('2026-10-02', 1, 'none', undefined, { warehouseId: 'W2' }),
      move('2026-10-03', -1, 'average', undefined, { warehouseId: 'W2' }),
    ];
    const { amounts, balances } = costMoves(moves);
    expect(amounts.get(moves[1]!.id)).toBe(0);
    expect(amounts.get(moves[3]!.id)).toBe(-1_000);
    expect(balances.get('A')).toEqual({ qty: 2, value: 2_000 });
  });

  it('불변식: 이동 금액의 합 = 기말 금액, 소수 수량도 끝전 없이 0으로 끝난다', () => {
    // 무작위 입출고(재고가 음수가 되지 않게)
    let rnd = 7;
    const next = () => (rnd = (rnd * 48_271) % 2_147_483_647) / 2_147_483_647;
    const moves: StockMove[] = [];
    let qty = 0;
    for (let i = 0; i < 300; i++) {
      const date = `2026-${String(1 + Math.floor(i / 30)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
      if (qty < 1 || next() < 0.5) {
        const q = Math.round((1 + next() * 20) * 1000) / 1000;
        moves.push(move(date, q, 'fixed', Math.floor(q * (900 + next() * 300))));
        qty = Math.round((qty + q) * 1000) / 1000;
      } else {
        const q = Math.min(qty, Math.round((0.1 + next() * 10) * 1000) / 1000);
        moves.push(move(date, -q, 'average'));
        qty = Math.round((qty - q) * 1000) / 1000;
      }
    }
    moves.push(move('2026-12-31', -qty, 'average'));
    const { amounts, balances } = costMoves(moves);
    const total = [...amounts.values()].reduce((s, v) => s + v, 0);
    expect(balances.get('A')).toEqual({ qty: 0, value: 0 });
    expect(total).toBe(0);
    expect([...amounts.values()].every(Number.isInteger)).toBe(true);
  });

  it('품목마다 따로 계산한다', () => {
    const moves = [
      move('2026-10-01', 1, 'fixed', 1_000, { itemId: 'A' }),
      move('2026-10-01', 1, 'fixed', 5_000, { itemId: 'B' }),
      move('2026-10-02', -1, 'average', undefined, { itemId: 'B' }),
    ];
    const { amounts } = costMoves(moves);
    expect(amounts.get(moves[2]!.id)).toBe(-5_000);
  });
});

describe('재고 부족', () => {
  it('품목·창고별로 처음 부족해지는 날과 수량을 찾는다', () => {
    const moves = [
      move('2026-10-01', 5, 'fixed', 5_000, { warehouseId: 'W1' }),
      move('2026-10-02', -3, 'average', undefined, { warehouseId: 'W2' }),
      move('2026-10-03', -6, 'average', undefined, { warehouseId: 'W1' }),
    ];
    expect(stockShortages(moves)).toEqual([
      { itemId: 'A', warehouseId: 'W2', lotNo: null, date: '2026-10-02', short: 3 },
      { itemId: 'A', warehouseId: 'W1', lotNo: null, date: '2026-10-03', short: 1 },
    ]);
  });

  it('소급 출고가 이후 재고를 마이너스로 만들면 찾는다', () => {
    const moves = [
      move('2026-10-01', 2, 'fixed', 2_000),
      move('2026-10-05', -2, 'average'),
      move('2026-10-03', -1, 'average'), // 나중에 입력한 소급 출고
    ];
    expect(stockShortages(moves)).toEqual([
      { itemId: 'A', warehouseId: 'W1', lotNo: null, date: '2026-10-05', short: 1 },
    ]);
  });

  it('LOT 별로도 따진다', () => {
    const moves = [
      move('2026-10-01', 2, 'fixed', 2_000, { lotNo: 'L1' }),
      move('2026-10-02', -1, 'average', undefined, { lotNo: 'L2' }),
    ];
    expect(stockShortages(moves)).toEqual([]);
    expect(stockShortages(moves, { byLot: true })).toEqual([
      { itemId: 'A', warehouseId: 'W1', lotNo: 'L2', date: '2026-10-02', short: 1 },
    ]);
  });
});
