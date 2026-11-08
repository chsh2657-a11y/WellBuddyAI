import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayInKorea } from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

/**
 * P2-29 단계 완료 기준: 모의 모드로 통장·카드·홈택스를 수집 → 자동분개(자동 전기) → 검토함 승인 →
 * 모든 증빙이 전표와 연결되고 장부가 증빙과 맞는지, 연동 스위치 ON/OFF 가 동작하는지 확인한다.
 * (파일 업로드 방식은 evidence-upload·auto-journal 테스트와 E2E 가 확인한다)
 */
describe('P2 단계 완료 기준(모의 수집 → 자동분개 → 검토 → 전기)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const acc: Record<string, string> = {};
  const to = todayInKorea();
  const from = addDays(to, -29);
  const range = { from, to };
  const collected: Record<string, number> = {};

  interface Journal {
    id: string;
    status: string;
    lines: { accountCode: string; debit: number; credit: number }[];
  }
  interface Evidence {
    id: string;
    status: string;
    entryId: string | null;
  }

  const collect = (channel: string) => owner.post(`/api/evidence/collect/${channel}`).send(range);
  const setChannel = (channel: string, body: object) =>
    owner.put(`/api/integrations/${channel}`).send(body).expect(200);
  const list = async <T>(path: string) =>
    (await owner.get(`/api/evidence/${path}`).query(range).expect(200)).body as (T & Evidence)[];
  const journals = async () => {
    const all: Journal[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = (
        await owner
          .get('/api/journals')
          .query({ ...range, limit: 500, offset })
          .expect(200)
      ).body as { items: Journal[]; total: number };
      all.push(...page.items);
      if (all.length >= page.total || page.items.length === 0) break;
    }
    return new Map(all.map((j) => [j.id, j]));
  };
  const debitTotal = (j: Journal) => j.lines.reduce((s, l) => s + l.debit, 0);

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@p2done.local', '완료기준상사'));
    // 수집 기간이 작년에 걸치면 작년 회계연도도 만든다
    if (from.slice(0, 4) !== to.slice(0, 4)) {
      await owner.post('/api/fiscal-years').send({ date: from }).expect(201);
    }
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    await owner
      .post('/api/bank-accounts')
      .send({
        bankCode: '0004',
        alias: '운영자금',
        accountNo: '12345678901234',
        ledgerAccountId: acc['103'],
      })
      .expect(201);
    await owner
      .post('/api/corporate-cards')
      .send({
        cardCompany: '0306',
        alias: '법인카드',
        cardNo: '4518123456789012',
        ledgerAccountId: acc['253'],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('연동 스위치: 꺼져 있으면 수집하지 않고, 켜면 모의 데이터를 가져오며, 다시 끄고 켜도 이어진다', async () => {
    for (const channel of ['bank', 'card', 'hometax']) {
      expect((await collect(channel).expect(400)).body.code).toBe('CHANNEL_DISABLED');
      await setChannel(channel, { enabled: true, provider: 'mock' });
      const result = (await collect(channel).expect(200)).body;
      expect(result).toMatchObject({ status: 'success', ...range, duplicates: 0 });
      expect(result.inserted, channel).toBeGreaterThan(0);
      collected[channel] = result.inserted;
    }

    // 끄면 막히고, 다시 켜면 이미 가져온 거래는 중복으로 건너뛴다
    await setChannel('bank', { enabled: false, provider: 'mock' });
    expect((await collect('bank').expect(400)).body.code).toBe('CHANNEL_DISABLED');
    const status = (await owner.get('/api/evidence/collect').expect(200)).body as {
      channel: string;
      collectable: boolean;
    }[];
    expect(status.find((s) => s.channel === 'bank')!.collectable).toBe(false);
    await setChannel('bank', { enabled: true, provider: 'mock' });
    expect((await collect('bank').expect(200)).body).toMatchObject({
      inserted: 0,
      duplicates: collected.bank,
    });

    // 파일 업로드 방식으로 바꾸면 자동 수집 대신 파일을 올리라고 안내한다
    await setChannel('bank', { enabled: true, provider: 'file' });
    const file = (await collect('bank').expect(400)).body;
    expect(file.code).toBe('PROVIDER_UNKNOWN');
    expect(file.message).toMatch(/파일을 올려/);
    await setChannel('bank', { enabled: true, provider: 'mock' });
  });

  it('자동 전기를 켜고 실행한 뒤, 남은 거래를 검토함에서 승인하면 모든 증빙이 처리된다', async () => {
    // 회사 규칙(신뢰도 100%)에 맞는 거래는 자동 전기된다: 매월 임대료, 커피
    await owner
      .post('/api/auto-journal/rules')
      .send({ name: '임대료', kinds: ['bank_out'], keywords: '임대료', accountId: acc['819'] })
      .expect(201);
    await owner
      .post('/api/auto-journal/rules')
      .send({ name: '커피', kinds: ['card'], keywords: '스타벅스', accountId: acc['811'] })
      .expect(201);
    await owner
      .put('/api/auto-journal/settings')
      .send({ autoPost: true, threshold: 0.9 })
      .expect(200);
    const summary = (await owner.post('/api/auto-journal/run').expect(200)).body;
    expect(summary.failed).toBe(0);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.posted).toBeGreaterThan(0);
    expect(summary.total).toBe(summary.matched + summary.posted + summary.review);

    // 추천이 없는 거래는 계정을 골라 준다(지급수수료)
    const review = (await owner.get('/api/auto-journal/review').expect(200)).body as {
      evidenceKind: string;
      evidenceId: string;
      accountId: string | null;
    }[];
    expect(review).toHaveLength(summary.review);
    for (const item of review.filter((i) => !i.accountId)) {
      await owner
        .put(`/api/auto-journal/review/${item.evidenceKind}/${item.evidenceId}`)
        .send({ accountId: acc['831'] })
        .expect(204);
    }
    const refs = review.map((i) => ({ evidenceKind: i.evidenceKind, evidenceId: i.evidenceId }));
    for (let i = 0; i < refs.length; i += 200) {
      const result = (
        await owner
          .post('/api/auto-journal/approve')
          .send({ items: refs.slice(i, i + 200) })
          .expect(200)
      ).body;
      expect(result.failed).toEqual([]);
    }
    expect((await owner.get('/api/auto-journal/review').expect(200)).body).toEqual([]);

    // 증빙센터: 처리하지 않은 증빙이 없다
    const center = (await owner.get('/api/evidence/center').query(range).expect(200)).body as {
      total: number;
      counts: { pending: number; review: number; posted: number; matched: number; ignored: number };
    };
    expect(center.counts.pending).toBe(0);
    expect(center.counts.review).toBe(0);
    expect(center.counts.posted).toBeGreaterThan(0);
    expect(center.total).toBe(center.counts.posted + center.counts.matched + center.counts.ignored);
  });

  it('전기한 증빙마다 전기된 전표가 있고, 전표 금액이 증빙 금액과 같으며 장부가 맞는다', async () => {
    const entries = await journals();
    const check = (label: string, e: Evidence, amount: number) => {
      if (e.status !== 'posted') return;
      const journal = entries.get(e.entryId!);
      expect(journal, `${label} ${e.id}`).toBeDefined();
      expect(journal!.status).toBe('posted');
      expect(debitTotal(journal!), `${label} ${e.id}`).toBe(amount);
    };

    const bank = await list<{ deposit: number; withdrawal: number }>('bank-transactions');
    expect(bank.every((t) => t.status === 'posted')).toBe(true);
    for (const t of bank) check('통장', t, t.deposit + t.withdrawal);
    const cards = await list<{ amount: number }>('card-transactions');
    expect(cards.every((t) => t.status === 'posted' || t.status === 'matched')).toBe(true);
    for (const t of cards) check('카드', t, t.amount);
    const invoices = await list<{ totalAmount: number }>('tax-invoices');
    for (const t of invoices) check('세금계산서', t, t.totalAmount);
    const receipts = await list<{ totalAmount: number }>('cash-receipts');
    for (const t of receipts) check('현금영수증', t, t.totalAmount);

    // 보통예금(103) 원장 변동 = 통장 입금 − 출금
    const ledger = (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc['103'], ...range })
        .expect(200)
    ).body as { opening: number; closing: number };
    const net = bank.reduce((s, t) => s + t.deposit - t.withdrawal, 0);
    expect(ledger.closing - ledger.opening).toBe(net);

    // 합계잔액시산표 대차 일치
    const tb = (await owner.get('/api/reports/trial-balance').query({ date: to }).expect(200))
      .body as { balanced: boolean; totals: { debit: number; credit: number } };
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.debit).toBeGreaterThan(0);

    // 모든 자동 전표는 증빙과 이어져 있다(증빙 없는 자동 전표가 없다)
    const linked = new Set(
      [...bank, ...cards, ...invoices, ...receipts].flatMap((e) => (e.entryId ? [e.entryId] : [])),
    );
    expect([...entries.keys()].filter((id) => !linked.has(id))).toEqual([]);
  });

  it('다시 수집하고 다시 실행해도 증빙·전표가 늘지 않는다', async () => {
    const before = (await journals()).size;
    for (const channel of ['bank', 'card', 'hometax']) {
      expect((await collect(channel).expect(200)).body).toMatchObject({
        inserted: 0,
        duplicates: collected[channel],
      });
    }
    const summary = (await owner.post('/api/auto-journal/run').expect(200)).body;
    expect(summary).toMatchObject({ total: 0, posted: 0, review: 0 });
    expect((await journals()).size).toBe(before);
  });
});
