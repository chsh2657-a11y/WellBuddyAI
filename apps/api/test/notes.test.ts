import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface Note {
  id: string;
  noteNo: string;
  status: string;
  statusDate: string | null;
  endorsedToName: string | null;
  events: {
    action: string;
    entryId: string | null;
    entryNumber: string | null;
    detail: Record<string, unknown>;
  }[];
}

/**
 * 2026 회계연도
 *  기초: 현금 1,000만, 자본금 1,000만
 *  3/1 한빛에 외상 매출 500만, 누리에서 외상 매입 300만
 *  받을어음(한빛): R-001 200만 만기 결제, R-002 100만 할인, R-003 50만 누리에 배서, R-004 80만 부도
 *  지급어음(누리): P-001 150만 발행 → 만기 결제
 */
describe('받을어음·지급어음', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let hanbit: string;
  let nuri: string;
  const ids: Record<string, string> = {};

  const line = (code: string, debit: number, credit: number, partnerId?: string) => ({
    accountId: acc[code]!,
    debit,
    credit,
    ...(partnerId ? { partnerId } : {}),
  });
  const closing = async (code: string, partnerId?: string) =>
    (
      await owner
        .get('/api/reports/account-ledger')
        .query({
          accountId: acc[code],
          from: '2026-01-01',
          to: '2026-12-31',
          ...(partnerId ? { partnerId } : {}),
        })
        .expect(200)
    ).body.closing as number;
  const entryLines = async (id: string) =>
    (
      (await owner.get(`/api/journals/${id}`).expect(200)).body.lines as {
        accountCode: string;
        debit: number;
        credit: number;
      }[]
    )
      .map((l) => [l.accountCode, l.debit, l.credit])
      .sort();
  const register = (noteNo: string, amount: number, dueDate: string, extra: object = {}) =>
    owner.post('/api/notes').send({
      kind: 'receivable',
      noteNo,
      partnerId: hanbit,
      issueDate: '2026-03-05',
      dueDate,
      amount,
      bank: '국민은행 역삼',
      ...extra,
    });
  const holdingReceivables = async () =>
    (
      (await owner.get('/api/notes').query({ kind: 'receivable', status: 'holding' }).expect(200))
        .body as { amount: number }[]
    ).reduce((s, n) => s + n.amount, 0);

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@notes.local', '어음상사'));
    employee = await inviteAndJoin(app, owner, 'emp@notes.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    hanbit = (await owner.post('/api/partners').send({ name: '한빛상사' }).expect(201)).body.id;
    nuri = (await owner.post('/api/partners').send({ name: '누리유통' }).expect(201)).body.id;
    const fy = (await owner.post('/api/fiscal-years').send({ date: '2026-01-01' }).expect(201)).body
      .id;
    await owner
      .put(`/api/fiscal-years/${fy}/opening-balances`)
      .send({ lines: [line('101', 10_000_000, 0), line('331', 0, 10_000_000)] })
      .expect(200);
    for (const lines of [
      [line('108', 5_000_000, 0, hanbit), line('401', 0, 5_000_000)],
      [line('146', 3_000_000, 0), line('251', 0, 3_000_000, nuri)],
    ]) {
      await owner
        .post('/api/journals')
        .send({ entry: { entryDate: '2026-03-01', lines }, status: 'posted' })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('수취: 받을어음 / 외상매출금 전표를 전기하고 대장에 올린다', async () => {
    await employee.post('/api/notes').send({}).expect(403);
    const invalid = await register('R-000', 1_000, '2026-03-01').expect(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');

    const r1 = (await register('R-001', 2_000_000, '2026-06-05').expect(201)).body as Note;
    ids['R-001'] = r1.id;
    expect(r1).toMatchObject({ status: 'holding', statusDate: null });
    expect(r1.events).toHaveLength(1);
    expect(await entryLines(r1.events[0]!.entryId!)).toEqual([
      ['108', 0, 2_000_000],
      ['110', 2_000_000, 0],
    ]);
    const dup = await register('R-001', 1, '2026-06-05').expect(409);
    expect(dup.body.code).toBe('DUPLICATE_NOTE_NO');

    for (const [no, amount, due] of [
      ['R-002', 1_000_000, '2026-04-30'],
      ['R-003', 500_000, '2026-05-31'],
      ['R-004', 800_000, '2026-07-31'],
    ] as const) {
      ids[no] = ((await register(no, amount, due).expect(201)).body as Note).id;
    }
    expect(await closing('110')).toBe(4_300_000);
    expect(await closing('108', hanbit)).toBe(700_000);
    expect(await holdingReceivables()).toBe(await closing('110'));

    // 자동 전표는 전표조회의 역분개로 되돌릴 수 없다
    const reverse = await owner
      .post(`/api/journals/${r1.events[0]!.entryId}/reverse`)
      .send({})
      .expect(409);
    expect(reverse.body.code).toBe('SYSTEM_ENTRY');

    const due = (
      await owner.get('/api/notes').query({ kind: 'receivable', dueTo: '2026-05-31' }).expect(200)
    ).body as Note[];
    expect(due.map((n) => n.noteNo)).toEqual(['R-002', 'R-003']);
  });

  it('만기 결제·할인·배서·부도: 상태와 전표, 받을어음 잔액 = 보유 어음 합계', async () => {
    const settled = (
      await owner
        .post(`/api/notes/${ids['R-001']}/settle`)
        .send({ date: '2026-06-05', accountId: acc['103'] })
        .expect(200)
    ).body as Note;
    expect(settled).toMatchObject({ status: 'settled', statusDate: '2026-06-05' });
    expect(await entryLines(settled.events[1]!.entryId!)).toEqual([
      ['103', 2_000_000, 0],
      ['110', 0, 2_000_000],
    ]);

    // 3/31 할인, 만기 4/30 → 30일, 연 12%: 1,000,000 × 12% × 30/365 = 9,863(원 미만 절사)
    const discounted = (
      await owner
        .post(`/api/notes/${ids['R-002']}/discount`)
        .send({ date: '2026-03-31', annualRate: 12, accountId: acc['103'] })
        .expect(200)
    ).body as Note;
    expect(discounted.status).toBe('discounted');
    expect(discounted.events[1]!.detail).toMatchObject({ days: 30, charge: 9_863 });
    expect(await entryLines(discounted.events[1]!.entryId!)).toEqual([
      ['103', 990_137, 0],
      ['110', 0, 1_000_000],
      ['956', 9_863, 0],
    ]);

    const endorsed = (
      await owner
        .post(`/api/notes/${ids['R-003']}/endorse`)
        .send({ date: '2026-04-10', toPartnerId: nuri })
        .expect(200)
    ).body as Note;
    expect(endorsed).toMatchObject({ status: 'endorsed', endorsedToName: '누리유통' });
    expect(await closing('251', nuri)).toBe(2_500_000);

    const dishonored = (
      await owner
        .post(`/api/notes/${ids['R-004']}/dishonor`)
        .send({ date: '2026-07-31' })
        .expect(200)
    ).body as Note;
    expect(dishonored.status).toBe('dishonored');
    expect(await closing('246', hanbit)).toBe(800_000);

    expect(await closing('110')).toBe(0);
    expect(await holdingReceivables()).toBe(0);
    expect(await closing('956')).toBe(9_863);

    const again = await owner
      .post(`/api/notes/${ids['R-001']}/settle`)
      .send({ date: '2026-06-06', accountId: acc['103'] })
      .expect(409);
    expect(again.body.code).toBe('NOTE_NOT_HOLDING');
  });

  it('지급어음: 발행 → 만기 결제, 받을어음 전용 처리는 막는다', async () => {
    const p1 = (
      await owner
        .post('/api/notes')
        .send({
          kind: 'payable',
          noteNo: 'P-001',
          partnerId: nuri,
          issueDate: '2026-04-01',
          dueDate: '2026-07-01',
          amount: 1_500_000,
        })
        .expect(201)
    ).body as Note;
    expect(await entryLines(p1.events[0]!.entryId!)).toEqual([
      ['251', 1_500_000, 0],
      ['252', 0, 1_500_000],
    ]);
    expect(await closing('251', nuri)).toBe(1_000_000);
    const discount = await owner
      .post(`/api/notes/${p1.id}/discount`)
      .send({ date: '2026-05-01', annualRate: 10, accountId: acc['103'] })
      .expect(400);
    expect(discount.body.code).toBe('NOTE_ACTION_INVALID');

    const paid = (
      await owner
        .post(`/api/notes/${p1.id}/settle`)
        .send({ date: '2026-07-01', accountId: acc['103'] })
        .expect(200)
    ).body as Note;
    expect(await entryLines(paid.events[1]!.entryId!)).toEqual([
      ['103', 0, 1_500_000],
      ['252', 1_500_000, 0],
    ]);
    expect(await closing('252')).toBe(0);
  });

  it('마지막 처리 취소: 역분개하고 상태를 되돌리며, 등록만 남으면 어음을 지운다', async () => {
    const undone = (await owner.post(`/api/notes/${ids['R-004']}/undo`).expect(200)).body as {
      note: Note;
    };
    expect(undone.note).toMatchObject({ status: 'holding', statusDate: null });
    expect(undone.note.events).toHaveLength(1);
    expect(await closing('246', hanbit)).toBe(0);
    expect(await closing('110')).toBe(800_000);
    expect(await holdingReceivables()).toBe(800_000);

    const removed = (await owner.post(`/api/notes/${ids['R-004']}/undo`).expect(200)).body;
    expect(removed).toEqual({ note: null });
    await owner.get(`/api/notes/${ids['R-004']}`).expect(404);
    expect(await closing('110')).toBe(0);
    expect(await closing('108', hanbit)).toBe(1_500_000);

    // 배서 취소 → 배서 상대도 지운다
    const unendorsed = (await owner.post(`/api/notes/${ids['R-003']}/undo`).expect(200)).body as {
      note: Note;
    };
    expect(unendorsed.note).toMatchObject({ status: 'holding', endorsedToName: null });
  });

  it('기초잔액에 이미 있는 어음은 전표 없이 대장에만 올린다', async () => {
    const opening = (
      await register('R-OLD', 300_000, '2026-02-28', {
        issueDate: '2025-12-01',
        createEntry: false,
      }).expect(201)
    ).body as Note;
    expect(opening.events[0]).toMatchObject({ action: 'register', entryId: null });
    expect(await closing('110')).toBe(500_000);

    const tb = (
      await owner.get('/api/reports/trial-balance').query({ date: '2026-12-31' }).expect(200)
    ).body;
    expect(tb.balanced).toBe(true);
  });
});
