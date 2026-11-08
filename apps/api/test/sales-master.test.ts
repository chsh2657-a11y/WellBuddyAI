import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface Item {
  id: string;
  code: string;
  name: string;
  kind: string;
  unit: string;
  barcode: string | null;
  salesPrice: number | null;
  purchasePrice: number | null;
  safetyStock: number | null;
  isActive: boolean;
}

/** P3-01~03 품목·창고·거래처별 단가 */
describe('영업·구매·재고 기초정보', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let accountant: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let partnerId: string;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@sales.local', '영업상사'));
    accountant = await inviteAndJoin(app, owner, 'acc@sales.local', 'accountant');
    employee = await inviteAndJoin(app, owner, 'emp@sales.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    partnerId = (
      await owner
        .post('/api/partners')
        .send({ name: '한빛상사', kind: 'customer', bizRegNo: '220-81-12341' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('품목', () => {
    it('코드를 비우면 자동으로 매기고, 기본값(상품·EA·과세)을 채운다', async () => {
      const a = (await accountant.post('/api/items').send({ name: 'A4 복사용지' }).expect(201))
        .body as Item;
      expect(a).toMatchObject({ code: '00001', kind: 'goods', unit: 'EA', vatType: 'taxable' });
      const b = (
        await accountant
          .post('/api/items')
          .send({
            name: '토너',
            kind: 'goods',
            spec: 'HP 85A',
            unit: 'BOX',
            barcode: '8801234567890',
            salesPrice: 55_000,
            purchasePrice: 40_000,
            safetyStock: 2.5,
          })
          .expect(201)
      ).body as Item;
      expect(b).toMatchObject({ code: '00002', barcode: '8801234567890', safetyStock: 2.5 });
    });

    it('같은 코드·바코드는 막는다', async () => {
      const dupCode = await owner.post('/api/items').send({ name: 'x', code: '00001' }).expect(409);
      expect(dupCode.body.message).toContain('코드');
      const dupBarcode = await owner
        .post('/api/items')
        .send({ name: 'y', barcode: '8801234567890' })
        .expect(409);
      expect(dupBarcode.body.message).toContain('바코드');
    });

    it('검색(이름·코드·바코드·규격)·구분 필터·바코드 조회', async () => {
      expect((await owner.get('/api/items').query({ q: '85A' }).expect(200)).body).toHaveLength(1);
      expect((await owner.get('/api/items').query({ q: '8801234' }).expect(200)).body[0].name).toBe(
        '토너',
      );
      expect((await owner.get('/api/items').query({ kind: 'service' }).expect(200)).body).toEqual(
        [],
      );
      expect((await owner.get('/api/items/by-barcode/8801234567890').expect(200)).body.name).toBe(
        '토너',
      );
      const missing = await owner.get('/api/items/by-barcode/0000').expect(404);
      expect(missing.body.code).toBe('ITEM_NOT_FOUND');
    });

    it('서비스 품목은 재고 관련 설정을 쓸 수 없고, 수정할 때도 막는다', async () => {
      await owner
        .post('/api/items')
        .send({ name: '설치비', kind: 'service', trackSerial: true })
        .expect(400);
      const svc = (
        await owner.post('/api/items').send({ name: '설치비', kind: 'service' }).expect(201)
      ).body as Item;
      const toner = (await owner.get('/api/items').query({ q: '토너' }).expect(200))
        .body[0] as Item;
      // 적정재고가 있는 상품을 서비스로 바꾸면 거부
      const res = await owner.patch(`/api/items/${toner.id}`).send({ kind: 'service' }).expect(400);
      expect(res.body.code).toBe('ITEM_SERVICE_STOCK');
      await owner.patch(`/api/items/${svc.id}`).send({ trackLot: true }).expect(400);
    });

    it('수정은 보낸 필드만 바꾼다(구분·단위가 기본값으로 돌아가지 않는다)', async () => {
      const toner = (await owner.get('/api/items').query({ q: '토너' }).expect(200))
        .body[0] as Item;
      const updated = (
        await owner.patch(`/api/items/${toner.id}`).send({ salesPrice: 60_000 }).expect(200)
      ).body as Item;
      expect(updated).toMatchObject({ unit: 'BOX', kind: 'goods', salesPrice: 60_000 });

      // 거래처도 같은 규칙(예전에는 구분이 '매출·매입'으로 돌아갔다)
      const partner = (
        await owner.patch(`/api/partners/${partnerId}`).send({ phone: '02-1234-5678' }).expect(200)
      ).body;
      expect(partner).toMatchObject({ kind: 'customer', phone: '02-1234-5678' });
    });

    it('매출 계정은 매출액, 매입 계정은 재고자산(서비스는 비용)만 고를 수 있다', async () => {
      const bad = await owner
        .post('/api/items')
        .send({ name: '잘못된 계정', salesAccountId: acc['146'] })
        .expect(400);
      expect(bad.body.code).toBe('ITEM_ACCOUNT_INVALID');
      await owner
        .post('/api/items')
        .send({ name: '제품A', kind: 'product', purchaseAccountId: acc['831'] })
        .expect(400);
      const ok = await owner
        .post('/api/items')
        .send({
          name: '제품A',
          kind: 'product',
          salesAccountId: acc['404'],
          purchaseAccountId: acc['150'],
        })
        .expect(201);
      expect(ok.body).toMatchObject({ salesAccountId: acc['404'], purchaseAccountId: acc['150'] });
      await owner
        .post('/api/items')
        .send({ name: '유지보수', kind: 'service', purchaseAccountId: acc['831'] })
        .expect(201);
    });

    it('엑셀(CSV)로 일괄 등록한다(구분·과세는 한글, 금액은 쉼표 허용, 코드가 같으면 수정)', async () => {
      const csv = [
        '품목코드,품목명,구분,규격,단위,바코드,과세구분,판매단가,구매단가,적정재고',
        '00001,A4 복사용지(수정),상품,80g,BOX,,과세,"25,000",,10',
        ',쌀 10kg,상품,,포대,8809999000011,면세,32000,,',
        ',잘못된 구분,부품,,,,,,,',
      ].join('\n');
      const preview = await owner
        .post('/api/imports/items/preview')
        .attach('file', Buffer.from(csv), 'items.csv')
        .expect(200);
      expect(preview.body).toMatchObject({ total: 3, valid: 2, invalid: 1 });
      const res = await owner
        .post('/api/imports/items/commit?skipInvalid=true')
        .attach('file', Buffer.from(csv), 'items.csv')
        .expect(200);
      expect(res.body).toEqual({ created: 1, updated: 1, skipped: 1 });
      const list = (await owner.get('/api/items').expect(200)).body as (Item & {
        vatType: string;
      })[];
      expect(list.find((i) => i.code === '00001')).toMatchObject({
        name: 'A4 복사용지(수정)',
        unit: 'BOX',
        salesPrice: 25_000,
        safetyStock: 10,
      });
      expect(list.find((i) => i.name === '쌀 10kg')).toMatchObject({
        vatType: 'exempt',
        unit: '포대',
        barcode: '8809999000011',
      });
    });

    it('삭제하고, 사용중지한 품목은 기본 목록에서 빠진다', async () => {
      const item = (await owner.post('/api/items').send({ name: '임시' }).expect(201)).body as Item;
      await owner.patch(`/api/items/${item.id}`).send({ isActive: false }).expect(200);
      const active = (await owner.get('/api/items').expect(200)).body as Item[];
      expect(active.some((i) => i.id === item.id)).toBe(false);
      const all = (await owner.get('/api/items').query({ includeInactive: 'true' }).expect(200))
        .body as Item[];
      expect(all.some((i) => i.id === item.id)).toBe(true);
      await owner.delete(`/api/items/${item.id}`).expect(204);
      await owner.get(`/api/items/${item.id}`).expect(404);
    });
  });

  describe('창고', () => {
    it('처음 열면 기본창고(W01)가 있고, 새 창고는 W02 부터 매긴다', async () => {
      const list = (await accountant.get('/api/warehouses').expect(200)).body;
      expect(list).toEqual([expect.objectContaining({ code: 'W01', name: '기본창고' })]);
      // 다시 열어도 하나만
      expect((await accountant.get('/api/warehouses').expect(200)).body).toHaveLength(1);
      const w2 = await accountant.post('/api/warehouses').send({ name: '부산창고' }).expect(201);
      expect(w2.body).toMatchObject({ code: 'W02', isActive: true });
      await accountant.post('/api/warehouses').send({ name: '중복', code: 'W02' }).expect(409);
      const renamed = await accountant
        .patch(`/api/warehouses/${w2.body.id}`)
        .send({ address: '부산 강서구' })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: '부산창고', address: '부산 강서구' });
      await accountant.delete(`/api/warehouses/${w2.body.id}`).expect(204);
    });
  });

  describe('거래처별 단가', () => {
    it('거래처별 단가가 품목 기본 단가보다 먼저 쓰인다', async () => {
      const toner = (await owner.get('/api/items').query({ q: '토너' }).expect(200))
        .body[0] as Item;
      const price = (side: string, partner?: string) =>
        owner
          .get(`/api/items/${toner.id}/price`)
          .query({ side, ...(partner ? { partnerId: partner } : {}) })
          .expect(200)
          .then((r) => r.body);

      expect(await price('sales', partnerId)).toEqual({ unitPrice: 60_000, source: 'item' });
      const saved = await owner
        .put('/api/partner-prices')
        .send({ partnerId, itemId: toner.id, salesPrice: 52_000 })
        .expect(200);
      expect(saved.body).toMatchObject({ partnerName: '한빛상사', itemName: '토너' });
      expect(await price('sales', partnerId)).toEqual({ unitPrice: 52_000, source: 'partner' });
      // 구매단가는 거래처 단가가 없으므로 품목 단가
      expect(await price('purchase', partnerId)).toEqual({ unitPrice: 40_000, source: 'item' });
      expect(await price('sales')).toEqual({ unitPrice: 60_000, source: 'item' });

      // 다시 PUT 하면 같은 줄을 고친다
      const again = await owner
        .put('/api/partner-prices')
        .send({ partnerId, itemId: toner.id, salesPrice: 50_000, purchasePrice: 39_000 })
        .expect(200);
      expect(again.body.id).toBe(saved.body.id);
      const list = (await owner.get('/api/partner-prices').query({ partnerId }).expect(200)).body;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ salesPrice: 50_000, purchasePrice: 39_000 });

      await owner.delete(`/api/partner-prices/${saved.body.id}`).expect(204);
      expect(await price('sales', partnerId)).toEqual({ unitPrice: 60_000, source: 'item' });

      // 단가가 하나도 없으면 400
      await owner.put('/api/partner-prices').send({ partnerId, itemId: toner.id }).expect(400);
    });

    it('단가가 정해지지 않은 품목은 null', async () => {
      const item = (await owner.post('/api/items').send({ name: '무단가' }).expect(201)).body;
      expect((await owner.get(`/api/items/${item.id}/price`).expect(200)).body).toEqual({
        unitPrice: null,
        source: null,
      });
    });
  });

  describe('권한·격리', () => {
    it('직원은 볼 수 없고, 다른 회사의 품목·거래처는 쓸 수 없다', async () => {
      await employee.get('/api/items').expect(403);
      await employee.get('/api/warehouses').expect(403);

      const { agent: other } = await ownerWithCompany(app, 'other@sales.local', '다른상사');
      expect((await other.get('/api/items').expect(200)).body).toEqual([]);
      const otherItem = (await other.post('/api/items').send({ name: '남의 품목' }).expect(201))
        .body;
      expect(otherItem.code).toBe('00001');
      // 다른 회사 거래처로 단가를 넣으면 거부
      await other
        .put('/api/partner-prices')
        .send({ partnerId, itemId: otherItem.id, salesPrice: 1000 })
        .expect(400);
      // 다른 회사 계정을 품목 계정으로 쓰면 거부
      await other.post('/api/items').send({ name: '계정', salesAccountId: acc['401'] }).expect(400);
      await owner.get(`/api/items/${otherItem.id}`).expect(404);
    });
  });
});
