import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayInKorea } from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import {
  bizNo,
  type CardProvider,
  MockBankProvider,
  MockCardProvider,
  MockHometaxProvider,
  ProviderRegistry,
} from '@wellbuddy/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

const MARCH = { from: '2025-03-01', to: '2025-03-31' };

describe('자동 수집(모의 공급자)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let other: Agent;
  let employee: Agent;
  let companyId: string;
  const acc: Record<string, string> = {};
  let bankId: string;
  let cardId: string;

  const collect = (agent: Agent, channel: string, body: object = {}) =>
    agent.post(`/api/evidence/collect/${channel}`).send(body);
  const useMock = (channel: string, provider = 'mock', enabled = true) =>
    owner.put(`/api/integrations/${channel}`).send({ enabled, provider }).expect(200);

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner, companyId } = await ownerWithCompany(app, 'owner@col.local', '수집상사'));
    ({ agent: other } = await ownerWithCompany(app, 'other@col.local', '다른회사'));
    employee = await inviteAndJoin(app, owner, 'emp@col.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('꺼진 채널·파일 업로드 방식·등록한 계좌가 없으면 수집하지 않는다', async () => {
    const status = (await owner.get('/api/evidence/collect').expect(200)).body;
    expect(status.map((s: { channel: string }) => s.channel)).toEqual(['bank', 'card', 'hometax']);
    expect(status[0]).toMatchObject({ provider: 'file', enabled: false, collectable: false });

    expect((await collect(owner, 'bank').expect(400)).body.code).toBe('CHANNEL_DISABLED');
    await useMock('bank', 'file');
    const file = await collect(owner, 'bank').expect(400);
    expect(file.body).toMatchObject({ code: 'PROVIDER_UNKNOWN' });
    expect(file.body.message).toMatch(/파일을 올려/);

    await useMock('bank');
    expect((await collect(owner, 'bank').expect(400)).body.code).toBe('NO_SOURCES');
    await collect(owner, 'nope').expect(400);
    // 수집 실행 기록은 남기지 않는다
    expect((await owner.get('/api/evidence/runs').expect(200)).body).toEqual([]);
  });

  it('통장: 모의 거래를 가져오고, 겹치는 기간은 중복으로 건너뛴다', async () => {
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
    await collect(employee, 'bank', MARCH).expect(403);

    const mock = new MockBankProvider();
    const ref = { id: bankId, bankCode: '0004', accountNo: '12345678901234' };
    const expected = await mock.fetchTransactions(ref, MARCH);
    const first = (await collect(owner, 'bank', MARCH).expect(200)).body;
    expect(first).toMatchObject({
      status: 'success',
      ...MARCH,
      fetched: expected.length,
      inserted: expected.length,
      duplicates: 0,
    });
    expect(first.message).toContain('계좌 1개');

    const list = (await owner.get('/api/evidence/bank-transactions').expect(200)).body;
    expect(list).toHaveLength(expected.length);
    expect(list.every((t: { source: string }) => t.source === 'mock')).toBe(true);
    const deposits = list.reduce((s: number, t: { deposit: number }) => s + t.deposit, 0);
    expect(deposits).toBe(expected.reduce((s, r) => s + r.deposit, 0));
    const last = expected.at(-1)!;
    expect(list[0]).toMatchObject({ txDate: last.date, balance: last.balance });

    const overlap = { from: '2025-03-15', to: '2025-04-10' };
    const april = await mock.fetchTransactions(ref, overlap);
    const repeated = expected.filter((r) => r.date >= '2025-03-15').length;
    const second = (await collect(owner, 'bank', overlap).expect(200)).body;
    expect(second).toMatchObject({
      fetched: april.length,
      duplicates: repeated,
      inserted: april.length - repeated,
    });

    const runs = (await owner.get('/api/evidence/runs').expect(200)).body;
    expect(runs[0]).toMatchObject({
      channel: 'bank',
      provider: 'mock',
      trigger: 'manual',
      status: 'success',
      duplicates: repeated,
    });
    const [bank] = (await owner.get('/api/evidence/collect').expect(200)).body;
    expect(bank).toMatchObject({ collectable: true, providerLabel: '모의 데이터' });
    expect(bank.lastStatus).toBe('success');
    expect(bank.lastMessage).toBe(second.message);

    // 다른 회사에는 보이지 않는다
    expect((await other.get('/api/evidence/bank-transactions').expect(200)).body).toEqual([]);
  });

  it('기간: 비우면 최근 30일, 오늘을 넘지 않고, 92일을 넘으면 나눠 달라고 한다', async () => {
    const today = todayInKorea();
    const recent = (await collect(owner, 'bank').expect(200)).body;
    expect(recent).toMatchObject({ from: addDays(today, -29), to: today });
    const future = (
      await collect(owner, 'bank', { from: addDays(today, -1), to: addDays(today, 10) }).expect(200)
    ).body;
    expect(future.to).toBe(today);

    const long = await collect(owner, 'bank', { from: '2025-01-01', to: '2025-04-30' }).expect(400);
    expect(long.body.code).toBe('RANGE_TOO_LONG');
    const reversed = await collect(owner, 'bank', { from: '2025-03-10', to: '2025-03-01' });
    expect(reversed.status).toBe(400);
    expect(reversed.body.code).toBe('VALIDATION_ERROR');
  });

  it('카드: 승인·취소를 가져오고, 공급자가 실패하면 이력에 남기고 알려 준다', async () => {
    cardId = (
      await owner
        .post('/api/corporate-cards')
        .send({
          cardCompany: '0306',
          alias: '법인카드',
          cardNo: '4518123456789012',
          ledgerAccountId: acc['253'],
        })
        .expect(201)
    ).body.id;
    await useMock('card');
    const expected = await new MockCardProvider().fetchApprovals(
      { id: cardId, cardCompany: '0306', cardNo: '4518123456789012' },
      MARCH,
    );
    const done = (await collect(owner, 'card', MARCH).expect(200)).body;
    expect(done).toMatchObject({ inserted: expected.length, duplicates: 0 });
    const list = (await owner.get('/api/evidence/card-transactions').expect(200)).body;
    expect(list).toHaveLength(expected.length);
    expect(list.filter((c: { cancelled: boolean }) => c.cancelled)).toHaveLength(
      expected.filter((c) => c.cancelled).length,
    );

    // 카드사 점검 중
    const registry = app.get(ProviderRegistry);
    const broken: CardProvider = {
      testConnection: async () => ({ ok: false, message: '점검' }),
      fetchApprovals: async () => {
        throw new Error('카드사 점검 중입니다');
      },
    };
    registry.register('card', 'mock', () => broken);
    try {
      const failed = await collect(owner, 'card', MARCH).expect(502);
      expect(failed.body.code).toBe('COLLECTION_FAILED');
      expect(failed.body.message).toContain('카드사 점검 중입니다');
      const [run] = (await owner.get('/api/evidence/runs').expect(200)).body;
      expect(run).toMatchObject({ channel: 'card', status: 'error', inserted: 0 });
      expect(run.finishedAt).not.toBeNull();
      const card = (await owner.get('/api/evidence/collect').expect(200)).body[1];
      expect(card).toMatchObject({ lastStatus: 'error' });
    } finally {
      registry.register('card', 'mock', () => new MockCardProvider());
    }
    // 실패한 수집은 아무것도 저장하지 않았다
    expect((await owner.get('/api/evidence/card-transactions').expect(200)).body).toHaveLength(
      expected.length,
    );
  });

  it('홈택스: 우리 사업자번호로 매출·매입이 갈리고, 등록한 거래처와 연결된다', async () => {
    const customer = { name: '(주)한빛상사', bizRegNo: bizNo('220811234') };
    await owner.post('/api/partners').send(customer).expect(201);
    await useMock('hometax');
    const range = { from: '2025-01-01', to: '2025-03-31' };
    const mock = new MockHometaxProvider({
      companyId,
      companyName: '수집상사',
      bizNo: '0000000000',
    });
    const sales = await mock.fetchTaxInvoices('sales', range);
    const purchases = await mock.fetchTaxInvoices('purchase', range);
    const receipts = [
      ...(await mock.fetchCashReceipts('sales', range)),
      ...(await mock.fetchCashReceipts('purchase', range)),
    ];
    const done = (await collect(owner, 'hometax', range).expect(200)).body;
    expect(done).toMatchObject({
      inserted: sales.length + purchases.length + receipts.length,
      duplicates: 0,
    });
    expect(done.message).toContain(`세금계산서 ${sales.length + purchases.length}건`);

    const invoices = (await owner.get('/api/evidence/tax-invoices').expect(200)).body as {
      direction: string;
      supplierName: string;
      buyerBizNo: string;
      partnerName: string | null;
    }[];
    expect(invoices.filter((i) => i.direction === 'sales')).toHaveLength(sales.length);
    expect(
      invoices.filter((i) => i.direction === 'sales').every((i) => i.supplierName === '수집상사'),
    ).toBe(true);
    const toCustomer = invoices.filter((i) => i.buyerBizNo === customer.bizRegNo);
    expect(toCustomer.length).toBe(sales.filter((s) => s.buyerBizNo === customer.bizRegNo).length);
    expect(toCustomer.every((i) => i.partnerName === customer.name)).toBe(true);
    expect(
      invoices.filter((i) => i.buyerBizNo !== customer.bizRegNo && i.direction === 'sales'),
    ).toSatisfy((rest: { partnerName: string | null }[]) => rest.every((i) => !i.partnerName));
    const cash = (await owner.get('/api/evidence/cash-receipts').expect(200)).body;
    expect(cash).toHaveLength(receipts.length);

    // 다시 수집하면 모두 중복
    const again = (await collect(owner, 'hometax', range).expect(200)).body;
    expect(again).toMatchObject({ inserted: 0, duplicates: done.inserted });
  });
  it('홈택스 카드매입은 카드 승인과 대조해 가맹점 사업자번호·부가세를 채운다', async () => {
    // 카드사 파일에는 사업자번호·부가세가 없다
    const file = Buffer.from(
      [
        '승인일자,승인시간,가맹점명,승인금액,승인번호,승인구분',
        '2025-03-20,12:00,동네식당,"33,000",77770001,승인',
      ].join('\n'),
    );
    await owner
      .post('/api/evidence/uploads/commit')
      .field('options', JSON.stringify({ kind: 'card', sourceId: cardId }))
      .attach('file', file, 'card.csv')
      .expect(200);
    const registry = app.get(ProviderRegistry);
    registry.register('hometax', 'mock', (_, ctx) =>
      Object.assign(new MockHometaxProvider(ctx), {
        fetchCardPurchases: async () => [
          {
            date: '2025-03-21',
            approvalNo: '77770001',
            amount: 33_000,
            cancelled: false,
            merchantName: '동네식당',
            merchantBizNo: '1234567891',
            vatAmount: 3_000,
          },
          {
            date: '2025-03-02',
            approvalNo: '00000000',
            amount: 1,
            cancelled: false,
            merchantName: '없음',
          },
        ],
      }),
    );
    try {
      const done = (await collect(owner, 'hometax', MARCH).expect(200)).body;
      expect(done.message).toContain('카드매입 2건 중 1건 카드 승인과 대조');
      const cards = (await owner.get('/api/evidence/card-transactions').expect(200)).body as {
        approvalNo: string;
        merchantBizNo: string | null;
        vatAmount: number | null;
      }[];
      expect(cards.find((c) => c.approvalNo === '77770001')).toMatchObject({
        merchantBizNo: '1234567891',
        vatAmount: 3_000,
      });
    } finally {
      registry.register('hometax', 'mock', (_, ctx) => new MockHometaxProvider(ctx));
    }
  });
});
