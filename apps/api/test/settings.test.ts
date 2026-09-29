import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDb, type Database, integrationSettings } from '@wellbuddy/db';
import { TEST_DATABASE_URL_OWNER, truncateAll } from '@wellbuddy/db/testing';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

describe('설정: 메뉴 사용 여부·연동관리', () => {
  let app: NestExpressApplication;
  let db: Database;
  let owner: Agent;
  let employee: Agent;
  let accountant: Agent;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    db = createDb(TEST_DATABASE_URL_OWNER, { max: 1 });
    ({ agent: owner } = await ownerWithCompany(app, 'owner@settings.local', '설정상사'));
    employee = await inviteAndJoin(app, owner, 'emp@settings.local', 'employee');
    accountant = await inviteAndJoin(app, owner, 'acc@settings.local', 'accountant');
  });

  afterAll(async () => {
    await db.$client.end();
    await app.close();
  });

  describe('메뉴 사용 여부', () => {
    it('기본값은 모든 메뉴 사용이고, 끄면 세션에 반영된다(필수 메뉴는 끌 수 없다)', async () => {
      const initial = await owner.get('/api/settings/modules').expect(200);
      expect(initial.body.every((m: { enabled: boolean }) => m.enabled)).toBe(true);

      const updated = await owner
        .put('/api/settings/modules')
        .send({ enabledModules: { accounting: false, settings: false, unknown: false } })
        .expect(200);
      const byKey = Object.fromEntries(
        updated.body.map((m: { key: string; enabled: boolean }) => [m.key, m.enabled]),
      );
      expect(byKey).toMatchObject({ accounting: false, settings: true, dashboard: true });
      expect(byKey).not.toHaveProperty('unknown');

      const me = await owner.get('/api/auth/me').expect(200);
      expect(me.body.enabledModules).toMatchObject({ accounting: false, settings: true });
    });

    it('권한이 없으면 메뉴 설정을 바꿀 수 없다', async () => {
      await employee.get('/api/settings/modules').expect(403);
      await accountant.put('/api/settings/modules').send({ enabledModules: {} }).expect(403);
    });
  });

  describe('연동관리', () => {
    it('모든 채널의 기본 상태를 돌려준다', async () => {
      const res = await owner.get('/api/integrations').expect(200);
      expect(res.body.map((c: { channel: string }) => c.channel)).toEqual([
        'bank',
        'card',
        'hometax',
        'taxinvoice',
        'ocr',
        'bizcheck',
        'ai',
      ]);
      expect(res.body[0]).toMatchObject({ enabled: false, provider: 'file', schedule: 'manual' });
    });

    it('모의 데이터 공급자를 켜고 연결 테스트에 성공한다', async () => {
      const saved = await owner
        .put('/api/integrations/bank')
        .send({ enabled: true, provider: 'mock', schedule: 'daily' })
        .expect(200);
      expect(saved.body).toMatchObject({ enabled: true, provider: 'mock', schedule: 'daily' });

      const test = await owner.post('/api/integrations/bank/test').expect(200);
      expect(test.body.ok).toBe(true);
      const list = await owner.get('/api/integrations').expect(200);
      expect(list.body[0]).toMatchObject({ lastStatus: 'success' });
      expect(list.body[0].lastRunAt).toBeTruthy();
    });

    it('실연동을 켜려면 필수 자격증명이 있어야 한다', async () => {
      const res = await owner
        .put('/api/integrations/hometax')
        .send({ enabled: true, provider: 'codef', credentials: { clientId: 'abc' } })
        .expect(400);
      expect(res.body.code).toBe('CREDENTIALS_REQUIRED');
      expect(res.body.details.fields).toEqual(['clientSecret', 'publicKey']);
    });

    it('자격증명은 암호화해 저장하고, 응답에서는 비밀 값을 가린다', async () => {
      const secret = 'super-secret-value-1234';
      const res = await owner
        .put('/api/integrations/hometax')
        .send({
          enabled: true,
          provider: 'codef',
          credentials: {
            clientId: 'client-abc',
            clientSecret: secret,
            publicKey: 'PUBKEY-XYZ-123',
          },
        })
        .expect(200);
      expect(res.body.credentials.clientId).toBe('client-abc');
      expect(res.body.credentials.clientSecret).not.toContain('secret-value');
      expect(res.body.credentials.clientSecret).toMatch(/^su\*+34$/);

      const [row] = await db
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.channel, 'hometax'));
      expect(row!.credentialsEnc).toMatch(/^v1:test:/);
      expect(row!.credentialsEnc).not.toContain(secret);
      expect(row!.credentialsEnc).not.toContain('client-abc');
    });

    it('빈 값으로 저장하면 기존 비밀 값을 유지한다', async () => {
      const res = await owner
        .put('/api/integrations/hometax')
        .send({
          enabled: true,
          provider: 'codef',
          credentials: { clientId: 'client-new', clientSecret: '', publicKey: '' },
        })
        .expect(200);
      expect(res.body.credentials).toMatchObject({ clientId: 'client-new' });
      expect(res.body.credentials.clientSecret).toMatch(/^su\*+34$/);
    });

    it('실연동 연결 테스트는 P2 안내와 함께 실패로 기록된다', async () => {
      const res = await owner.post('/api/integrations/hometax/test').expect(200);
      expect(res.body).toMatchObject({ ok: false });
      expect(res.body.message).toMatch(/P2/);
      const list = await owner.get('/api/integrations').expect(200);
      const hometax = list.body.find((c: { channel: string }) => c.channel === 'hometax');
      expect(hometax).toMatchObject({ lastStatus: 'error', enabled: true, provider: 'codef' });
    });

    it('채널에 없는 공급자는 고를 수 없다', async () => {
      const res = await owner
        .put('/api/integrations/bank')
        .send({ enabled: false, provider: 'popbill' })
        .expect(400);
      expect(res.body.code).toBe('UNKNOWN_PROVIDER');
      await owner
        .put('/api/integrations/nope')
        .send({ enabled: false, provider: 'mock' })
        .expect(400);
    });

    it('경리는 연동을 관리할 수 있고, 일반 사원은 볼 수 없다', async () => {
      await accountant
        .put('/api/integrations/card')
        .send({ enabled: true, provider: 'file' })
        .expect(200);
      await employee.get('/api/integrations').expect(403);
    });

    it('다른 회사로 옮긴 암호문은 복호화되지 않는다(회사·채널에 묶인 암호화)', async () => {
      const { agent: other, companyId: otherId } = await ownerWithCompany(
        app,
        'other@settings.local',
        '다른상사',
      );
      await other
        .put('/api/integrations/hometax')
        .send({ enabled: false, provider: 'codef' })
        .expect(200);
      const [source] = await db
        .select()
        .from(integrationSettings)
        .where(
          and(
            eq(integrationSettings.channel, 'hometax'),
            ne(integrationSettings.companyId, otherId),
          ),
        );
      expect(source!.credentialsEnc).toBeTruthy();
      // 소유자 롤로 암호문을 다른 회사 행에 복사해도 그 회사에서는 읽을 수 없다
      await db
        .update(integrationSettings)
        .set({ credentialsEnc: source!.credentialsEnc })
        .where(eq(integrationSettings.companyId, otherId));
      const res = await other.get('/api/integrations').expect(200);
      const hometax = res.body.find((c: { channel: string }) => c.channel === 'hometax');
      expect(hometax.credentials).toEqual({});
    });
  });
});
