import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  accumulatedDepreciation,
  type DepreciationInput,
  discountCharge,
} from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

/**
 * P1b-07 단계 완료 기준: 한 회사에서 1년 동안 감가상각·외화평가·어음 자동전표를 섞어 만든 뒤
 * 원장·재무제표·보조 대장이 서로 맞는지, 전기이월 뒤에도 이어지는지 확인한다.
 * 기대값은 계산 엔진(accounting-core)으로 따로 계산한다.
 */
describe('P1b 단계 완료 기준(자동전표 → 원장)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const acc: Record<string, string> = {};
  let fy2026: string;
  let globalInc: string;
  let hanbit: string;
  let nuri: string;

  const furniture: DepreciationInput = {
    method: 'straight_line',
    cost: 6_001_000,
    usefulLifeYears: 5,
    acquisitionDate: '2026-01-01',
  };
  const vehicle: DepreciationInput = {
    method: 'declining_balance',
    cost: 10_000_000,
    usefulLifeYears: 5,
    acquisitionDate: '2026-04-01',
  };

  const line = (code: string, debit: number, credit: number, extra: object = {}) => ({
    accountId: acc[code]!,
    debit,
    credit,
    ...extra,
  });
  const post = async (entryDate: string, lines: object[]) =>
    (
      await owner
        .post('/api/journals')
        .send({ entry: { entryDate, lines }, status: 'posted' })
        .expect(201)
    ).body as { id: string };
  const closing = async (code: string, from: string, to: string, partnerId?: string) =>
    (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc[code], from, to, ...(partnerId ? { partnerId } : {}) })
        .expect(200)
    ).body.closing as number;
  const usd = (amount: number, rate: number) => ({
    currency: 'USD',
    foreignAmount: String(amount),
    exchangeRate: String(rate),
  });

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@p1b.local', '확장상사'));
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    globalInc = (await owner.post('/api/partners').send({ name: 'Global Inc' }).expect(201)).body
      .id;
    hanbit = (await owner.post('/api/partners').send({ name: '한빛상사' }).expect(201)).body.id;
    nuri = (await owner.post('/api/partners').send({ name: '누리유통' }).expect(201)).body.id;
    fy2026 = (await owner.post('/api/fiscal-years').send({ date: '2026-01-01' }).expect(201)).body
      .id;
    // 기초: 현금 3,000만, 외화예금 USD 10,000(장부 1,300만), 자본금
    await owner
      .put(`/api/fiscal-years/${fy2026}/opening-balances`)
      .send({
        lines: [
          line('101', 30_000_000, 0),
          line('103', 13_000_000, 0, { currency: 'USD', foreignAmount: '10000' }),
          line('331', 0, 43_000_000),
        ],
      })
      .expect(200);
    for (const [currency, rateDate, rate] of [
      ['USD', '2026-03-15', '1380'],
      ['USD', '2026-06-30', '1400'],
      ['USD', '2026-08-20', '1390'],
      ['USD', '2026-12-31', '1350'],
    ] as const) {
      await owner.put('/api/exchange-rates').send({ currency, rateDate, rate }).expect(200);
    }

    // ── 고정자산: 비품(정액법)·차량(정률법, 4월 취득) ──
    await post('2026-01-01', [line('212', furniture.cost, 0), line('101', 0, furniture.cost)]);
    await post('2026-04-01', [line('208', vehicle.cost, 0), line('101', 0, vehicle.cost)]);
    for (const [input, asset, accumulated] of [
      [furniture, '212', '213'],
      [vehicle, '208', '209'],
    ] as const) {
      await owner
        .post('/api/fixed-assets')
        .send({
          ...input,
          name: asset === '212' ? '사무용 가구' : '영업용 차량',
          assetAccountId: acc[asset],
          accumulatedAccountId: acc[accumulated],
          expenseAccountId: acc['818'],
        })
        .expect(201);
    }

    // ── 외화: 3/15 수출 USD 5,000 @1,380 → 6/30 평가 → 8/20 USD 3,000 회수 @1,390(장부 1,400) → 12/31 평가 ──
    await post('2026-03-15', [
      line('108', 6_900_000, 0, { partnerId: globalInc, ...usd(5000, 1380) }),
      line('401', 0, 6_900_000),
    ]);

    // ── 어음: 한빛 외상 매출 → 받을어음 2장(하나는 할인), 누리 외상 매입 → 지급어음 발행·결제 ──
    await post('2026-04-10', [
      line('108', 3_000_000, 0, { partnerId: hanbit }),
      line('401', 0, 3_000_000),
    ]);
    await post('2026-04-12', [
      line('146', 2_000_000, 0),
      line('251', 0, 2_000_000, { partnerId: nuri }),
    ]);
    const receivable = (noteNo: string, amount: number, dueDate: string) =>
      owner
        .post('/api/notes')
        .send({
          kind: 'receivable',
          noteNo,
          partnerId: hanbit,
          issueDate: '2026-05-01',
          dueDate,
          amount,
        })
        .expect(201);
    const r1 = (await receivable('R-1', 2_000_000, '2026-07-31')).body.id;
    await receivable('R-2', 1_000_000, '2027-02-28');
    await owner
      .post(`/api/notes/${r1}/discount`)
      .send({ date: '2026-05-01', annualRate: 12, accountId: acc['101'] })
      .expect(200);
    const p1 = (
      await owner
        .post('/api/notes')
        .send({
          kind: 'payable',
          noteNo: 'P-1',
          partnerId: nuri,
          issueDate: '2026-05-01',
          dueDate: '2026-08-31',
          amount: 1_500_000,
        })
        .expect(201)
    ).body.id;
    await owner
      .post(`/api/notes/${p1}/settle`)
      .send({ date: '2026-08-31', accountId: acc['101'] })
      .expect(200);

    // ── 월별 감가상각과 외화평가를 날짜 순서대로 ──
    for (let m = 1; m <= 12; m++) {
      const month = `2026-${String(m).padStart(2, '0')}`;
      await owner.post('/api/depreciation-runs').send({ month }).expect(201);
      if (m === 6) {
        await owner.post('/api/fx-revaluations').send({ date: '2026-06-30' }).expect(201);
      }
      if (m === 8) {
        await post('2026-08-20', [
          line('103', 4_170_000, 0, usd(3000, 1390)),
          line('952', 30_000, 0),
          line('108', 0, 4_200_000, { partnerId: globalInc, ...usd(3000, 1400) }),
        ]);
      }
    }
    await owner.post('/api/fx-revaluations').send({ date: '2026-12-31' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('재무제표: 시산표 대차 일치, 자산 = 부채 + 자본, 당기순이익 일치', async () => {
    const tb = (
      await owner.get('/api/reports/trial-balance').query({ date: '2026-12-31' }).expect(200)
    ).body;
    expect(tb.balanced).toBe(true);
    const bs = (
      await owner.get('/api/reports/balance-sheet').query({ date: '2026-12-31' }).expect(200)
    ).body;
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
    const is = (
      await owner
        .get('/api/reports/income-statement')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body;
    expect(bs.undistributedIncome.currentPeriod).toBe(is.netIncome);
    const dimension = (
      await owner
        .get('/api/reports/dimension-pl')
        .query({ from: '2026-01-01', to: '2026-12-31', dimension: 'department' })
        .expect(200)
    ).body;
    expect(dimension.totals.profit).toBe(is.netIncome);
  });

  it('감가상각: 누계액 계정 원장 = 엔진 계산 누계 = 자산 대장, 비용 = 실행 합계', async () => {
    const f = accumulatedDepreciation(furniture, '2026-12');
    const v = accumulatedDepreciation(vehicle, '2026-12');
    expect(f).toBe(1_200_000);
    expect(await closing('213', '2026-01-01', '2026-12-31')).toBe(f);
    expect(await closing('209', '2026-01-01', '2026-12-31')).toBe(v);
    const assets = (await owner.get('/api/fixed-assets').expect(200)).body as {
      accumulated: number;
    }[];
    expect(assets.reduce((s, a) => s + a.accumulated, 0)).toBe(f + v);
    const runs = (await owner.get('/api/depreciation-runs').expect(200)).body as {
      totalAmount: number;
    }[];
    expect(runs).toHaveLength(12);
    expect(runs.reduce((s, r) => s + r.totalAmount, 0)).toBe(f + v);
    expect(await closing('818', '2026-01-01', '2026-12-31')).toBe(f + v);
  });

  it('외화평가: 평가 후 원화 잔액 = 외화 잔액 × 기말 환율, 외화환산·외환차손익', async () => {
    // 예금 USD 13,000(기초 10,000 + 회수 3,000), 외상매출금 USD 2,000
    expect(await closing('108', '2026-01-01', '2026-12-31', globalInc)).toBe(2_000 * 1_350);
    const preview = (
      await owner.get('/api/fx-revaluations/preview').query({ date: '2026-12-31' }).expect(200)
    ).body as {
      rows: { accountCode: string; foreignBalance: string; bookKrw: number; adjustment: number }[];
    };
    expect(
      preview.rows.map((r) => [r.accountCode, r.foreignBalance, r.bookKrw, r.adjustment]),
    ).toEqual([
      ['103', '13000.00', 13_000 * 1_350, 0],
      ['108', '2000.00', 2_000 * 1_350, 0],
    ]);
    // 6/30: 예금 +1,000,000, 외상매출금 +100,000 / 12/31: 예금 13,000 × (1,350) − 장부
    const june = 10_000 * 1_400 - 13_000_000 + (5_000 * 1_400 - 6_900_000);
    const bookDec103 = 10_000 * 1_400 + 4_170_000;
    const dec = 13_000 * 1_350 - bookDec103 + (2_000 * 1_350 - 2_000 * 1_400);
    const gain = await closing('910', '2026-01-01', '2026-12-31');
    const loss = await closing('955', '2026-01-01', '2026-12-31');
    expect(gain - loss).toBe(june + dec);
    expect(await closing('952', '2026-01-01', '2026-12-31')).toBe(30_000);
  });

  it('어음: 받을어음 원장 = 보유 어음 합계, 할인료 = 엔진 계산', async () => {
    const holding = (
      (await owner.get('/api/notes').query({ kind: 'receivable', status: 'holding' }).expect(200))
        .body as { amount: number }[]
    ).reduce((s, n) => s + n.amount, 0);
    expect(holding).toBe(1_000_000);
    expect(await closing('110', '2026-01-01', '2026-12-31')).toBe(holding);
    const { charge } = discountCharge({
      faceAmount: 2_000_000,
      annualRatePercent: 12,
      discountDate: '2026-05-01',
      maturityDate: '2026-07-31',
    });
    expect(await closing('956', '2026-01-01', '2026-12-31')).toBe(charge);
    expect(await closing('252', '2026-01-01', '2026-12-31')).toBe(0);
    expect(await closing('251', '2026-01-01', '2026-12-31', nuri)).toBe(2_000_000 - 1_500_000);
  });

  it('전기이월 뒤: 기초 재무상태표 = 기말, 외화 잔액·상각 누계가 다음 연도로 이어진다', async () => {
    const closingBs = (
      await owner.get('/api/reports/balance-sheet').query({ date: '2026-12-31' }).expect(200)
    ).body;
    await owner.post(`/api/fiscal-years/${fy2026}/carry-forward`).expect(200);
    const openingBs = (
      await owner.get('/api/reports/balance-sheet').query({ date: '2027-01-01' }).expect(200)
    ).body;
    expect(openingBs).toMatchObject({
      balanced: true,
      totalAssets: closingBs.totalAssets,
      totalLiabilities: closingBs.totalLiabilities,
      totalEquity: closingBs.totalEquity,
    });

    // 환율이 그대로면(1,350) 다음 연도 평가 차액은 없다
    const preview = (
      await owner.get('/api/fx-revaluations/preview').query({ date: '2027-01-31' }).expect(200)
    ).body as { rows: { accountCode: string; foreignBalance: string; adjustment: number }[] };
    expect(preview.rows.map((r) => [r.accountCode, r.foreignBalance, r.adjustment])).toEqual([
      ['103', '13000.00', 0],
      ['108', '2000.00', 0],
    ]);

    await owner.post('/api/depreciation-runs').send({ month: '2027-01' }).expect(201);
    expect(await closing('213', '2027-01-01', '2027-01-31')).toBe(
      accumulatedDepreciation(furniture, '2027-01'),
    );
    expect(await closing('209', '2027-01-01', '2027-01-31')).toBe(
      accumulatedDepreciation(vehicle, '2027-01'),
    );
  });
});
