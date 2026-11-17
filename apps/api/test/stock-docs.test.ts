import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

interface Doc {
  id: string;
  docNo: string;
  kind: string;
  status: string;
  warehouseName: string | null;
  toWarehouseName: string | null;
  supplyTotal: number;
  entry: { id: string } | null;
  costEntry: { id: string } | null;
  lines: { itemId: string; qty: number; unitPrice: number; supply: number }[];
}
interface Journal {
  description: string | null;
  lines: { accountCode: string; debit: number; credit: number }[];
}
interface StockRow {
  name: string;
  qty: number;
  totalQty: number;
  value: number;
  warehouses: { warehouseId: string; qty: number }[];
}

/**
 * P3-10 창고 간 이동, P3-11 재고 실사·조정, 기초재고.
 * 창고 이동은 수량만 옮기고(전표 없음), 실사 차이는 이동평균으로 감모·과잉 전표, 기초재고는 전표 없이 재고만.
 */
describe('창고 이동·재고 실사·기초재고(P3-10·11)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const acc: Record<string, string> = {};
  const item: Record<string, string> = {};
  let main: string;
  let center: string;
  let customer: string;
  let transfer: Doc;

  const create = (body: object) => owner.post('/api/trade-docs').send(body);
  const count = (body: object) => owner.post('/api/inventory/counts').send(body);
  const journal = async (id: string) =>
    (await owner.get(`/api/journals/${id}`).expect(200)).body as Journal;
  const lines = (j: Journal) =>
    j.lines.map((l) => `${l.accountCode} ${l.debit}/${l.credit}`).sort();
  const stock = async (query: object = {}) =>
    new Map(
      ((await owner.get('/api/inventory/stock').query(query).expect(200)).body as StockRow[]).map(
        (r) => [r.name, r],
      ),
    );
  const reconcile = async () =>
    (await owner.get('/api/inventory/reconcile').query({ date: '2026-10-31' }).expect(200))
      .body as {
      balanced: boolean;
      rows: { code: string; stockValue: number; ledgerBalance: number; difference: number }[];
    };

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@stock-docs.local', '재고상사'));
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    main = (await owner.post('/api/warehouses').send({ name: '본사창고' }).expect(201)).body.id;
    center = (await owner.post('/api/warehouses').send({ name: '물류센터' }).expect(201)).body.id;
    customer = (
      await owner.post('/api/partners').send({ name: '한빛상사', kind: 'customer' }).expect(201)
    ).body.id;
    const add = async (key: string, body: object) => {
      item[key] = (await owner.post('/api/items').send(body).expect(201)).body.id;
    };
    await add('toner', { name: '토너', unit: 'BOX', purchasePrice: 40_000, salesPrice: 55_000 });
    await add('product', { name: '제품A', kind: 'product', purchasePrice: 60_000 });
    await add('install', { name: '설치비', kind: 'service' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('기초재고는 재고만 넣고 전표는 만들지 않는다(장부 기초잔액과 대사로 맞춘다)', async () => {
    const opening = (
      await create({
        kind: 'opening',
        docDate: '2026-10-01',
        warehouseId: main,
        lines: [
          { itemId: item.toner, qty: 10 },
          { itemId: item.product, qty: 5 },
        ],
      }).expect(201)
    ).body as Doc;
    expect(opening).toMatchObject({ docNo: 'OB-20261001-001', entry: null, costEntry: null });
    // 단가를 비우면 품목 구매단가
    expect(opening.lines.map((l) => [l.unitPrice, l.supply])).toEqual([
      [40_000, 400_000],
      [60_000, 300_000],
    ]);
    expect(await reconcile()).toMatchObject({
      balanced: false,
      rows: [
        { code: '146', stockValue: 400_000, ledgerBalance: 0, difference: -400_000 },
        { code: '150', stockValue: 300_000, ledgerBalance: 0, difference: -300_000 },
      ],
    });
    // 장부에 기초 재고자산을 넣으면 일치한다
    await owner
      .post('/api/journals')
      .send({
        entry: {
          entryDate: '2026-10-01',
          description: '기초 재고자산',
          lines: [
            { accountId: acc['146'], debit: 400_000, credit: 0 },
            { accountId: acc['150'], debit: 300_000, credit: 0 },
            { accountId: acc['331'], debit: 0, credit: 700_000 },
          ],
        },
        status: 'posted',
      })
      .expect(201);
    expect((await reconcile()).balanced).toBe(true);
  });

  it('창고 이동은 수량만 옮기고 원가·전표는 그대로, 보내는 창고에 없으면 막는다', async () => {
    expect(
      (
        await create({
          kind: 'transfer',
          docDate: '2026-10-02',
          warehouseId: main,
          lines: [{ itemId: item.toner, qty: 1 }],
        }).expect(400)
      ).body,
    ).toMatchObject({ code: 'TO_WAREHOUSE_REQUIRED' });
    expect(
      (
        await create({
          kind: 'transfer',
          docDate: '2026-10-02',
          warehouseId: main,
          toWarehouseId: main,
          lines: [{ itemId: item.toner, qty: 1 }],
        }).expect(400)
      ).body,
    ).toMatchObject({ code: 'SAME_WAREHOUSE' });
    expect(
      (
        await create({
          kind: 'transfer',
          docDate: '2026-10-02',
          warehouseId: main,
          toWarehouseId: center,
          lines: [{ itemId: item.install, qty: 1 }],
        }).expect(400)
      ).body,
    ).toMatchObject({ code: 'SERVICE_ITEM_NOT_ALLOWED' });

    transfer = (
      await create({
        kind: 'transfer',
        docDate: '2026-10-02',
        warehouseId: main,
        toWarehouseId: center,
        lines: [{ itemId: item.toner, qty: 4, unitPrice: 99_999 }],
      }).expect(201)
    ).body;
    expect(transfer).toMatchObject({
      docNo: 'TR-20261002-001',
      warehouseName: '본사창고',
      toWarehouseName: '물류센터',
      supplyTotal: 0,
      entry: null,
      costEntry: null,
    });
    const all = await stock();
    expect(all.get('토너')).toMatchObject({ totalQty: 10, value: 400_000 });
    expect((await stock({ warehouseId: main })).get('토너')!.qty).toBe(6);
    expect((await stock({ warehouseId: center })).get('토너')!.qty).toBe(4);

    const short = await create({
      kind: 'transfer',
      docDate: '2026-10-02',
      warehouseId: center,
      toWarehouseId: main,
      lines: [{ itemId: item.toner, qty: 5 }],
    }).expect(409);
    expect(short.body).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(short.body.message).toMatch(/물류센터/);
  });

  it('재고 실사: 장부와 다른 품목만 조정하고 줄면 매출원가/재고자산, 늘면 그 반대 전표', async () => {
    // 물류센터에서 3개 판매 → 장부 1개
    await create({
      kind: 'sale',
      docDate: '2026-10-03',
      partnerId: customer,
      warehouseId: center,
      lines: [{ itemId: item.toner, qty: 3 }],
    }).expect(201);

    expect(
      (
        await create({
          kind: 'adjustment',
          docDate: '2026-10-05',
          warehouseId: center,
          lines: [{ itemId: item.toner, qty: 1 }],
        }).expect(400)
      ).body,
    ).toMatchObject({ code: 'USE_STOCK_COUNT' });
    expect(
      (
        await count({
          docDate: '2026-10-05',
          warehouseId: main,
          counts: [
            { itemId: item.toner, countedQty: 6 },
            { itemId: item.toner, countedQty: 5 },
          ],
        }).expect(400)
      ).body,
    ).toMatchObject({ code: 'DUPLICATE_ITEM' });
    expect(
      (
        await count({
          docDate: '2026-10-05',
          warehouseId: main,
          counts: [{ itemId: item.toner, countedQty: 6 }],
        }).expect(400)
      ).body,
    ).toMatchObject({ code: 'NO_DIFFERENCE' });

    // 감모: 물류센터 토너 장부 1 → 실사 0
    const loss = (
      await count({
        docDate: '2026-10-05',
        warehouseId: center,
        counts: [{ itemId: item.toner, countedQty: 0 }],
      }).expect(201)
    ).body as Doc;
    expect(loss).toMatchObject({ kind: 'adjustment', docNo: 'AD-20261005-001', entry: null });
    expect(loss.lines.map((l) => l.qty)).toEqual([-1]);
    const lossEntry = await journal(loss.costEntry!.id);
    expect(lines(lossEntry)).toEqual(['146 0/40000', '451 40000/0']);
    expect(lossEntry.description).toMatch(/^\[재고조정\] AD-20261005-001/);

    // 과잉: 본사창고 제품A 장부 5 → 실사 6, 토너는 같으므로 줄에서 빠진다
    const gain = (
      await count({
        docDate: '2026-10-05',
        warehouseId: main,
        memo: '10월 정기 실사',
        counts: [
          { itemId: item.toner, countedQty: 6 },
          { itemId: item.product, countedQty: 6 },
        ],
      }).expect(201)
    ).body as Doc;
    expect(gain.lines).toMatchObject([{ itemId: item.product, qty: 1 }]);
    expect(lines(await journal(gain.costEntry!.id))).toEqual(['150 60000/0', '455 0/60000']);

    const after = await stock();
    expect(after.get('토너')).toMatchObject({ totalQty: 6, value: 240_000 });
    expect(after.get('제품A')).toMatchObject({ totalQty: 6, value: 360_000 });
    expect(await reconcile()).toMatchObject({
      balanced: true,
      rows: [
        { code: '146', stockValue: 240_000, ledgerBalance: 240_000 },
        { code: '150', stockValue: 360_000, ledgerBalance: 360_000 },
      ],
    });
  });

  it('수불현황: 회사 전체는 창고 이동을 빼고, 창고를 고르면 이동도 입출고로 센다', async () => {
    type Summary = {
      rows: {
        name: string;
        in: { qty: number; value: number };
        out: { qty: number; value: number };
        closing: { qty: number; value: number };
      }[];
    };
    const summary = async (query: object) =>
      (
        (
          await owner
            .get('/api/inventory/summary')
            .query({ from: '2026-10-01', to: '2026-10-31', ...query })
            .expect(200)
        ).body as Summary
      ).rows.find((r) => r.name === '토너')!;
    expect(await summary({})).toMatchObject({
      in: { qty: 10, value: 400_000 },
      out: { qty: 4, value: 160_000 },
      closing: { qty: 6, value: 240_000 },
    });
    expect(await summary({ warehouseId: center })).toMatchObject({
      in: { qty: 4 },
      out: { qty: 4 },
      closing: { qty: 0 },
    });
  });

  it('적정재고 미달: 회사 전체 수량이 적정재고보다 적은 품목과 모자란 수량', async () => {
    expect((await owner.get('/api/inventory/alerts').expect(200)).body).toEqual([]);
    await owner.patch(`/api/items/${item.toner}`).send({ safetyStock: 10 }).expect(200);
    await owner.patch(`/api/items/${item.product}`).send({ safetyStock: 6 }).expect(200);
    expect((await owner.get('/api/inventory/alerts').expect(200)).body).toEqual([
      {
        itemId: item.toner,
        code: expect.any(String),
        name: '토너',
        unit: 'BOX',
        qty: 6,
        safetyStock: 10,
        shortfall: 4,
      },
    ]);
  });

  it('받은 재고를 이미 쓴 창고 이동은 취소하지 못한다', async () => {
    const res = await owner
      .post(`/api/trade-docs/${transfer.id}/cancel`)
      .send({ reason: '입력 오류' })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(res.body.message).toMatch(/취소하면 재고가 모자랍니다/);
  });
});
