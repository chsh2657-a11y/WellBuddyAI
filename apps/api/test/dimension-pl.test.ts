import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

interface DimensionPl {
  columns: { id: string | null; name: string }[];
  lines: { code: string; amounts: number[]; total: number }[];
  revenue: number[];
  expense: number[];
  profit: number[];
  totals: { revenue: number; expense: number; profit: number };
}

/**
 * 2026: 매출 100만(영업부·P1), 매출 50만(미지정), 복리후생비 10만(관리부), 접대비 5만(영업부·P1),
 * 복리후생비 2만(미지정), 작성중 접대비 99만(영업부, 제외)
 */
describe('부서·프로젝트별 손익', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const acc: Record<string, string> = {};
  let sales: string;
  let admin: string;
  let p1: string;

  const report = async (dimension: string, from = '2026-01-01', to = '2026-12-31') =>
    (await owner.get('/api/reports/dimension-pl').query({ from, to, dimension }).expect(200))
      .body as DimensionPl;
  const amounts = (r: DimensionPl) => Object.fromEntries(r.lines.map((l) => [l.code, l.amounts]));

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@dim.local', '부서상사'));
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    sales = (await owner.post('/api/departments').send({ code: 'S', name: '영업부' }).expect(201))
      .body.id;
    admin = (await owner.post('/api/departments').send({ code: 'A', name: '관리부' }).expect(201))
      .body.id;
    p1 = (await owner.post('/api/projects').send({ code: 'P1', name: '신제품' }).expect(201)).body
      .id;
    const post = (entryDate: string, lines: object[], status = 'posted') =>
      owner.post('/api/journals').send({ entry: { entryDate, lines }, status }).expect(201);
    const cash = (debit: number, credit: number) => ({ accountId: acc['101'], debit, credit });
    await post('2026-02-01', [
      cash(1_000_000, 0),
      { accountId: acc['401'], credit: 1_000_000, departmentId: sales, projectId: p1 },
    ]);
    await post('2026-02-02', [cash(500_000, 0), { accountId: acc['401'], credit: 500_000 }]);
    await post('2026-02-03', [
      { accountId: acc['811'], debit: 100_000, departmentId: admin },
      cash(0, 100_000),
    ]);
    await post('2026-02-04', [
      { accountId: acc['813'], debit: 50_000, departmentId: sales, projectId: p1 },
      cash(0, 50_000),
    ]);
    await post('2026-02-05', [{ accountId: acc['811'], debit: 20_000 }, cash(0, 20_000)]);
    await post(
      '2026-02-06',
      [{ accountId: acc['813'], debit: 990_000, departmentId: sales }, cash(0, 990_000)],
      'draft',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('부서별: 부서 코드순 열과 미지정 열, 수익·비용·손익', async () => {
    const r = await report('department');
    expect(r.columns.map((c) => c.name)).toEqual(['관리부', '영업부', '미지정']);
    expect(amounts(r)).toEqual({
      '401': [0, 1_000_000, 500_000],
      '811': [100_000, 0, 20_000],
      '813': [0, 50_000, 0],
    });
    expect(r.lines.map((l) => l.code)).toEqual(['401', '811', '813']);
    expect(r.profit).toEqual([-100_000, 950_000, 480_000]);
    expect(r.totals).toEqual({ revenue: 1_500_000, expense: 170_000, profit: 1_330_000 });
  });

  it('프로젝트별, 열 합계 = 손익계산서 당기순이익', async () => {
    const r = await report('project');
    expect(r.columns.map((c) => c.name)).toEqual(['신제품', '미지정']);
    expect(r.profit).toEqual([950_000, 380_000]);
    const is = (
      await owner
        .get('/api/reports/income-statement')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body;
    expect(r.totals.profit).toBe(is.netIncome);
    expect((await report('department')).totals.profit).toBe(is.netIncome);
  });

  it('기간은 한 회계연도 안이어야 한다', async () => {
    await owner.post('/api/fiscal-years').send({ date: '2025-06-01' }).expect(201);
    const res = await owner
      .get('/api/reports/dimension-pl')
      .query({ from: '2025-12-01', to: '2026-01-31', dimension: 'department' })
      .expect(400);
    expect(res.body.code).toBe('RANGE_SPANS_FISCAL_YEARS');
    expect((await report('department', '2026-03-01', '2026-03-31')).columns).toEqual([]);
  });
});
