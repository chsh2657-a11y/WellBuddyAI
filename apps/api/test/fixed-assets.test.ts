import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface Asset {
  id: string;
  code: string;
  name: string;
  accumulated: number;
  bookValue: number;
  locked: boolean;
  disposedOn: string | null;
  disposalEntryId: string | null;
}
interface EntryLine {
  accountCode: string;
  debit: number;
  credit: number;
  departmentId: string | null;
  partnerId: string | null;
}

/**
 * 2026 회계연도(1월 시작)
 *  기초: 보통예금 3,000만, 기계장치 6,001,000 / 감가상각누계액(기계장치) 240만(2024년 취득분), 자본금
 *  1/1  차량 1,000만 구입(보통예금)
 *  3/15 비품 1,200만 구입(보통예금)
 */
describe('고정자산·감가상각 자동전표', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let partnerId: string;

  const line = (code: string, debit: number, credit: number) => ({
    accountId: acc[code]!,
    debit,
    credit,
  });
  const ledgerClosing = async (code: string) =>
    (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc[code], from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body.closing as number;
  const entry = async (id: string) =>
    (await owner.get(`/api/journals/${id}`).expect(200)).body as {
      status: string;
      source: string;
      sourceRef: string | null;
      entryDate: string;
      reversedById: string | null;
      lines: EntryLine[];
    };
  const simpleLines = (lines: EntryLine[]) =>
    lines.map((l) => [l.accountCode, l.debit, l.credit]).sort();
  const assets = async () => (await owner.get('/api/fixed-assets').expect(200)).body as Asset[];

  const furniture = () => ({
    name: '사무용 책상 세트',
    assetAccountId: acc['212'],
    accumulatedAccountId: acc['213'],
    expenseAccountId: acc['818'],
    acquisitionDate: '2026-03-15',
    cost: 12_000_000,
    usefulLifeYears: 5,
    method: 'straight_line',
  });
  let furnitureId: string;
  let firstRunEntry: string;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@assets.local', '자산상사'));
    employee = await inviteAndJoin(app, owner, 'emp@assets.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    partnerId = (await owner.post('/api/partners').send({ name: '중고나라상사' }).expect(201)).body
      .id;
    const fy = (await owner.post('/api/fiscal-years').send({ date: '2026-01-01' }).expect(201)).body
      .id;
    await owner
      .put(`/api/fiscal-years/${fy}/opening-balances`)
      .send({
        lines: [
          line('103', 30_000_000, 0),
          line('206', 6_001_000, 0),
          line('207', 0, 2_400_000),
          line('331', 0, 33_601_000),
        ],
      })
      .expect(200);
    for (const [date, code, amount] of [
      ['2026-01-01', '208', 10_000_000],
      ['2026-03-15', '212', 12_000_000],
    ] as const) {
      await owner
        .post('/api/journals')
        .send({
          entry: { entryDate: date, lines: [line(code, amount, 0), line('103', 0, amount)] },
          status: 'posted',
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('등록: 계정 종류·금액을 검사하고 자산코드를 자동으로 붙인다', async () => {
    const wrongKind = await owner
      .post('/api/fixed-assets')
      .send({ ...furniture(), assetAccountId: acc['818'] })
      .expect(400);
    expect(wrongKind.body.code).toBe('ASSET_ACCOUNT_INVALID');
    await owner
      .post('/api/fixed-assets')
      .send({ ...furniture(), residualValue: 12_000_000 })
      .expect(400);
    await employee.post('/api/fixed-assets').send(furniture()).expect(403);

    const created = (await owner.post('/api/fixed-assets').send(furniture()).expect(201))
      .body as Asset;
    expect(created).toMatchObject({
      code: 'FA0001',
      accumulated: 0,
      bookValue: 12_000_000,
      locked: false,
    });
    furnitureId = created.id;

    const schedule = (await owner.get(`/api/fixed-assets/${furnitureId}/schedule`).expect(200))
      .body;
    expect(schedule).toHaveLength(60);
    expect(schedule[0]).toEqual({
      month: '2026-03',
      amount: 199_983,
      accumulated: 199_983,
      bookValue: 11_800_017,
      booked: null,
    });
  });

  it('월 상각: 전기 전표 한 장, 같은 달·이전 달은 다시 못 돌린다', async () => {
    // 취득 전 달은 상각할 자산이 없어 전표 없이 실행만 기록
    expect(
      (await owner.post('/api/depreciation-runs').send({ month: '2026-02' }).expect(201)).body,
    ).toEqual({ month: '2026-02', totalAmount: 0, assets: 0, entryId: null });

    const march = (
      await owner.post('/api/depreciation-runs').send({ month: '2026-03' }).expect(201)
    ).body;
    expect(march).toMatchObject({ month: '2026-03', totalAmount: 199_983, assets: 1 });
    firstRunEntry = march.entryId;
    const e = await entry(firstRunEntry);
    expect(e).toMatchObject({
      status: 'posted',
      source: 'depreciation',
      sourceRef: '2026-03',
      entryDate: '2026-03-31',
    });
    expect(simpleLines(e.lines)).toEqual([
      ['213', 0, 199_983],
      ['818', 199_983, 0],
    ]);

    const again = await owner.post('/api/depreciation-runs').send({ month: '2026-03' }).expect(409);
    expect(again.body.code).toBe('DEPRECIATION_ALREADY_RUN');
    const earlier = await owner
      .post('/api/depreciation-runs')
      .send({ month: '2026-01' })
      .expect(409);
    expect(earlier.body.code).toBe('DEPRECIATION_ORDER');
    await owner.post('/api/depreciation-runs').send({ month: '2026-13' }).expect(400);
    await employee.post('/api/depreciation-runs').send({ month: '2026-04' }).expect(403);
  });

  it('자동 전표는 일반 역분개로 못 되돌리고, 상각한 자산은 취득 정보를 못 바꾼다', async () => {
    const reverse = await owner.post(`/api/journals/${firstRunEntry}/reverse`).send({}).expect(409);
    expect(reverse.body.code).toBe('SYSTEM_ENTRY');

    const locked = await owner
      .patch(`/api/fixed-assets/${furnitureId}`)
      .send({ cost: 13_000_000 })
      .expect(409);
    expect(locked.body.code).toBe('ASSET_LOCKED');
    await owner.delete(`/api/fixed-assets/${furnitureId}`).expect(409);
    const renamed = (
      await owner.patch(`/api/fixed-assets/${furnitureId}`).send({ name: '책상 세트' }).expect(200)
    ).body as Asset;
    expect(renamed).toMatchObject({ name: '책상 세트', locked: true, accumulated: 199_983 });
  });

  it('건너뛴 달은 다음 실행에서 따라잡고, 마지막 실행만 역분개로 취소한다', async () => {
    // 4월을 건너뛰고 5월 실행 → 4·5월분(누계 599,950 − 199,983)
    const may = (await owner.post('/api/depreciation-runs').send({ month: '2026-05' }).expect(201))
      .body;
    expect(may.totalAmount).toBe(399_967);
    expect(await ledgerClosing('213')).toBe(599_950);

    const notLatest = await owner.delete('/api/depreciation-runs/2026-03').expect(409);
    expect(notLatest.body.code).toBe('DEPRECIATION_NOT_LATEST');
    await owner.delete('/api/depreciation-runs/2026-5').expect(400);
    await owner.delete('/api/depreciation-runs/2026-05').expect(204);
    expect(await ledgerClosing('213')).toBe(199_983);
    const cancelled = await entry(may.entryId);
    expect(cancelled.status).toBe('reversed');
    // 취소 전표를 다시 뒤집어 상각을 되살리는 것도 막는다
    const revive = await owner
      .post(`/api/journals/${cancelled.reversedById}/reverse`)
      .send({})
      .expect(409);
    expect(revive.body.code).toBe('SYSTEM_ENTRY');

    const runs = (await owner.get('/api/depreciation-runs').expect(200)).body;
    expect(runs.map((r: { month: string }) => r.month)).toEqual(['2026-03', '2026-02']);

    const redo = (await owner.post('/api/depreciation-runs').send({ month: '2026-05' }).expect(201))
      .body;
    expect(redo.totalAmount).toBe(399_967);
    const schedule = (await owner.get(`/api/fixed-assets/${furnitureId}/schedule`).expect(200))
      .body as { month: string; booked: number | null }[];
    expect(schedule.slice(0, 4).map((m) => m.booked)).toEqual([199_983, null, 399_967, null]);
  });

  it('처분: 누계액·처분대금·처분손익 전표를 만들고 이후 상각에서 빠진다', async () => {
    const noAccount = await owner
      .post(`/api/fixed-assets/${furnitureId}/dispose`)
      .send({ disposedOn: '2026-05-31', proceeds: 11_000_000 })
      .expect(400);
    expect(noAccount.body.code).toBe('PROCEEDS_ACCOUNT_REQUIRED');
    const tooEarly = await owner
      .post(`/api/fixed-assets/${furnitureId}/dispose`)
      .send({ disposedOn: '2026-04-30', proceeds: 0 })
      .expect(400);
    expect(tooEarly.body.code).toBe('DISPOSAL_DATE_INVALID');

    // 장부가 12,000,000 − 599,950 = 11,400,050 을 1,100만에 매각 → 처분손실 400,050
    const disposed = (
      await owner
        .post(`/api/fixed-assets/${furnitureId}/dispose`)
        .send({
          disposedOn: '2026-05-31',
          proceeds: 11_000_000,
          proceedsAccountId: acc['120'],
          partnerId,
        })
        .expect(200)
    ).body as Asset;
    expect(disposed).toMatchObject({ disposedOn: '2026-05-31', accumulated: 599_950 });
    const e = await entry(disposed.disposalEntryId!);
    expect(e).toMatchObject({ status: 'posted', source: 'asset_disposal' });
    expect(simpleLines(e.lines)).toEqual([
      ['120', 11_000_000, 0],
      ['212', 0, 12_000_000],
      ['213', 599_950, 0],
      ['970', 400_050, 0],
    ]);
    expect(await ledgerClosing('212')).toBe(0);
    expect(await ledgerClosing('213')).toBe(0);
    expect(await ledgerClosing('970')).toBe(400_050);

    await owner
      .post(`/api/fixed-assets/${furnitureId}/dispose`)
      .send({ disposedOn: '2026-06-30', proceeds: 0 })
      .expect(409);
    const blocked = await owner.delete('/api/depreciation-runs/2026-05').expect(409);
    expect(blocked.body.code).toBe('DEPRECIATION_LOCKED_BY_DISPOSAL');
  });

  it('정률법·부서별 비용, 이전 상각누계액이 있는 자산도 원장과 누계가 맞는다', async () => {
    const sales = (
      await owner.post('/api/departments').send({ code: 'SALES', name: '영업부' }).expect(201)
    ).body.id as string;
    await owner
      .post('/api/fixed-assets')
      .send({
        name: '영업용 승용차',
        assetAccountId: acc['208'],
        accumulatedAccountId: acc['209'],
        expenseAccountId: acc['818'],
        departmentId: sales,
        acquisitionDate: '2026-01-01',
        cost: 10_000_000,
        usefulLifeYears: 5,
        method: 'declining_balance',
      })
      .expect(201);
    // 2024년 취득, 2년치(240만)는 기초잔액에 이미 들어 있다
    await owner
      .post('/api/fixed-assets')
      .send({
        code: 'M-01',
        name: '포장기계',
        assetAccountId: acc['206'],
        accumulatedAccountId: acc['207'],
        expenseAccountId: acc['818'],
        acquisitionDate: '2024-01-01',
        cost: 6_001_000,
        usefulLifeYears: 5,
        method: 'straight_line',
        priorAccumulated: 2_400_000,
      })
      .expect(201);

    // 차량: 10,000,000 × 0.451 × 6/12 = 2,255,000 / 기계: 누계 3,000,000 − 2,400,000 = 600,000
    const june = (await owner.post('/api/depreciation-runs').send({ month: '2026-06' }).expect(201))
      .body;
    expect(june).toMatchObject({ totalAmount: 2_855_000, assets: 2 });
    const e = await entry(june.entryId);
    expect(
      e.lines
        .filter((l) => l.accountCode === '818')
        .map((l) => [l.departmentId, l.debit])
        .sort(),
    ).toEqual([
      [null, 600_000],
      [sales, 2_255_000],
    ]);

    // 불변식: 누계액 계정 원장 잔액 = 그 계정을 쓰는 (처분 안 한) 자산 누계 합
    const list = await assets();
    const byCode = Object.fromEntries(list.map((a) => [a.code, a]));
    expect(byCode['FA0002']).toMatchObject({ accumulated: 2_255_000, bookValue: 7_745_000 });
    expect(byCode['M-01']).toMatchObject({ accumulated: 3_000_000, bookValue: 3_001_000 });
    expect(await ledgerClosing('209')).toBe(2_255_000);
    expect(await ledgerClosing('207')).toBe(3_000_000);
    expect(await ledgerClosing('213')).toBe(0);
    expect(await ledgerClosing('818')).toBe(599_950 + 2_855_000);

    const tb = (
      await owner.get('/api/reports/trial-balance').query({ date: '2026-12-31' }).expect(200)
    ).body;
    expect(tb.balanced).toBe(true);
  });

  it('마감된 달은 상각을 실행할 수 없다', async () => {
    const years = (await owner.get('/api/fiscal-years').expect(200)).body;
    const july = years.find((y: { label: string }) => y.label === '2026').periods[6];
    await owner.post(`/api/accounting-periods/${july.id}/lock`).expect(200);
    const res = await owner.post('/api/depreciation-runs').send({ month: '2026-07' }).expect(409);
    expect(res.body.code).toBe('PERIOD_LOCKED');
    expect((await owner.get('/api/depreciation-runs').expect(200)).body[0].month).toBe('2026-06');
  });
});
