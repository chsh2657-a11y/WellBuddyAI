import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface DocLine {
  id: string;
  itemId: string;
  qty: number;
  unitPrice: number;
  supply: number;
  vat: number;
  processedQty: number;
  remainingQty: number;
}
interface Doc {
  id: string;
  kind: string;
  docNo: string;
  status: string;
  supplyTotal: number;
  vatTotal: number;
  total: number;
  entry: { id: string; number: string; status: string } | null;
  lines: DocLine[];
  children: { id: string; kind: string; status: string }[];
}
interface Journal {
  status: string;
  type: string;
  source: string;
  vat: { supplyAmount: number; vatAmount: number; evidenceType: string } | null;
  lines: { accountCode: string; debit: number; credit: number; partnerName: string | null }[];
}
interface StockRow {
  itemId: string;
  name: string;
  qty: number;
  totalQty: number;
  value: number;
}

/** P3-06 구매 흐름: 발주서 → 입고 → 구매, 직접 구매, 구매 반품, 취소. 재고와 전표가 함께 맞는지 */
describe('구매 흐름(발주 → 입고 → 구매 → 반품)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const acc: Record<string, string> = {};
  let supplier: string;
  const item: Record<string, string> = {};

  const create = (body: object) => owner.post('/api/trade-docs').send(body);
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
  const balance146 = async () =>
    (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc['146'], from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body.closing as number;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@purchase.local', '구매상사'));
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    supplier = (
      await owner
        .post('/api/partners')
        .send({ name: '대한물산', kind: 'supplier', bizRegNo: '105-81-34560' })
        .expect(201)
    ).body.id;
    const add = async (key: string, body: object) => {
      item[key] = (await owner.post('/api/items').send(body).expect(201)).body.id;
    };
    await add('toner', { name: '토너', unit: 'BOX', purchasePrice: 40_000, salesPrice: 55_000 });
    await add('paper', { name: 'A4 용지', unit: 'BOX', purchasePrice: 3_000 });
    await add('rice', { name: '쌀', vatType: 'exempt', purchasePrice: 30_000 });
    await add('install', { name: '설치비', kind: 'service', purchasePrice: 50_000 });
  });

  afterAll(async () => {
    await app.close();
  });

  let po: Doc;
  let receipt: Doc;
  let purchase: Doc;

  it('발주서: 단가를 비우면 품목 구매단가를 쓰고, 재고·전표는 만들지 않는다', async () => {
    po = (
      await create({
        kind: 'purchase_order',
        docDate: '2026-10-01',
        partnerId: supplier,
        lines: [
          { itemId: item.toner, qty: 10 },
          { itemId: item.paper, qty: 5, unitPrice: 2_900 },
        ],
      }).expect(201)
    ).body;
    expect(po).toMatchObject({
      kind: 'purchase_order',
      docNo: 'PO-20261001-001',
      status: 'open',
      supplyTotal: 414_500,
      vatTotal: 41_450,
      total: 455_950,
      entry: null,
    });
    expect(po.lines.map((l) => [l.unitPrice, l.supply, l.vat, l.remainingQty])).toEqual([
      [40_000, 400_000, 40_000, 10],
      [2_900, 14_500, 1_450, 5],
    ]);
    expect((await stock()).get('토너')?.totalQty ?? 0).toBe(0);
    // 거래처 없이는 만들 수 없다
    const noPartner = await create({
      kind: 'purchase_order',
      docDate: '2026-10-01',
      lines: [{ itemId: item.toner, qty: 1 }],
    }).expect(400);
    expect(noPartner.body.code).toBe('PARTNER_REQUIRED');
  });

  it('입고: 발주에서 일부만 받으면 재고(공급가액)와 입고 전표(상품/외상매입금)가 생긴다', async () => {
    receipt = (
      await create({
        kind: 'receipt',
        docDate: '2026-10-03',
        partnerId: supplier,
        sourceDocId: po.id,
        lines: [{ itemId: item.toner, qty: 6, sourceLineId: po.lines[0]!.id }],
      }).expect(201)
    ).body;
    expect(receipt).toMatchObject({ status: 'posted', supplyTotal: 240_000 });
    const entry = await journal(receipt.entry!.id);
    expect(entry).toMatchObject({ status: 'posted', type: 'general', source: 'trade', vat: null });
    expect(lines(entry)).toEqual(['146 240000/0', '251 0/240000 대한물산']);
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 6, value: 240_000 });
    expect(await balance146()).toBe(240_000);

    // 발주는 아직 진행 중(토너 4 남음), 남은 수량보다 많이 받을 수 없다
    const order = (await owner.get(`/api/trade-docs/${po.id}`).expect(200)).body as Doc;
    expect(order.status).toBe('open');
    expect(order.lines[0]).toMatchObject({ processedQty: 6, remainingQty: 4 });
    const over = await create({
      kind: 'receipt',
      docDate: '2026-10-03',
      partnerId: supplier,
      sourceDocId: po.id,
      lines: [{ itemId: item.toner, qty: 5, sourceLineId: po.lines[0]!.id }],
    }).expect(400);
    expect(over.body.code).toBe('QTY_EXCEEDS_REMAINING');
    expect(over.body.message).toContain('4BOX');
  });

  it('구매(입고에서 전환): 입고 전표를 역분개하고 매입 전표(부가세)로 바꾸며, 고친 단가로 재고금액을 맞춘다', async () => {
    // 수량을 바꾸면 거부(줄 전체를 그대로 옮긴다)
    const partial = await create({
      kind: 'purchase',
      docDate: '2026-10-05',
      partnerId: supplier,
      sourceDocId: receipt.id,
      lines: [{ itemId: item.toner, qty: 5, sourceLineId: receipt.lines[0]!.id }],
    }).expect(400);
    expect(partial.body.code).toBe('CONVERSION_MISMATCH');

    purchase = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-05',
        partnerId: supplier,
        sourceDocId: receipt.id,
        lines: [
          {
            itemId: item.toner,
            qty: 6,
            unitPrice: 39_000,
            sourceLineId: receipt.lines[0]!.id,
          },
        ],
      }).expect(201)
    ).body;
    expect(purchase).toMatchObject({ supplyTotal: 234_000, vatTotal: 23_400, total: 257_400 });
    const entry = await journal(purchase.entry!.id);
    expect(entry).toMatchObject({
      type: 'purchase',
      vat: { supplyAmount: 234_000, vatAmount: 23_400, evidenceType: 'tax_invoice' },
    });
    expect(lines(entry)).toEqual(['135 23400/0', '146 234000/0', '251 0/257400 대한물산']);

    // 입고 전표는 역분개되고 입고 문서의 전표 연결이 끊긴다
    const r = (await owner.get(`/api/trade-docs/${receipt.id}`).expect(200)).body as Doc;
    expect(r.entry).toBeNull();
    const reversed = await owner
      .get('/api/journals')
      .query({ from: '2026-10-01', to: '2026-10-31', limit: 50 })
      .expect(200);
    const statuses = (reversed.body.items as { source: string; status: string }[])
      .filter((j) => j.source === 'trade' || j.source === 'reversal')
      .map((j) => `${j.source}:${j.status}`)
      .sort();
    expect(statuses).toEqual(['reversal:posted', 'trade:posted', 'trade:reversed']);

    // 재고금액은 구매 단가(234,000)로, 재고자산 잔액과 같다
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 6, value: 234_000 });
    expect(await balance146()).toBe(234_000);

    // 같은 입고를 다시 구매로 바꿀 수 없다
    const again = await create({
      kind: 'purchase',
      docDate: '2026-10-05',
      partnerId: supplier,
      sourceDocId: receipt.id,
      lines: [{ itemId: item.toner, qty: 6, sourceLineId: receipt.lines[0]!.id }],
    }).expect(409);
    expect(again.body.code).toBe('ALREADY_CONVERTED');
  });

  it('직접 구매: 재고 품목은 상품, 서비스는 비용 계정으로. 과세·면세는 섞을 수 없다', async () => {
    const direct = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-06',
        partnerId: supplier,
        evidenceType: 'card',
        lines: [
          { itemId: item.paper, qty: 10 },
          { itemId: item.install, qty: 1 },
        ],
      }).expect(201)
    ).body as Doc;
    const entry = await journal(direct.entry!.id);
    expect(entry.vat).toMatchObject({
      supplyAmount: 80_000,
      vatAmount: 8_000,
      evidenceType: 'card',
    });
    expect(lines(entry)).toEqual([
      '135 8000/0',
      '146 30000/0',
      '251 0/88000 대한물산',
      '831 50000/0',
    ]);
    expect((await stock()).get('A4 용지')).toMatchObject({ totalQty: 10, value: 30_000 });
    expect((await stock()).has('설치비')).toBe(false);

    const mixed = await create({
      kind: 'purchase',
      docDate: '2026-10-06',
      partnerId: supplier,
      lines: [
        { itemId: item.paper, qty: 1 },
        { itemId: item.rice, qty: 1 },
      ],
    }).expect(400);
    expect(mixed.body.code).toBe('MIXED_VAT_TYPES');

    const serviceReceipt = await create({
      kind: 'receipt',
      docDate: '2026-10-06',
      partnerId: supplier,
      lines: [{ itemId: item.install, qty: 1 }],
    }).expect(400);
    expect(serviceReceipt.body.code).toBe('SERVICE_ITEM_NOT_ALLOWED');

    // 면세 품목만이면 계산서, 부가세 0
    const rice = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-06',
        partnerId: supplier,
        lines: [{ itemId: item.rice, qty: 2 }],
      }).expect(201)
    ).body as Doc;
    const riceEntry = await journal(rice.entry!.id);
    expect(riceEntry.vat).toMatchObject({ vatAmount: 0, evidenceType: 'invoice' });
    expect(lines(riceEntry)).toEqual(['146 60000/0', '251 0/60000 대한물산']);
  });

  it('구매 반품: 구매 단가로 재고를 줄이고 마이너스 매입 전표를 만든다(반품 가능 수량까지)', async () => {
    const ret = (
      await create({
        kind: 'purchase_return',
        docDate: '2026-10-07',
        partnerId: supplier,
        sourceDocId: purchase.id,
        lines: [{ itemId: item.toner, qty: 2, sourceLineId: purchase.lines[0]!.id }],
      }).expect(201)
    ).body as Doc;
    expect(ret).toMatchObject({ supplyTotal: 78_000, vatTotal: 7_800 });
    const entry = await journal(ret.entry!.id);
    expect(entry.vat).toMatchObject({ supplyAmount: -78_000, vatAmount: -7_800 });
    expect(lines(entry)).toEqual(['135 0/7800', '146 0/78000', '251 85800/0 대한물산']);
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 4, value: 156_000 });

    const over = await create({
      kind: 'purchase_return',
      docDate: '2026-10-07',
      partnerId: supplier,
      sourceDocId: purchase.id,
      lines: [{ itemId: item.toner, qty: 5, sourceLineId: purchase.lines[0]!.id }],
    }).expect(400);
    expect(over.body.message).toContain('반품할 수 있는 수량은 4BOX');

    // 재고보다 많이 반품하면 재고 부족
    const short = await create({
      kind: 'purchase_return',
      docDate: '2026-10-07',
      partnerId: supplier,
      lines: [{ itemId: item.paper, qty: 11 }],
    }).expect(409);
    expect(short.body.code).toBe('INSUFFICIENT_STOCK');
    expect(short.body.message).toContain('A4 용지');
    expect(short.body.message).toContain('1BOX 모자랍니다');

    // 재고금액 합계 = 재고자산(146) 잔액
    const total = [...(await stock()).values()].reduce((s, r) => s + r.value, 0);
    expect(await balance146()).toBe(total);
  });

  it('취소: 다음 단계가 있으면 막고, 취소하면 재고·전표가 되돌아간다(구매 취소 시 입고 전표 복원)', async () => {
    const blocked = await owner
      .post(`/api/trade-docs/${purchase.id}/cancel`)
      .send({ reason: '단가 오류' })
      .expect(409);
    expect(blocked.body.code).toBe('HAS_CHILDREN');

    const detail = (await owner.get(`/api/trade-docs/${purchase.id}`).expect(200)).body as Doc;
    const ret = detail.children.find((c) => c.kind === 'purchase_return')!;
    const cancelledReturn = (
      await owner.post(`/api/trade-docs/${ret.id}/cancel`).send({ reason: '반품 철회' }).expect(200)
    ).body as Doc;
    expect(cancelledReturn.status).toBe('cancelled');
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 6, value: 234_000 });

    await owner
      .post(`/api/trade-docs/${purchase.id}/cancel`)
      .send({ reason: '단가 오류' })
      .expect(200);
    // 입고 전표가 입고 단가(240,000)로 다시 생긴다
    const r = (await owner.get(`/api/trade-docs/${receipt.id}`).expect(200)).body as Doc;
    expect(r.entry).not.toBeNull();
    expect(lines(await journal(r.entry!.id))).toEqual(['146 240000/0', '251 0/240000 대한물산']);
    expect((await stock()).get('토너')).toMatchObject({ totalQty: 6, value: 240_000 });

    // 입고를 취소하면 발주의 남은 수량이 돌아온다
    await owner.post(`/api/trade-docs/${receipt.id}/cancel`).send({ reason: '오입력' }).expect(200);
    const order = (await owner.get(`/api/trade-docs/${po.id}`).expect(200)).body as Doc;
    expect(order.lines[0]).toMatchObject({ processedQty: 0, remainingQty: 10 });
    expect((await stock()).get('토너')?.totalQty ?? 0).toBe(0);

    // 이미 취소한 문서
    const twice = await owner
      .post(`/api/trade-docs/${receipt.id}/cancel`)
      .send({ reason: '다시' })
      .expect(409);
    expect(twice.body.code).toBe('ALREADY_CANCELLED');

    const total = [...(await stock()).values()].reduce((s, r) => s + r.value, 0);
    expect(await balance146()).toBe(total);
  });

  it('발주를 모두 받으면 완료, 취소하면 다시 진행 중(발주에서 바로 구매해도 남은 수량까지)', async () => {
    const order = (await owner.get(`/api/trade-docs/${po.id}`).expect(200)).body as Doc;
    const over = await create({
      kind: 'purchase',
      docDate: '2026-10-08',
      partnerId: supplier,
      sourceDocId: po.id,
      lines: [{ itemId: item.toner, qty: 11, sourceLineId: order.lines[0]!.id }],
    }).expect(400);
    expect(over.body.code).toBe('QTY_EXCEEDS_REMAINING');
    const full = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-08',
        partnerId: supplier,
        sourceDocId: po.id,
        lines: order.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, sourceLineId: l.id })),
      }).expect(201)
    ).body as Doc;
    expect((await owner.get(`/api/trade-docs/${po.id}`).expect(200)).body.status).toBe('closed');
    await owner.post(`/api/trade-docs/${full.id}/cancel`).send({ reason: '취소' }).expect(200);
    expect((await owner.get(`/api/trade-docs/${po.id}`).expect(200)).body.status).toBe('open');
  });

  it('재고 부족이 되는 취소는 막는다', async () => {
    const direct = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-10',
        partnerId: supplier,
        lines: [{ itemId: item.toner, qty: 3, unitPrice: 41_000 }],
      }).expect(201)
    ).body as Doc;
    await create({
      kind: 'purchase_return',
      docDate: '2026-10-11',
      partnerId: supplier,
      lines: [{ itemId: item.toner, qty: 3, unitPrice: 41_000 }],
    }).expect(201);
    const res = await owner
      .post(`/api/trade-docs/${direct.id}/cancel`)
      .send({ reason: '취소' })
      .expect(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.message).toContain('취소하면 재고가 모자랍니다');
  });

  it('자동 전표는 전표조회에서 고치거나 지울 수 없다', async () => {
    const doc = (
      await create({
        kind: 'purchase',
        docDate: '2026-10-12',
        partnerId: supplier,
        lines: [{ itemId: item.paper, qty: 1 }],
      }).expect(201)
    ).body as Doc;
    const reverse = await owner.post(`/api/journals/${doc.entry!.id}/reverse`).send({}).expect(409);
    expect(reverse.body.code).toBe('SYSTEM_ENTRY');
    expect(reverse.body.message).toContain('영업·구매·재고');
  });

  it('전표 승인을 쓰면 경리가 만든 전표는 승인요청, 취소하면 그 전표를 지운다', async () => {
    const accountant = await inviteAndJoin(app, owner, 'acc@purchase.local', 'accountant');
    await owner.patch('/api/companies/current').send({ journalApprovalRequired: true }).expect(200);
    const doc = (
      await accountant
        .post('/api/trade-docs')
        .send({
          kind: 'purchase',
          docDate: '2026-10-13',
          partnerId: supplier,
          lines: [{ itemId: item.paper, qty: 2 }],
        })
        .expect(201)
    ).body as Doc;
    expect(doc.entry!.status).toBe('pending');
    const del = await accountant.delete(`/api/journals/${doc.entry!.id}`).expect(409);
    expect(del.body.code).toBe('SYSTEM_ENTRY');
    await accountant.post(`/api/trade-docs/${doc.id}/cancel`).send({ reason: '취소' }).expect(200);
    await owner.get(`/api/journals/${doc.entry!.id}`).expect(404);
    await owner
      .patch('/api/companies/current')
      .send({ journalApprovalRequired: false })
      .expect(200);
  });

  it('권한·격리: 직원은 볼 수 없고, 다른 회사의 거래처·품목으로 문서를 만들 수 없다', async () => {
    const employee = await inviteAndJoin(app, owner, 'emp@purchase.local', 'employee');
    await employee.get('/api/trade-docs').expect(403);
    await employee.get('/api/inventory/stock').expect(403);

    const { agent: other } = await ownerWithCompany(app, 'other@purchase.local', '다른상사');
    expect((await other.get('/api/trade-docs').expect(200)).body.items).toEqual([]);
    const ownPartner = (await other.post('/api/partners').send({ name: '내 거래처' }).expect(201))
      .body.id;
    const res = await other
      .post('/api/trade-docs')
      .send({
        kind: 'purchase_order',
        docDate: '2026-10-01',
        partnerId: ownPartner,
        lines: [{ itemId: item.toner, qty: 1 }],
      })
      .expect(400);
    expect(res.body.code).toBe('ITEM_NOT_FOUND');
    // 자기 품목이라도 남의 거래처는 쓸 수 없다
    const own = (await other.post('/api/items').send({ name: '내 품목' }).expect(201)).body.id;
    const foreign = await other
      .post('/api/trade-docs')
      .send({
        kind: 'purchase_order',
        docDate: '2026-10-01',
        partnerId: supplier,
        lines: [{ itemId: own, qty: 1 }],
      })
      .expect(400);
    expect(foreign.body.code).toBe('REFERENCE_NOT_FOUND');
  });
});
