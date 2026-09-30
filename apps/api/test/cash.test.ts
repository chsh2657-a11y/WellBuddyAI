import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface DailyAccount {
  code: string;
  opening: number;
  receipts: number;
  payments: number;
  closing: number;
  rows: { counterAccount: string; receipt: number; payment: number; balance: number }[];
}

/**
 * 기초: 현금 100만, 보통예금 500만
 * 3/1  한빛 외상 매출 300만
 * 3/10 한빛 외상대금 보통예금 입금 200만, 복리후생비 현금 5만, 보통예금 → 현금 30만 인출
 */
describe('자금계획·일일자금일보', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let hanbit: string;
  let payrollPlan: string;

  const line = (code: string, debit: number, credit: number, partnerId?: string) => ({
    accountId: acc[code]!,
    debit,
    credit,
    ...(partnerId ? { partnerId } : {}),
  });
  const post = (entryDate: string, lines: object[], status = 'posted') =>
    owner.post('/api/journals').send({ entry: { entryDate, lines }, status }).expect(201);
  const daily = async (date: string) =>
    (await owner.get('/api/reports/daily-cash').query({ date }).expect(200)).body as {
      accounts: DailyAccount[];
      totals: { opening: number; receipts: number; payments: number; closing: number };
      scheduled: { source: string; description: string; direction: string; amount: number }[];
    };
  const plan = async (from: string, to: string) =>
    (await owner.get('/api/reports/cash-plan').query({ from, to }).expect(200)).body as {
      opening: number;
      days: { date: string; inflow: number; outflow: number; balance: number }[];
      closing: number;
      minBalance: number;
      minDate: string | null;
      shortageDate: string | null;
    };

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@cash.local', '자금상사'));
    employee = await inviteAndJoin(app, owner, 'emp@cash.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    hanbit = (await owner.post('/api/partners').send({ name: '한빛상사' }).expect(201)).body.id;
    const fy = (await owner.post('/api/fiscal-years').send({ date: '2026-01-01' }).expect(201)).body
      .id;
    await owner
      .put(`/api/fiscal-years/${fy}/opening-balances`)
      .send({
        lines: [line('101', 1_000_000, 0), line('103', 5_000_000, 0), line('331', 0, 6_000_000)],
      })
      .expect(200);
    await post('2026-03-01', [line('108', 3_000_000, 0, hanbit), line('401', 0, 3_000_000)]);
    await post('2026-03-10', [line('103', 2_000_000, 0), line('108', 0, 2_000_000, hanbit)]);
    await post('2026-03-10', [line('811', 50_000, 0), line('101', 0, 50_000)]);
    await post('2026-03-10', [line('101', 300_000, 0), line('103', 0, 300_000)]);
    // 작성중 전표는 자금일보에 넣지 않는다
    await post('2026-03-10', [line('811', 7_777, 0), line('101', 0, 7_777)], 'draft');
  });

  afterAll(async () => {
    await app.close();
  });

  it('일일자금일보: 계정별 전일 잔액·입금·출금·금일 잔액과 상대 계정', async () => {
    const report = await daily('2026-03-10');
    const byCode = Object.fromEntries(report.accounts.map((a) => [a.code, a]));
    expect(byCode['101']).toMatchObject({
      opening: 1_000_000,
      receipts: 300_000,
      payments: 50_000,
      closing: 1_250_000,
    });
    expect(byCode['103']).toMatchObject({
      opening: 5_000_000,
      receipts: 2_000_000,
      payments: 300_000,
      closing: 6_700_000,
    });
    expect(
      byCode['101']!.rows.map((r) => [r.counterAccount, r.receipt, r.payment, r.balance]),
    ).toEqual([
      ['복리후생비', 0, 50_000, 950_000],
      ['자금 이체', 300_000, 0, 1_250_000],
    ]);
    expect(byCode['103']!.rows[0]!.counterAccount).toBe('외상매출금');
    expect(report.totals).toMatchObject({
      opening: 6_000_000,
      receipts: 2_300_000,
      payments: 350_000,
      closing: 7_950_000,
    });
    // 다음 날 전일 잔액 = 오늘 금일 잔액
    expect((await daily('2026-03-11')).totals.opening).toBe(7_950_000);
    // 회계연도 첫날: 기초잔액은 전일 잔액이고 입금이 아니다
    expect((await daily('2026-01-01')).totals).toMatchObject({
      opening: 6_000_000,
      receipts: 0,
      closing: 6_000_000,
    });
  });

  it('자금계획 항목: 등록·수정·완료·삭제', async () => {
    const create = (body: object) => owner.post('/api/cash-plans').send(body);
    await employee
      .post('/api/cash-plans')
      .send({ planDate: '2026-03-20', direction: 'in', amount: 1, description: 'x' })
      .expect(403);
    await create({ planDate: '2026-03-20', direction: 'in', amount: 0, description: 'x' }).expect(
      400,
    );
    const inflow = (
      await create({
        planDate: '2026-03-20',
        direction: 'in',
        amount: 1_000_000,
        description: '외상대금 회수 예정',
        partnerId: hanbit,
      }).expect(201)
    ).body;
    expect(inflow).toMatchObject({ partnerName: '한빛상사', done: false });
    payrollPlan = (
      await create({
        planDate: '2026-03-25',
        direction: 'out',
        amount: 9_800_000,
        description: '3월 급여',
      }).expect(201)
    ).body.id;
    const done = (
      await create({
        planDate: '2026-03-31',
        direction: 'out',
        amount: 500_000,
        description: '임차료',
      }).expect(201)
    ).body.id;
    await owner.patch(`/api/cash-plans/${done}`).send({ done: true }).expect(200);
    const temp = (
      await create({
        planDate: '2026-03-15',
        direction: 'out',
        amount: 1,
        description: '삭제',
      }).expect(201)
    ).body.id;
    await owner.delete(`/api/cash-plans/${temp}`).expect(204);
    const list = (
      await owner.get('/api/cash-plans').query({ from: '2026-03-01', to: '2026-03-31' }).expect(200)
    ).body;
    expect(list.map((p: { description: string }) => p.description)).toEqual([
      '외상대금 회수 예정',
      '3월 급여',
      '임차료',
    ]);
  });

  it('자금계획: 현재 잔액 + 예정 입출금 + 어음 만기 → 일자별 예상 잔액, 부족한 날', async () => {
    for (const note of [
      { kind: 'receivable', noteNo: 'R-1', dueDate: '2026-03-22', amount: 800_000 },
      { kind: 'payable', noteNo: 'P-1', dueDate: '2026-03-28', amount: 400_000 },
      { kind: 'receivable', noteNo: 'R-LATE', dueDate: '2026-04-30', amount: 1 },
    ]) {
      await owner
        .post('/api/notes')
        .send({ ...note, partnerId: hanbit, issueDate: '2026-03-01', createEntry: false })
        .expect(201);
    }
    const report = await plan('2026-03-11', '2026-03-31');
    expect(report.opening).toBe(7_950_000);
    expect(report.days.map((d) => [d.date, d.inflow, d.outflow, d.balance])).toEqual([
      ['2026-03-20', 1_000_000, 0, 8_950_000],
      ['2026-03-22', 800_000, 0, 9_750_000],
      ['2026-03-25', 0, 9_800_000, -50_000],
      ['2026-03-28', 0, 400_000, -450_000],
    ]);
    expect(report).toMatchObject({
      closing: -450_000,
      minBalance: -450_000,
      minDate: '2026-03-28',
      shortageDate: '2026-03-25',
    });

    // 급여를 처리 완료로 바꾸면 계획에서 빠진다
    await owner.patch(`/api/cash-plans/${payrollPlan}`).send({ done: true }).expect(200);
    const after = await plan('2026-03-11', '2026-03-31');
    expect(after).toMatchObject({ closing: 9_350_000, shortageDate: null });

    const scheduled = (await daily('2026-03-22')).scheduled;
    expect(scheduled).toEqual([
      expect.objectContaining({ source: 'note', direction: 'in', amount: 800_000 }),
    ]);
  });
});
