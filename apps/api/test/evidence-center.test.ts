import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayInKorea } from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));
const today = todayInKorea();
const d = (n: number) => addDays(today, -n);

interface Group {
  ledgerAccount: string;
  bankBalance: number | null;
  ledgerBalance: number;
  unreflected: number;
  unreflectedCount: number;
  difference: number | null;
  status: string;
  accounts: { alias: string; balance: number | null; balanceDate: string | null }[];
}

describe('통장 잔액 대사(P2-26)·증빙센터(P2-28)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let other: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let bankId: string;

  const reconcile = async (date?: string) =>
    (
      await owner
        .get('/api/evidence/reconciliation')
        .query(date ? { date } : {})
        .expect(200)
    ).body as { date: string; groups: Group[] };
  const center = async (query: object = {}) =>
    (await owner.get('/api/evidence/center').query(query).expect(200)).body;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@center.local', '대사상사'));
    ({ agent: other } = await ownerWithCompany(app, 'other@center.local', '다른회사'));
    employee = await inviteAndJoin(app, owner, 'emp@center.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    bankId = (
      await owner
        .post('/api/bank-accounts')
        .send({
          bankCode: '0004',
          alias: '운영자금',
          accountNo: '12345678901234',
          ledgerAccountId: acc['103'],
        })
        .expect(201)
    ).body.id;
    await owner.post('/api/partners').send({ name: '(주)한빛상사' }).expect(201);
    await owner
      .post('/api/evidence/uploads/commit')
      .field('options', JSON.stringify({ kind: 'bank', sourceId: bankId }))
      .attach(
        'file',
        csv([
          ['거래일시', '적요', '보낸분/받는분', '출금액(원)', '입금액(원)', '잔액(원)'],
          [`${d(5)} 09:00:00`, '타행입금', '(주)한빛상사', '0', '"1,000,000"', '"1,000,000"'],
          [`${d(4)} 09:00:00`, '임대료', '(주)강남빌딩', '"300,000"', '0', '"700,000"'],
          [`${d(3)} 09:00:00`, '개인사용', '편의점', '"50,000"', '0', '"650,000"'],
        ]),
        'bank.csv',
      )
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('분개 전에는 통장 잔액이 모두 미반영 거래로 설명되어 일치한다', async () => {
    const { date, groups } = await reconcile();
    expect(date).toBe(today);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      ledgerAccount: '103 보통예금',
      bankBalance: 650_000,
      ledgerBalance: 0,
      unreflected: 650_000,
      unreflectedCount: 3,
      difference: 0,
      status: 'matched',
    });
    expect(groups[0]!.accounts[0]).toMatchObject({
      alias: '운영자금',
      balance: 650_000,
      balanceDate: d(3),
    });
    // 첫 거래 전 날짜: 통장 잔액을 알 수 없다
    expect((await reconcile(d(6))).groups[0]).toMatchObject({
      bankBalance: null,
      difference: null,
      status: 'unknown',
    });
    // 중간 날짜: 그날까지의 마지막 잔액
    expect((await reconcile(d(4))).groups[0]).toMatchObject({
      bankBalance: 700_000,
      difference: 0,
    });
  });

  it('전표로 옮기면 장부 잔액이 바뀌고, 통장에 없는 수기 전표는 불일치로 드러난다', async () => {
    await owner.post('/api/auto-journal/run').expect(200);
    const review = (await owner.get('/api/auto-journal/review').expect(200)).body as {
      evidenceKind: string;
      evidenceId: string;
      description: string;
    }[];
    const pick = (text: string) => review.find((r) => r.description === text)!;
    const approved = (
      await owner
        .post('/api/auto-journal/approve')
        .send({
          items: [pick('타행입금'), pick('임대료')].map((r) => ({
            evidenceKind: r.evidenceKind,
            evidenceId: r.evidenceId,
          })),
        })
        .expect(200)
    ).body;
    expect(approved.failed).toEqual([]);
    await owner
      .patch(`/api/evidence/bank/${pick('개인사용').evidenceId}/status`)
      .send({ status: 'ignored' })
      .expect(204);

    expect((await reconcile()).groups[0]).toMatchObject({
      bankBalance: 650_000,
      ledgerBalance: 700_000,
      unreflected: -50_000,
      unreflectedCount: 1,
      difference: 0,
      status: 'matched',
    });

    // 통장에 없는 입금을 손으로 전기하면 차이가 생긴다
    await owner
      .post('/api/journals')
      .send({
        entry: {
          entryDate: d(2),
          lines: [
            { accountId: acc['103'], debit: 100_000, credit: 0 },
            { accountId: acc['101'], debit: 0, credit: 100_000 },
          ],
        },
        status: 'posted',
      })
      .expect(201);
    expect((await reconcile()).groups[0]).toMatchObject({
      ledgerBalance: 800_000,
      difference: -100_000,
      status: 'mismatch',
    });
    // 수기 전표 전날 기준으로는 여전히 일치
    expect((await reconcile(d(3))).groups[0]).toMatchObject({
      ledgerBalance: 700_000,
      status: 'matched',
    });
  });

  it('증빙센터: 모든 증빙을 한 목록으로, 상태별 건수·필터·검색', async () => {
    const all = await center();
    expect(all).toMatchObject({
      total: 3,
      counts: { pending: 0, review: 0, posted: 2, ignored: 1, matched: 0 },
      truncated: false,
    });
    expect(all.items.map((i: { date: string }) => i.date)).toEqual([d(3), d(4), d(5)]);
    const rent = all.items.find((i: { description: string }) => i.description === '임대료');
    expect(rent).toMatchObject({
      evidenceKind: 'bank',
      kindLabel: '통장 출금',
      counterparty: '(주)강남빌딩',
      sourceLabel: '운영자금',
      flow: 'out',
      amount: 300_000,
      status: 'posted',
      account: '819 지급임차료',
    });
    expect(rent.entryNumber).toMatch(new RegExp(`^${d(4)}-\\d+$`));

    const posted = await center({ status: 'posted' });
    expect(posted.items).toHaveLength(2);
    // 상태 조건과 상관없이 건수는 전체 기준
    expect(posted.counts.ignored).toBe(1);
    expect((await center({ q: '강남' })).items).toHaveLength(1);
    expect((await center({ q: '100%' })).items).toHaveLength(0);
    expect((await center({ kind: 'card' })).total).toBe(0);
    expect((await center({ from: d(4), to: d(4) })).items).toHaveLength(1);
    await owner.get('/api/evidence/center').query({ status: 'nope' }).expect(400);
  });

  it('다른 회사에는 보이지 않고, 권한이 없으면 볼 수 없다', async () => {
    expect((await other.get('/api/evidence/center').expect(200)).body.total).toBe(0);
    expect((await other.get('/api/evidence/reconciliation').expect(200)).body.groups).toEqual([]);
    await employee.get('/api/evidence/center').expect(403);
    await employee.get('/api/evidence/reconciliation').expect(403);
  });
});
