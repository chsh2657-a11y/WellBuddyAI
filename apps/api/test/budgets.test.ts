import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface ReportLine {
  code: string;
  budget: number;
  budgetToDate: number;
  actualToDate: number;
  variance: number;
  rate: number | null;
  exceeded: boolean;
}

const monthly = (amount: number) => Array.from({ length: 12 }, () => amount);

/**
 * 2025: 매출 3월 100만, 복리후생비(관리부) 3월 10만
 * 2026 예산: 전사 매출 월 200만·복리후생비 월 10만, 영업부 접대비 월 5만
 * 2026 실적: 1월 매출 250만·복리후생비(관리부) 15만, 2월 매출 150만·접대비(영업부) 8만, 3월 접대비(영업부) 3만
 */
describe('예산 편성·예산 대비 실적', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let fy2026: string;
  let sales: string;
  let admin: string;

  const post = (entryDate: string, lines: object[], status = 'posted') =>
    owner.post('/api/journals').send({ entry: { entryDate, lines }, status }).expect(201);
  const report = async (query: Record<string, string | number>) =>
    (
      await owner
        .get('/api/reports/budget-vs-actual')
        .query({ fiscalYearId: fy2026, ...query })
        .expect(200)
    ).body as {
      lines: ReportLine[];
      revenue: { budgetToDate: number; actualToDate: number };
      expense: { budgetToDate: number; actualToDate: number };
      profit: { budget: number; budgetToDate: number; actualToDate: number };
      throughMonth: string;
    };
  const byCode = (lines: ReportLine[]) => Object.fromEntries(lines.map((l) => [l.code, l]));

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@budget.local', '예산상사'));
    employee = await inviteAndJoin(app, owner, 'emp@budget.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    sales = (
      await owner.post('/api/departments').send({ code: 'SALES', name: '영업부' }).expect(201)
    ).body.id;
    admin = (
      await owner.post('/api/departments').send({ code: 'ADMIN', name: '관리부' }).expect(201)
    ).body.id;
    await owner.post('/api/fiscal-years').send({ date: '2025-01-01' }).expect(201);
    fy2026 = (await owner.post('/api/fiscal-years').send({ date: '2026-01-01' }).expect(201)).body
      .id;

    const cash = (amount: number, side: 'debit' | 'credit') => ({
      accountId: acc['101'],
      debit: side === 'debit' ? amount : 0,
      credit: side === 'credit' ? amount : 0,
    });
    const revenue = (amount: number) => ({ accountId: acc['401'], credit: amount });
    const expense = (code: string, amount: number, departmentId?: string) => ({
      accountId: acc[code],
      debit: amount,
      ...(departmentId ? { departmentId } : {}),
    });
    await post('2025-03-10', [cash(1_000_000, 'debit'), revenue(1_000_000)]);
    await post('2025-03-20', [expense('811', 100_000, admin), cash(100_000, 'credit')]);
    await post('2026-01-15', [cash(2_500_000, 'debit'), revenue(2_500_000)]);
    await post('2026-01-20', [expense('811', 150_000, admin), cash(150_000, 'credit')]);
    await post('2026-02-10', [cash(1_500_000, 'debit'), revenue(1_500_000)]);
    await post('2026-02-12', [expense('813', 80_000, sales), cash(80_000, 'credit')]);
    await post('2026-03-05', [expense('813', 30_000, sales), cash(30_000, 'credit')]);
    // 작성중 전표는 실적이 아니다
    await post('2026-02-20', [expense('813', 999_999, sales), cash(999_999, 'credit')], 'draft');
  });

  afterAll(async () => {
    await app.close();
  });

  it('전년도 같은 달 실적을 참고로 불러온다', async () => {
    const suggest = (
      await owner.get('/api/budgets/suggest').query({ fiscalYearId: fy2026 }).expect(200)
    ).body;
    expect(suggest.fiscalYear).toBe('2025');
    const lines = Object.fromEntries(
      (suggest.lines as { code: string; months: number[]; total: number }[]).map((l) => [
        l.code,
        l,
      ]),
    );
    expect(lines['401']!.months[2]).toBe(1_000_000);
    expect(lines['811']!.total).toBe(100_000);
    const adminOnly = (
      await owner
        .get('/api/budgets/suggest')
        .query({ fiscalYearId: fy2026, departmentId: admin })
        .expect(200)
    ).body;
    expect(adminOnly.lines.map((l: { code: string }) => l.code)).toEqual(['811']);
  });

  it('예산 저장: 손익 계정만, 월별 12칸, 부서별로 통째로 바꾼다', async () => {
    const save = (departmentId: string | null, lines: object[]) =>
      owner.put('/api/budgets').send({ fiscalYearId: fy2026, departmentId, lines });
    await employee.put('/api/budgets').send({ fiscalYearId: fy2026, lines: [] }).expect(403);
    const bs = await save(null, [{ accountId: acc['101'], months: monthly(1) }]).expect(400);
    expect(bs.body.code).toBe('BUDGET_ACCOUNT_INVALID');
    await save(null, [{ accountId: acc['401'], months: [1, 2, 3] }]).expect(400);
    const dup = await save(null, [
      { accountId: acc['401'], months: monthly(1) },
      { accountId: acc['401'], months: monthly(2) },
    ]).expect(400);
    expect(dup.body.code).toBe('BUDGET_DUPLICATE_ACCOUNT');

    const company = (
      await save(null, [
        { accountId: acc['401'], months: monthly(2_000_000) },
        { accountId: acc['811'], months: monthly(100_000) },
      ]).expect(200)
    ).body;
    expect(company.lines.map((l: { code: string; total: number }) => [l.code, l.total])).toEqual([
      ['401', 24_000_000],
      ['811', 1_200_000],
    ]);
    expect(company.periods[0]).toEqual({ periodNo: 1, month: '2026-01' });
    await save(sales, [{ accountId: acc['813'], months: monthly(50_000) }]).expect(200);

    const salesBudget = (
      await owner
        .get('/api/budgets')
        .query({ fiscalYearId: fy2026, departmentId: sales })
        .expect(200)
    ).body;
    expect(salesBudget.lines).toHaveLength(1);
    const companyBudget = (
      await owner.get('/api/budgets').query({ fiscalYearId: fy2026 }).expect(200)
    ).body;
    expect(companyBudget.lines).toHaveLength(2);
  });

  it('예산 대비 실적: 누계 예산·실적·집행률, 전사는 모든 부서 합계', async () => {
    const feb = await report({ throughPeriod: 2 });
    expect(feb.throughMonth).toBe('2026-02');
    const rows = byCode(feb.lines);
    expect(rows['401']).toMatchObject({
      budget: 24_000_000,
      budgetToDate: 4_000_000,
      actualToDate: 4_000_000,
      rate: 100,
    });
    expect(rows['811']).toMatchObject({
      budgetToDate: 200_000,
      actualToDate: 150_000,
      variance: 50_000,
      rate: 75,
      exceeded: false,
    });
    expect(rows['813']).toMatchObject({ budgetToDate: 100_000, actualToDate: 80_000, rate: 80 });
    expect(feb.lines.map((l) => l.code)).toEqual(['401', '811', '813']);
    expect(feb.expense).toMatchObject({ budgetToDate: 300_000, actualToDate: 230_000 });
    expect(feb.profit).toMatchObject({
      budget: 24_000_000 - 1_800_000,
      budgetToDate: 3_700_000,
      actualToDate: 3_770_000,
    });

    // 1월만 보면 복리후생비 초과
    const jan = byCode((await report({ throughPeriod: 1 })).lines);
    expect(jan['811']).toMatchObject({ variance: -50_000, exceeded: true, rate: 150 });
  });

  it('부서를 고르면 그 부서 예산과 그 부서 전표만 본다', async () => {
    const salesReport = await report({ departmentId: sales, throughPeriod: 3 });
    expect(salesReport.lines.map((l) => l.code)).toEqual(['813']);
    expect(salesReport.lines[0]).toMatchObject({
      budgetToDate: 150_000,
      actualToDate: 110_000,
    });
    const adminReport = await report({ departmentId: admin });
    expect(adminReport.lines.map((l) => [l.code, l.budget, l.actualToDate])).toEqual([
      ['811', 0, 150_000],
    ]);
    expect(adminReport.lines[0]!.rate).toBeNull();
  });
});
