import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDb } from '@wellbuddy/db';
import { TEST_DATABASE_URL_OWNER, truncateAll } from '@wellbuddy/db/testing';
import {
  bizNo,
  MockTaxInvoiceIssuer,
  ProviderRegistry,
  type TaxInvoiceDraft,
  type TaxInvoiceIssuer,
} from '@wellbuddy/integrations';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));
const OWN = '0000000000';
const HANBIT = bizNo('220811234');
const DONGYANG = bizNo('312813456');
const SEOUL = bizNo('105813456');
const INVOICE_HEADER = [
  '작성일자',
  '승인번호',
  '공급자사업자등록번호',
  '상호',
  '공급받는자사업자등록번호',
  '상호',
  '합계금액',
  '공급가액',
  '세액',
  '품목명',
];
const won = (n: number) => `"${n.toLocaleString('en-US')}"`;
const invoiceRow = (
  date: string,
  approvalNo: string,
  supplier: [string, string],
  buyer: [string, string],
  supply: number,
  vat: number,
) => [date, approvalNo, ...supplier, ...buyer, won(supply + vat), won(supply), won(vat), '상품'];

interface Doc {
  id: string;
  docNo: string;
  status: string;
  total: number;
  entry: { id: string } | null;
  taxInvoice: {
    evidenceId: string | null;
    issueId: string | null;
    status: string;
    approvalNo: string | null;
    totalAmount: number;
    sharedWith: number;
  } | null;
}
interface Issue {
  id: string;
  mgtKey: string;
  status: string;
  kind: string;
  buyerBizNo: string;
  itemName: string;
  supplyAmount: number;
  vatAmount: number;
  approvalNo: string | null;
  taxInvoiceId: string | null;
  evidenceStatus: string | null;
  tradeDocId: string | null;
  tradeDocNo: string | null;
  notice?: string | null;
}
interface Invoice {
  id: string;
  direction: string;
  approvalNo: string;
  totalAmount: number;
  status: string;
}

/**
 * P3-08 판매 → 전자세금계산서 발행 연계와, 수집한 세금계산서 ↔ 판매·구매 문서 짝짓기(이중 분개 방지),
 * 재고수불현황·재고–장부 대사.
 */
describe('판매 세금계산서 연계·수집 계산서 짝짓기·재고 대사(P3-08)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let registry: ProviderRegistry;
  const drafts: TaxInvoiceDraft[] = [];
  const acc: Record<string, string> = {};
  const partner: Record<string, string> = {};
  const item: Record<string, string> = {};
  const ownerDb = createDb(TEST_DATABASE_URL_OWNER, { max: 1 });

  const create = (body: object) => owner.post('/api/trade-docs').send(body);
  const doc = async (id: string) =>
    (await owner.get(`/api/trade-docs/${id}`).expect(200)).body as Doc;
  const issue = (id: string, body: object = {}) =>
    owner.post(`/api/trade-docs/${id}/tax-invoice`).send(body);
  const cancelIssue = (id: string) =>
    owner.post(`/api/tax-invoice-issues/${id}/cancel`).send({ reason: '공급받는자 정보 오류' });
  const journalCount = async () =>
    (await owner.get('/api/journals').query({ limit: 1 }).expect(200)).body.total as number;
  const invoices = async () =>
    (await owner.get('/api/evidence/tax-invoices').expect(200)).body as Invoice[];
  const evidenceRow = async (id: string) =>
    (
      await ownerDb.execute<{ status: string; entry_id: string | null; partner_id: string | null }>(
        sql`select status, entry_id, partner_id from tax_invoices where id = ${id}`,
      )
    ).rows[0]!;
  const upload = (rows: string[][]) =>
    owner
      .post('/api/evidence/uploads/commit')
      .field('options', JSON.stringify({ kind: 'tax_invoice' }))
      .attach('file', csv([INVOICE_HEADER, ...rows]), 'tax_invoice.csv')
      .expect(200);
  const run = async () => (await owner.post('/api/auto-journal/run').expect(200)).body;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    registry = app.get(ProviderRegistry);
    registry.register('taxinvoice', 'mock', () => {
      const mock = new MockTaxInvoiceIssuer();
      return {
        testConnection: () => mock.testConnection(),
        issue: (draft) => {
          drafts.push(draft);
          return mock.issue(draft);
        },
        cancel: (key) => mock.cancel(key),
        getStatus: (key) => mock.getStatus(key),
      } satisfies TaxInvoiceIssuer;
    });
    ({ agent: owner } = await ownerWithCompany(app, 'owner@sales-tax.local', '발행상사'));
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    const addPartner = async (key: string, body: object) => {
      partner[key] = (await owner.post('/api/partners').send(body).expect(201)).body.id;
    };
    await addPartner('hanbit', {
      name: '한빛상사',
      kind: 'customer',
      bizRegNo: HANBIT,
      representative: '박대표',
      email: 'tax@hanbit.test',
    });
    await addPartner('seoul', { name: '서울상사', kind: 'customer', bizRegNo: SEOUL });
    await addPartner('person', { name: '개인고객', kind: 'customer' });
    await addPartner('dongyang', { name: '동양자재', kind: 'supplier', bizRegNo: DONGYANG });
    const addItem = async (key: string, body: object) => {
      item[key] = (await owner.post('/api/items').send(body).expect(201)).body.id;
    };
    await addItem('toner', { name: '토너', spec: 'TN-2480', unit: 'BOX', salesPrice: 55_000 });
    await addItem('install', { name: '설치비', kind: 'service', salesPrice: 50_000 });
    await create({
      kind: 'receipt',
      docDate: '2026-10-01',
      partnerId: partner.dongyang,
      lines: [{ itemId: item.toner, qty: 10, unitPrice: 40_000 }],
    }).expect(201);
  });

  afterAll(async () => {
    registry.register('taxinvoice', 'mock', () => new MockTaxInvoiceIssuer());
    await ownerDb.$client.end();
    await app.close();
  });

  let sale: Doc;
  let issued: Issue;

  it('판매에서 발행: 채널이 꺼져 있으면 거절, 켜면 품목 줄·거래처로 청구 발행하고 증빙을 판매 전표에 잇는다', async () => {
    sale = (
      await create({
        kind: 'sale',
        docDate: '2026-10-05',
        partnerId: partner.hanbit,
        lines: [
          { itemId: item.toner, qty: 3 },
          { itemId: item.install, qty: 1 },
        ],
      }).expect(201)
    ).body;
    expect(sale.total).toBe(236_500);
    expect(sale.taxInvoice).toBeNull();

    expect((await issue(sale.id).expect(400)).body).toMatchObject({ code: 'CHANNEL_DISABLED' });
    await owner
      .put('/api/integrations/taxinvoice')
      .send({ enabled: true, provider: 'mock' })
      .expect(200);

    issued = (await issue(sale.id).expect(201)).body;
    expect(issued).toMatchObject({
      mgtKey: `${sale.docNo}-1`,
      status: 'issued',
      kind: 'tax',
      buyerBizNo: HANBIT,
      itemName: '토너 외 1건',
      supplyAmount: 215_000,
      vatAmount: 21_500,
      evidenceStatus: 'posted',
      tradeDocId: sale.id,
      tradeDocNo: sale.docNo,
    });
    expect(drafts.at(-1)).toMatchObject({
      issueDate: '2026-10-05',
      purpose: 'claim',
      buyerName: '한빛상사',
      buyerCeoName: '박대표',
      buyerEmail: 'tax@hanbit.test',
      lines: [
        {
          itemName: '토너',
          spec: 'TN-2480',
          qty: 3,
          unitPrice: 55_000,
          supplyAmount: 165_000,
          vatAmount: 16_500,
        },
        { itemName: '설치비', qty: 1, unitPrice: 50_000, supplyAmount: 50_000, vatAmount: 5_000 },
      ],
    });
    // 매출 세금계산서(증빙)는 판매 전표에 이어져 다시 분개하지 않는다
    expect(await evidenceRow(issued.taxInvoiceId!)).toEqual({
      status: 'posted',
      entry_id: sale.entry!.id,
      partner_id: partner.hanbit,
    });
    expect((await doc(sale.id)).taxInvoice).toMatchObject({
      issueId: issued.id,
      evidenceId: issued.taxInvoiceId,
      status: 'issued',
      approvalNo: issued.approvalNo,
      totalAmount: 236_500,
    });
    // 같은 판매는 두 번 발행하지 않는다
    expect((await issue(sale.id).expect(409)).body).toMatchObject({
      code: 'TAX_INVOICE_ALREADY_LINKED',
    });
  });

  it('자동분개를 돌려도 발행한 계산서로 전표를 또 만들지 않고, 홈택스에서 다시 수집한 사본은 중복으로 걸러진다', async () => {
    const before = await journalCount();
    await run();
    expect(await journalCount()).toBe(before);
    await upload([
      invoiceRow(
        '2026-10-05',
        issued.approvalNo!,
        [OWN, '발행상사'],
        [HANBIT, '한빛상사'],
        215_000,
        21_500,
      ),
    ]);
    const sales = (await invoices()).filter((i) => i.direction === 'sales');
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ id: issued.taxInvoiceId, status: 'posted' });
  });

  it('발행한 판매는 발행부터 취소해야 취소된다. 발행 취소 뒤 다시 발행하면 관리번호가 -2', async () => {
    expect(
      (
        await owner
          .post(`/api/trade-docs/${sale.id}/cancel`)
          .send({ reason: '주문 취소' })
          .expect(409)
      ).body,
    ).toMatchObject({ code: 'TAX_INVOICE_ISSUED' });

    const cancelled = (await cancelIssue(issued.id).expect(200)).body as Issue;
    expect(cancelled).toMatchObject({ status: 'cancelled', evidenceStatus: 'ignored' });
    expect(cancelled.notice).toMatch(/판매 전표는 그대로 둡니다/);
    expect((await evidenceRow(issued.taxInvoiceId!)).entry_id).toBeNull();
    expect((await doc(sale.id)).taxInvoice).toBeNull();

    const again = (await issue(sale.id, { buyerEmail: 'new@hanbit.test' }).expect(201))
      .body as Issue;
    expect(again).toMatchObject({ mgtKey: `${sale.docNo}-2`, evidenceStatus: 'posted' });
    expect(drafts.at(-1)?.buyerEmail).toBe('new@hanbit.test');

    await cancelIssue(again.id).expect(200);
    await owner.post(`/api/trade-docs/${sale.id}/cancel`).send({ reason: '주문 취소' }).expect(200);
    expect((await issue(sale.id).expect(409)).body).toMatchObject({ code: 'DOC_CANCELLED' });
  });

  it('발행할 수 없는 판매: 사업자번호 없는 거래처, 카드 증빙, 판매가 아닌 문서', async () => {
    const personal = (
      await create({
        kind: 'sale',
        docDate: '2026-10-07',
        partnerId: partner.person,
        lines: [{ itemId: item.toner, qty: 1 }],
      }).expect(201)
    ).body as Doc;
    expect((await issue(personal.id).expect(400)).body).toMatchObject({
      code: 'PARTNER_BIZ_NO_REQUIRED',
    });
    const card = (
      await create({
        kind: 'sale',
        docDate: '2026-10-08',
        partnerId: partner.hanbit,
        evidenceType: 'card',
        lines: [{ itemId: item.toner, qty: 1 }],
      }).expect(201)
    ).body as Doc;
    expect((await issue(card.id).expect(400)).body).toMatchObject({
      code: 'EVIDENCE_NOT_TAX_INVOICE',
    });
    const receipt = (
      await create({
        kind: 'receipt',
        docDate: '2026-10-09',
        partnerId: partner.dongyang,
        lines: [{ itemId: item.toner, qty: 1, unitPrice: 40_000 }],
      }).expect(201)
    ).body as Doc;
    expect((await issue(receipt.id).expect(400)).body).toMatchObject({ code: 'NOT_SALE' });
  });

  it('수집한 매입 계산서를 구매와 짝지어 다시 분개하지 않는다(계산서가 먼저 와도), 구매를 취소하면 대기로 돌아간다', async () => {
    const purchase = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-10',
        partnerId: partner.dongyang,
        lines: [{ itemId: item.toner, qty: 5, unitPrice: 40_000 }],
      }).expect(201)
    ).body as Doc;
    await upload([
      invoiceRow(
        '2026-10-12',
        '20261012-41000000-00000101',
        [DONGYANG, '동양자재'],
        [OWN, '발행상사'],
        200_000,
        20_000,
      ),
    ]);
    const before = await journalCount();
    expect((await run()).matched).toBeGreaterThanOrEqual(1);
    expect(await journalCount()).toBe(before);
    const bought = (await invoices()).find((i) => i.totalAmount === 220_000)!;
    expect(await evidenceRow(bought.id)).toMatchObject({
      status: 'posted',
      entry_id: purchase.entry!.id,
    });
    expect((await doc(purchase.id)).taxInvoice).toMatchObject({
      issueId: null,
      status: 'collected',
      evidenceId: bought.id,
      totalAmount: 220_000,
    });

    // 계산서가 먼저 수집되고(대기) 구매를 나중에 입력해도 짝짓는다
    await upload([
      invoiceRow(
        '2026-10-20',
        '20261020-41000000-00000102',
        [DONGYANG, '동양자재'],
        [OWN, '발행상사'],
        80_000,
        8_000,
      ),
    ]);
    const early = (await invoices()).find((i) => i.totalAmount === 88_000)!;
    expect(early.status).toBe('pending');
    const later = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-21',
        partnerId: partner.dongyang,
        lines: [{ itemId: item.toner, qty: 2, unitPrice: 40_000 }],
      }).expect(201)
    ).body as Doc;
    expect(later.taxInvoice).toMatchObject({ status: 'collected', evidenceId: early.id });
    expect(await evidenceRow(early.id)).toMatchObject({
      status: 'posted',
      entry_id: later.entry!.id,
    });

    await owner
      .post(`/api/trade-docs/${later.id}/cancel`)
      .send({ reason: '입력 오류' })
      .expect(200);
    expect(await evidenceRow(early.id)).toMatchObject({ status: 'pending', entry_id: null });
    // 대기로 돌아간 계산서는 다시 자동분개 대상이 된다. 다음 시나리오를 위해 분개하지 않음으로 둔다
    await owner
      .patch(`/api/evidence/tax_invoice/${early.id}/status`)
      .send({ status: 'ignored' })
      .expect(204);
  });

  it('월합계 매출 계산서 한 장을 같은 달 판매 두 건에 잇고, 한 건을 취소하면 남은 판매 전표로 옮긴다', async () => {
    const a = (
      await create({
        kind: 'sale',
        docDate: '2026-10-06',
        partnerId: partner.seoul,
        lines: [{ itemId: item.toner, qty: 1 }],
      }).expect(201)
    ).body as Doc;
    const b = (
      await create({
        kind: 'sale',
        docDate: '2026-10-25',
        partnerId: partner.seoul,
        lines: [{ itemId: item.install, qty: 1 }],
      }).expect(201)
    ).body as Doc;
    await upload([
      invoiceRow(
        '2026-10-31',
        '20261031-41000000-00000201',
        [OWN, '발행상사'],
        [SEOUL, '서울상사'],
        105_000,
        10_500,
      ),
    ]);
    const before = await journalCount();
    await run();
    expect(await journalCount()).toBe(before);
    const monthly = (await invoices()).find((i) => i.totalAmount === 115_500)!;
    expect(await evidenceRow(monthly.id)).toMatchObject({
      status: 'posted',
      entry_id: a.entry!.id,
    });
    expect((await doc(a.id)).taxInvoice).toMatchObject({ status: 'collected', sharedWith: 1 });
    expect((await doc(b.id)).taxInvoice).toMatchObject({ evidenceId: monthly.id, sharedWith: 1 });

    await owner.post(`/api/trade-docs/${a.id}/cancel`).send({ reason: '반품' }).expect(200);
    expect(await evidenceRow(monthly.id)).toMatchObject({
      status: 'posted',
      entry_id: b.entry!.id,
    });
    expect((await doc(b.id)).taxInvoice).toMatchObject({ sharedWith: 0 });
  });

  it('재고수불현황(기간)과 재고–장부 대사: 일반 전표로 재고 계정을 건드리면 차이와 그 전표를 보인다', async () => {
    // 토너: 입고 10 + 1, 구매 5 / 판매 1(개인) + 1(카드). 취소한 판매·구매는 빠진다. 단가 40,000
    const summary = (
      await owner
        .get('/api/inventory/summary')
        .query({ from: '2026-10-02', to: '2026-10-31' })
        .expect(200)
    ).body as {
      rows: {
        name: string;
        opening: { qty: number; value: number };
        in: { qty: number; value: number };
        out: { qty: number; value: number };
        closing: { qty: number; value: number };
      }[];
      totals: { opening: number; in: number; out: number; closing: number };
    };
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      name: '토너',
      opening: { qty: 10, value: 400_000 },
      in: { qty: 6, value: 240_000 },
      out: { qty: 2, value: 80_000 },
      closing: { qty: 14, value: 560_000 },
    });
    expect(summary.totals).toEqual({
      opening: 400_000,
      in: 240_000,
      out: 80_000,
      closing: 560_000,
    });

    const reconcile = async () =>
      (await owner.get('/api/inventory/reconcile').query({ date: '2026-10-31' }).expect(200))
        .body as {
        balanced: boolean;
        rows: {
          code: string;
          stockValue: number;
          ledgerBalance: number;
          difference: number;
          otherEntries: { amount: number; description: string | null }[];
        }[];
      };
    expect(await reconcile()).toMatchObject({
      balanced: true,
      rows: [{ code: '146', stockValue: 560_000, ledgerBalance: 560_000, difference: 0 }],
    });

    await owner
      .post('/api/journals')
      .send({
        entry: {
          entryDate: '2026-10-15',
          description: '재고 직접 조정',
          lines: [
            { accountId: acc['146'], debit: 10_000, credit: 0 },
            { accountId: acc['101'], debit: 0, credit: 10_000 },
          ],
        },
        status: 'posted',
      })
      .expect(201);
    const after = await reconcile();
    expect(after.balanced).toBe(false);
    expect(after.rows[0]).toMatchObject({
      code: '146',
      stockValue: 560_000,
      ledgerBalance: 570_000,
      difference: 10_000,
      otherEntries: [{ amount: 10_000, description: '재고 직접 조정' }],
    });
  });
});
