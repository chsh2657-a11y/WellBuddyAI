import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

interface Doc {
  id: string;
  lines: { id: string; qty: number; lotNo: string | null }[];
}
interface Lot {
  itemName: string;
  lotNo: string;
  warehouseName: string;
  qty: number;
}

/** P3-12 LOT·시리얼 추적: 입력 강제, LOT 별 재고 부족, 시리얼 중복, LOT 재고·이력, LOT 별 실사 */
describe('LOT·시리얼 추적(P3-12)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const item: Record<string, string> = {};
  let supplier: string;
  let customer: string;
  let warehouse: string;
  let center: string;

  const create = (body: object) => owner.post('/api/trade-docs').send(body);
  const receipt = (lines: object[]) =>
    create({ kind: 'receipt', docDate: '2026-10-01', partnerId: supplier, lines });
  const lots = async (query: object = {}) =>
    ((await owner.get('/api/inventory/lots').query(query).expect(200)).body as Lot[]).map(
      (l) => `${l.itemName} ${l.lotNo} ${l.warehouseName} ${l.qty}`,
    );

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@lot.local', '추적상사'));
    supplier = (
      await owner.post('/api/partners').send({ name: '대한제약', kind: 'supplier' }).expect(201)
    ).body.id;
    customer = (
      await owner.post('/api/partners').send({ name: '한빛병원', kind: 'customer' }).expect(201)
    ).body.id;
    warehouse = (await owner.get('/api/warehouses').expect(200)).body[0].id;
    center = (await owner.post('/api/warehouses').send({ name: '물류센터' }).expect(201)).body.id;
    const add = async (key: string, body: object) => {
      item[key] = (await owner.post('/api/items').send(body).expect(201)).body.id;
    };
    await add('vaccine', { name: '백신', unit: 'EA', trackLot: true, salesPrice: 30_000 });
    await add('laptop', { name: '노트북', unit: 'EA', trackSerial: true, salesPrice: 1_500_000 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('LOT·시리얼 품목은 번호가 있어야 하고, 시리얼은 한 줄에 1개씩', async () => {
    expect(
      (await receipt([{ itemId: item.vaccine, qty: 10, unitPrice: 20_000 }]).expect(400)).body,
    ).toMatchObject({ code: 'LOT_REQUIRED', message: expect.stringMatching(/LOT 번호/) });
    expect(
      (
        await receipt([{ itemId: item.laptop, qty: 2, unitPrice: 1_000_000, lotNo: 'SN1' }]).expect(
          400,
        )
      ).body,
    ).toMatchObject({ code: 'SERIAL_QTY' });
    // 견적·주문은 재고를 움직이지 않으므로 번호가 없어도 된다
    await create({
      kind: 'quote',
      docDate: '2026-10-01',
      partnerId: customer,
      lines: [{ itemId: item.vaccine, qty: 3 }],
    }).expect(201);

    await receipt([
      { itemId: item.vaccine, qty: 10, unitPrice: 20_000, lotNo: 'A' },
      { itemId: item.vaccine, qty: 5, unitPrice: 22_000, lotNo: 'B' },
      { itemId: item.laptop, qty: 1, unitPrice: 1_000_000, lotNo: 'SN1' },
      { itemId: item.laptop, qty: 1, unitPrice: 1_000_000, lotNo: 'SN2' },
    ]).expect(201);
    expect(await lots()).toEqual([
      '노트북 SN1 기본창고 1',
      '노트북 SN2 기본창고 1',
      '백신 A 기본창고 10',
      '백신 B 기본창고 5',
    ]);
  });

  it('LOT 별로 재고 부족을 막고, 같은 시리얼이 두 개가 되면 막는다', async () => {
    const short = await create({
      kind: 'shipment',
      docDate: '2026-10-02',
      partnerId: customer,
      lines: [{ itemId: item.vaccine, qty: 12, lotNo: 'A' }],
    }).expect(409);
    expect(short.body).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(short.body.message).toMatch(
      /'백신'\(LOT A\) 재고가 기본창고에서 2026-10-02에 2EA 모자랍니다/,
    );
    await create({
      kind: 'shipment',
      docDate: '2026-10-02',
      partnerId: customer,
      lines: [{ itemId: item.vaccine, qty: 8, lotNo: 'A' }],
    }).expect(201);

    const dup = await receipt([{ itemId: item.laptop, qty: 1, unitPrice: 1, lotNo: 'SN1' }]).expect(
      409,
    );
    expect(dup.body).toMatchObject({ code: 'DUPLICATE_SERIAL', details: { lotNo: 'SN1' } });
    // 창고만 달라도 같은 시리얼은 중복이다
    const dup2 = await create({
      kind: 'opening',
      docDate: '2026-10-03',
      warehouseId: center,
      lines: [{ itemId: item.laptop, qty: 1, lotNo: 'SN2' }],
    }).expect(409);
    expect(dup2.body).toMatchObject({ code: 'DUPLICATE_SERIAL' });
  });

  it('판매한 시리얼을 반품하면 번호를 앞 문서에서 가져와 다시 재고가 되고, 창고 이동도 LOT 를 따른다', async () => {
    const sale = (
      await create({
        kind: 'sale',
        docDate: '2026-10-04',
        partnerId: customer,
        lines: [{ itemId: item.laptop, qty: 1, lotNo: 'SN1' }],
      }).expect(201)
    ).body as Doc;
    expect(await lots({ itemId: item.laptop })).toEqual(['노트북 SN2 기본창고 1']);
    const ret = (
      await create({
        kind: 'sales_return',
        docDate: '2026-10-05',
        partnerId: customer,
        sourceDocId: sale.id,
        lines: [{ itemId: item.laptop, qty: 1, sourceLineId: sale.lines[0]!.id }],
      }).expect(201)
    ).body as Doc;
    expect(ret.lines[0]!.lotNo).toBe('SN1');

    await create({
      kind: 'transfer',
      docDate: '2026-10-06',
      warehouseId: warehouse,
      toWarehouseId: center,
      lines: [{ itemId: item.vaccine, qty: 3, lotNo: 'B' }],
    }).expect(201);
    expect(await lots({ itemId: item.vaccine })).toEqual([
      '백신 A 기본창고 2',
      '백신 B 기본창고 2',
      '백신 B 물류센터 3',
    ]);
    // 시리얼 이동은 중복이 아니다
    await create({
      kind: 'transfer',
      docDate: '2026-10-06',
      warehouseId: warehouse,
      toWarehouseId: center,
      lines: [{ itemId: item.laptop, qty: 1, lotNo: 'SN1' }],
    }).expect(201);
  });

  it('LOT 이력(수불부)과 LOT 별 재고 실사', async () => {
    const ledger = (
      await owner
        .get('/api/inventory/ledger')
        .query({ itemId: item.vaccine, lotNo: 'A', from: '2026-10-01', to: '2026-10-31' })
        .expect(200)
    ).body as { lines: { kindLabel: string; inQty: number; outQty: number; lotNo: string }[] };
    expect(ledger.lines.map((l) => `${l.kindLabel} ${l.inQty}/${l.outQty} ${l.lotNo}`)).toEqual([
      '입고 10/0 A',
      '출고 0/8 A',
    ]);

    const count = (counts: object[]) =>
      owner
        .post('/api/inventory/counts')
        .send({ docDate: '2026-10-07', warehouseId: center, counts });
    expect((await count([{ itemId: item.vaccine, countedQty: 2 }]).expect(400)).body).toMatchObject(
      { code: 'LOT_REQUIRED' },
    );
    const adj = (
      await count([
        { itemId: item.vaccine, lotNo: 'B', countedQty: 2 },
        { itemId: item.laptop, lotNo: 'SN1', countedQty: 1 },
      ]).expect(201)
    ).body as Doc;
    expect(adj.lines.map((l) => [l.qty, l.lotNo])).toEqual([[-1, 'B']]);
    expect(await lots({ warehouseId: center })).toEqual([
      '노트북 SN1 물류센터 1',
      '백신 B 물류센터 2',
    ]);
  });
});
