import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDb, type Database, partners } from '@wellbuddy/db';
import { TEST_DATABASE_URL_OWNER, truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

describe('회계 기초정보', () => {
  let app: NestExpressApplication;
  let db: Database;
  let owner: Agent;
  let approver: Agent;
  let employee: Agent;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    db = createDb(TEST_DATABASE_URL_OWNER, { max: 1 });
    ({ agent: owner } = await ownerWithCompany(app, 'owner@master.local', '기초상사'));
    approver = await inviteAndJoin(app, owner, 'approver@master.local', 'approver');
    employee = await inviteAndJoin(app, owner, 'emp@master.local', 'employee');
  });

  afterAll(async () => {
    await db.$client.end();
    await app.close();
  });

  describe('계정과목', () => {
    it('회사를 만들면 표준 계정과목이 들어 있다', async () => {
      const res = await owner.get('/api/accounts').expect(200);
      expect(res.body.length).toBeGreaterThan(100);
      expect(res.body.find((a: { code: string }) => a.code === '108')).toMatchObject({
        name: '외상매출금',
        group: 'quick_assets',
        normalBalance: 'debit',
        requiresPartner: true,
        isSystem: true,
      });
      const search = await owner.get('/api/accounts').query({ q: '복리' }).expect(200);
      expect(search.body.map((a: { code: string }) => a.code)).toContain('811');
    });

    it('계정을 추가·수정·삭제하고, 표준 계정은 코드·구분을 바꾸거나 지울 수 없다', async () => {
      const created = await owner
        .post('/api/accounts')
        .send({ code: '849', name: '구독료', group: 'sga' })
        .expect(201);
      expect(created.body).toMatchObject({ normalBalance: 'debit', isSystem: false });

      const dup = await owner
        .post('/api/accounts')
        .send({ code: '849', name: '중복', group: 'sga' })
        .expect(409);
      expect(dup.body.code).toBe('DUPLICATE_CODE');
      await owner
        .post('/api/accounts')
        .send({ code: '84', name: '짧음', group: 'sga' })
        .expect(400);

      const accounts = (await owner.get('/api/accounts').expect(200)).body as {
        id: string;
        code: string;
      }[];
      const welfare = accounts.find((a) => a.code === '811')!;
      await owner
        .patch(`/api/accounts/${welfare.id}`)
        .send({ name: '복리후생비(직원)' })
        .expect(200);
      const locked = await owner
        .patch(`/api/accounts/${welfare.id}`)
        .send({ code: '899' })
        .expect(400);
      expect(locked.body.code).toBe('SYSTEM_ACCOUNT_LOCKED');
      await owner.delete(`/api/accounts/${welfare.id}`).expect(400);

      await owner.patch(`/api/accounts/${welfare.id}`).send({ isActive: false }).expect(200);
      const active = (await owner.get('/api/accounts').expect(200)).body as { code: string }[];
      expect(active.map((a) => a.code)).not.toContain('811');
      const all = (await owner.get('/api/accounts').query({ includeInactive: 'true' }).expect(200))
        .body;
      expect(all.map((a: { code: string }) => a.code)).toContain('811');

      await owner.delete(`/api/accounts/${created.body.id}`).expect(204);
      const restored = await owner.post('/api/accounts/restore-standard').expect(200);
      expect(restored.body.added).toBe(0);
    });

    it('계정별 적요를 관리한다', async () => {
      const accounts = (await owner.get('/api/accounts').expect(200)).body as {
        id: string;
        code: string;
      }[];
      const travel = accounts.find((a) => a.code === '812')!;
      const memo = await owner
        .post(`/api/accounts/${travel.id}/memos`)
        .send({ text: '출장 교통비' })
        .expect(201);
      expect((await owner.get(`/api/accounts/${travel.id}/memos`).expect(200)).body).toEqual([
        { id: memo.body.id, text: '출장 교통비' },
      ]);
      await owner.delete(`/api/accounts/${travel.id}/memos/${memo.body.id}`).expect(204);
    });

    it('결재자는 조회만, 일반 사원은 볼 수 없다', async () => {
      await approver.get('/api/accounts').expect(200);
      await approver
        .post('/api/accounts')
        .send({ code: '850', name: 'x', group: 'sga' })
        .expect(403);
      await employee.get('/api/accounts').expect(403);
    });
  });

  describe('거래처', () => {
    it('코드를 자동으로 부여하고 계좌번호는 암호화해 끝 4자리만 보여준다', async () => {
      const a = await owner
        .post('/api/partners')
        .send({
          name: '(주)한빛상사',
          kind: 'customer',
          bizRegNo: '124-81-00998',
          bankName: '국민은행',
          bankAccount: '123456-01-234567',
        })
        .expect(201);
      expect(a.body).toMatchObject({
        code: '00001',
        bizRegNo: '1248100998',
        bankAccountMasked: '****4567',
      });
      expect(a.body).not.toHaveProperty('bankAccountEnc');
      const b = await owner.post('/api/partners').send({ name: '개인 거래처' }).expect(201);
      expect(b.body).toMatchObject({ code: '00002', kind: 'both', bizRegNo: null });

      const [row] = await db.select().from(partners).limit(1);
      expect(row!.bankAccountEnc).toMatch(/^v1:/);
      expect(row!.bankAccountEnc).not.toContain('234567');
    });

    it('사업자등록번호를 검증하고 중복을 막는다', async () => {
      const invalid = await owner
        .post('/api/partners')
        .send({ name: 'x', bizRegNo: '123-45-67890' })
        .expect(400);
      expect(invalid.body.details[0].path).toBe('bizRegNo');
      const dup = await owner
        .post('/api/partners')
        .send({ name: 'y', bizRegNo: '1248100998' })
        .expect(409);
      expect(dup.body.message).toContain('사업자등록번호');
    });

    it('이름·사업자번호로 검색하고, 수정할 수 있다', async () => {
      const byName = await owner.get('/api/partners').query({ q: '한빛' }).expect(200);
      expect(byName.body).toHaveLength(1);
      const byBiz = await owner.get('/api/partners').query({ q: '124-81' }).expect(200);
      expect(byBiz.body).toHaveLength(1);
      const updated = await owner
        .patch(`/api/partners/${byName.body[0].id}`)
        .send({ phone: '02-000-0000', bankAccount: '' })
        .expect(200);
      expect(updated.body).toMatchObject({ phone: '02-000-0000', bankAccountMasked: null });
    });

    it('엑셀(CSV)로 일괄 등록한다(구분은 한글 라벨)', async () => {
      const csv = [
        '거래처명,구분,사업자등록번호,대표자',
        '(주)한빛상사,매출처,124-81-00998,김대표',
        '새거래처,매입처,220-81-12341,이대표',
        '잘못된구분,거래처,,',
      ].join('\n');
      const preview = await owner
        .post('/api/imports/partners/preview')
        .attach('file', Buffer.from(csv), 'partners.csv')
        .expect(200);
      expect(preview.body).toMatchObject({ total: 3, valid: 2, invalid: 1 });
      const res = await owner
        .post('/api/imports/partners/commit?skipInvalid=true')
        .attach('file', Buffer.from(csv), 'partners.csv')
        .expect(200);
      expect(res.body).toEqual({ created: 1, updated: 1, skipped: 1 });
      const list = (await owner.get('/api/partners').expect(200)).body as {
        name: string;
        kind: string;
        representative: string;
      }[];
      expect(list.find((p) => p.name === '새거래처')).toMatchObject({ kind: 'supplier' });
      expect(list.find((p) => p.name === '(주)한빛상사')).toMatchObject({
        representative: '김대표',
      });
    });

    it('다른 회사의 거래처는 보이지 않는다', async () => {
      const { agent: other } = await ownerWithCompany(app, 'other@master.local', '다른상사');
      expect((await other.get('/api/partners').expect(200)).body).toEqual([]);
    });
  });

  describe('부서·프로젝트', () => {
    it('부서와 프로젝트를 관리한다', async () => {
      const dept = await owner
        .post('/api/departments')
        .send({ code: 'D10', name: '영업팀' })
        .expect(201);
      await owner.post('/api/departments').send({ code: 'D10', name: '중복' }).expect(409);
      await owner.patch(`/api/departments/${dept.body.id}`).send({ name: '영업1팀' }).expect(200);
      expect((await owner.get('/api/departments').expect(200)).body).toMatchObject([
        { code: 'D10', name: '영업1팀' },
      ]);

      const bad = await owner
        .post('/api/projects')
        .send({ code: 'P1', name: '신사옥', startDate: '2026-12-01', endDate: '2026-01-01' })
        .expect(400);
      expect(bad.body.details[0].path).toBe('endDate');
      const project = await owner
        .post('/api/projects')
        .send({ code: 'P1', name: '신사옥', startDate: '2026-01-01', endDate: '2026-12-31' })
        .expect(201);
      expect(project.body).toMatchObject({ startDate: '2026-01-01', endDate: '2026-12-31' });
      await owner.delete(`/api/projects/${project.body.id}`).expect(204);
      await owner.delete(`/api/departments/${dept.body.id}`).expect(204);
    });
  });
});
