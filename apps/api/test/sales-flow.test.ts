import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDb } from '@wellbuddy/db';
import { TEST_DATABASE_URL_OWNER, truncateAll } from '@wellbuddy/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

interface DocLine {
  id: string;
  itemId: string;
  qty: number;
  remainingQty: number;
}
interface Doc {
  id: string;
  status: string;
  supplyTotal: number;
  vatTotal: number;
  entry: { id: string; status: string } | null;
  costEntry: { id: string; status: string } | null;
  lines: DocLine[];
}
interface Journal {
  status: string;
  type: string;
  vat: { supplyAmount: number; vatAmount: number; evidenceType: string } | null;
  lines: { accountCode: string; debit: number; credit: number; partnerName: string | null }[];
}
interface StockRow {
  name: string;
  kind: string;
  totalQty: number;
  value: number;
}

/**
 * P3-04·05·07·09 판매 흐름: 견적 → 주문 → 출고(매출원가 전표) → 판매(매출 전표), 직접 판매, 판매반품,
 * 소급 입고 뒤 매출원가 재계산. 단계마다 재고금액 = 재고자산(146 상품·150 제품) 잔액인지 본다.
 */
describe('판매 흐름(견적 → 주문 → 출고 → 판매 → 반품)과 매출원가', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const acc: Record<string, string> = {};
  let customer: string;
  let supplier: string;
  const item: Record<string, string> = {};

  const create = (body: object) => owner.post('/api/trade-docs').send(body);
  const doc = async (id: string) =>
    (await owner.get(`/api/trade-docs/${id}`).expect(200)).body as Doc;
  const journal = async (id: string) =>
    (await owner.get(`/api/journals/${id}`).expect(200)).body as Journal;
  const lines = (j: Journal) =>
    j.lines
      .map(
        (l) => `${l.accountCode} ${l.debit}/${l.credit}${l.partnerName ? ` ${l.partnerName}` : ''}`,
      )
      .sort();
  const stock = async () =>
    new Map(
      ((await owner.get('/api/inventory/stock').expect(200)).body as StockRow[]).map((r) => [
        r.name,
        r,
      ]),
    );
  const closing = async (code: string) =>
    (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc[code], from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body.closing as number;
  /** 재고금액(상품·제품) = 재고자산 계정(146·150) 잔액 */
  const expectBooksMatchStock = async () => {
    const rows = [...(await stock()).values()];
    const value = (kind: string) =>
      rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.value, 0);
    expect(await closing('146')).toBe(value('goods'));
    expect(await closing('150')).toBe(value('product'));
  };

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@sales-flow.local', '판매상사'));
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    customer = (
      await owner
        .post('/api/partners')
        .send({ name: '한빛상사', kind: 'customer', bizRegNo: '220-81-12341' })
        .expect(201)
    ).body.id;
    supplier = (
      await owner.post('/api/partners').send({ name: '대한물산', kind: 'supplier' }).expect(201)
    ).body.id;
    const add = async (key: string, body: object) => {
      item[key] = (await owner.post('/api/items').send(body).expect(201)).body.id;
    };
    await add('toner', { name: '토너', unit: 'BOX', salesPrice: 55_000 });
    await add('product', { name: '제품A', kind: 'product', salesPrice: 100_000 });
    await add('install', { name: '설치비', kind: 'service', salesPrice: 50_000 });
    // 입고: 토너 10개 @40,000, 제품A 5개 @60,000
    await create({
      kind: 'receipt',
      docDate: '2026-10-01',
      partnerId: supplier,
      lines: [
        { itemId: item.toner, qty: 10, unitPrice: 40_000 },
        { itemId: item.product, qty: 5, unitPrice: 60_000 },
      ],
    }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  let quote: Doc;
  let order: Doc;
  let shipment: Doc;
  let sale: Doc;

  it('견적서 → 주문서(일부): 단가는 품목 판매단가, 견적은 남은 수량만큼 진행 중', async () => {
    quote = (
      await create({
        kind: 'quote',
        docDate: '2026-10-02',
        partnerId: customer,
        dueDate: '2026-10-31',
        lines: [{ itemId: item.toner, qty: 5 }],
      }).expect(201)
    ).body;
    expect(quote).toMatchObject({ status: 'open', supplyTotal: 275_000, entry: null });
    order = (
      await create({
        kind: 'sales_order',
        docDate: '2026-10-03',
        partnerId: customer,
        sourceDocId: quote.id,
        lines: [{ itemId: item.toner, qty: 4, sourceLineId: quote.lines[0]!.id }],
      }).expect(201)
    ).body;
    expect((await doc(quote.id)).lines[0]).toMatchObject({ remainingQty: 1 });
    expect((await doc(quote.id)).status).toBe('open');
    await expectBooksMatchStock();
  });

  it('출고: 이동평균으로 재고를 줄이고 매출원가 전표(451/146)를 만든다. 매출 전표는 아직 없다', async () => {
    shipment = (
      await create({
        kind: 'shipment',
        docDate: '2026-10-05',
        partnerId: customer,
        sourceDocId: order.id,
        lines: [{ itemId: item.toner, qty: 3, sourceLineId: order.lines[0]!.id }],
      }).expect(201)
    ).body;
    expect(shipment.entry).toBeNull();
    const cost = await journal(shipment.costEntry!.id);
    expect(cost).toMatchObject({ status: 'posted', type: 'general', vat: null });
    expect(lines(cost)).toEqual(['146 0/120000', '451 120000/0']);
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 7, value: 280_000 });
    expect((await doc(order.id)).lines[0]).toMatchObject({ remainingQty: 1 });
    await expectBooksMatchStock();

    const short = await create({
      kind: 'shipment',
      docDate: '2026-10-05',
      partnerId: customer,
      lines: [{ itemId: item.toner, qty: 8 }],
    }).expect(409);
    expect(short.body.code).toBe('INSUFFICIENT_STOCK');
    expect(short.body.message).toContain('1BOX 모자랍니다');
  });

  it('판매(출고에서 전환): 매출 전표(108/401/255)만 만들고 재고는 다시 줄이지 않는다', async () => {
    sale = (
      await create({
        kind: 'sale',
        docDate: '2026-10-06',
        partnerId: customer,
        sourceDocId: shipment.id,
        lines: [
          { itemId: item.toner, qty: 3, unitPrice: 56_000, sourceLineId: shipment.lines[0]!.id },
        ],
      }).expect(201)
    ).body;
    expect(sale.costEntry).toBeNull();
    const entry = await journal(sale.entry!.id);
    expect(entry).toMatchObject({
      type: 'sales',
      vat: { supplyAmount: 168_000, vatAmount: 16_800, evidenceType: 'tax_invoice' },
    });
    expect(lines(entry)).toEqual(['108 184800/0 한빛상사', '255 0/16800', '401 0/168000']);
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 7 });
    await expectBooksMatchStock();
  });

  it('직접 판매: 제품은 제품매출·제품매출원가, 서비스는 용역매출(원가 없음)', async () => {
    const direct = (
      await create({
        kind: 'sale',
        docDate: '2026-10-07',
        partnerId: customer,
        lines: [
          { itemId: item.product, qty: 2 },
          { itemId: item.install, qty: 1 },
        ],
      }).expect(201)
    ).body as Doc;
    expect(lines(await journal(direct.entry!.id))).toEqual([
      '108 275000/0 한빛상사',
      '255 0/25000',
      '404 0/200000',
      '411 0/50000',
    ]);
    expect(lines(await journal(direct.costEntry!.id))).toEqual(['150 0/120000', '455 120000/0']);
    expect((await stock()).get('제품A')).toMatchObject({ totalQty: 3, value: 180_000 });
    await expectBooksMatchStock();
  });

  it('판매반품: 마이너스 매출 전표(매출환입)와 재고 원가 되돌림(146/451)', async () => {
    const ret = (
      await create({
        kind: 'sales_return',
        docDate: '2026-10-08',
        partnerId: customer,
        sourceDocId: sale.id,
        lines: [{ itemId: item.toner, qty: 1, sourceLineId: sale.lines[0]!.id }],
      }).expect(201)
    ).body as Doc;
    const entry = await journal(ret.entry!.id);
    expect(entry.vat).toMatchObject({ supplyAmount: -56_000, vatAmount: -5_600 });
    expect(lines(entry)).toEqual(['108 0/61600 한빛상사', '255 5600/0', '402 56000/0']);
    expect(lines(await journal(ret.costEntry!.id))).toEqual(['146 40000/0', '451 0/40000']);
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 8, value: 320_000 });
    expect((await doc(sale.id)).lines[0]).toMatchObject({ remainingQty: 2 });
    await expectBooksMatchStock();
  });

  it('소급 입고: 앞선 날짜에 싸게 들어온 재고가 있으면 이후 출고·반품의 매출원가를 다시 계산해 전표를 바꾼다', async () => {
    const before = (await doc(shipment.id)).costEntry!.id;
    await create({
      kind: 'receipt',
      docDate: '2026-09-25',
      partnerId: supplier,
      lines: [{ itemId: item.toner, qty: 10, unitPrice: 10_000 }],
    }).expect(201);
    // 10/5 출고 전 평단 = (10×10,000 + 10×40,000) / 20 = 25,000 → 3개 75,000
    const after = await doc(shipment.id);
    expect(after.costEntry!.id).not.toBe(before);
    expect(lines(await journal(after.costEntry!.id))).toEqual(['146 0/75000', '451 75000/0']);
    expect((await journal(before)).status).toBe('reversed');
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 18, value: 450_000 });
    await expectBooksMatchStock();
  });

  it('취소: 판매가 있는 출고는 막고, 거꾸로 취소하면 재고·전표·주문 남은 수량이 돌아온다', async () => {
    const blocked = await owner
      .post(`/api/trade-docs/${shipment.id}/cancel`)
      .send({ reason: '오출고' })
      .expect(409);
    expect(blocked.body.code).toBe('HAS_CHILDREN');

    const saleDetail = (await owner.get(`/api/trade-docs/${sale.id}`).expect(200)).body as {
      children: { id: string }[];
    };
    for (const child of saleDetail.children) {
      await owner.post(`/api/trade-docs/${child.id}/cancel`).send({ reason: '취소' }).expect(200);
    }
    await owner.post(`/api/trade-docs/${sale.id}/cancel`).send({ reason: '취소' }).expect(200);
    expect((await journal(sale.entry!.id)).status).toBe('reversed');
    await owner.post(`/api/trade-docs/${shipment.id}/cancel`).send({ reason: '취소' }).expect(200);
    expect((await doc(order.id)).lines[0]).toMatchObject({ remainingQty: 4 });
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 20, value: 500_000 });
    await expectBooksMatchStock();
    // 매출원가(451)도 모두 되돌아가 0
    expect(await closing('451')).toBe(0);
  });

  it('새 회사는 계정과목 화면을 열지 않아도 바로 거래 전표를 만들 수 있다(표준 계정이 비어 있던 예전 회사도 보충)', async () => {
    const { agent: fresh, companyId } = await ownerWithCompany(
      app,
      'fresh@sales-flow.local',
      '새상사',
    );
    const owner2 = createDb(TEST_DATABASE_URL_OWNER, { max: 1 });
    try {
      const [{ n }] = (
        await owner2.execute<{ n: number }>(
          sql`select count(*)::int as n from accounts where company_id = ${companyId}`,
        )
      ).rows as [{ n: number }];
      expect(n).toBeGreaterThan(50);
      // 예전 회사처럼 계정을 비워 두어도 전표를 만들 때 보충한다
      await owner2.execute(sql`delete from accounts where company_id = ${companyId}`);
    } finally {
      await owner2.$client.end();
    }
    const supplier2 = (await fresh.post('/api/partners').send({ name: '매입처' }).expect(201)).body
      .id;
    const item2 = (await fresh.post('/api/items').send({ name: '상품' }).expect(201)).body.id;
    const res = await fresh
      .post('/api/trade-docs')
      .send({
        kind: 'receipt',
        docDate: '2026-10-01',
        partnerId: supplier2,
        lines: [{ itemId: item2, qty: 1, unitPrice: 1_000 }],
      })
      .expect(201);
    expect(res.body.entry).not.toBeNull();
  });

  it('견적에서 바로 판매하면 견적이 완료된다', async () => {
    const q = (
      await create({
        kind: 'quote',
        docDate: '2026-10-10',
        partnerId: customer,
        lines: [{ itemId: item.install, qty: 2 }],
      }).expect(201)
    ).body as Doc;
    await create({
      kind: 'sale',
      docDate: '2026-10-10',
      partnerId: customer,
      sourceDocId: q.id,
      lines: [{ itemId: item.install, qty: 2, sourceLineId: q.lines[0]!.id }],
    }).expect(201);
    expect((await doc(q.id)).status).toBe('closed');
  });
});
