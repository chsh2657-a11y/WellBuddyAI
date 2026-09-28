import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDb, type Database, refreshTokens } from '@wellbuddy/db';
import { TEST_DATABASE_URL_OWNER, truncateAll } from '@wellbuddy/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createTestApp } from './helpers.js';

const password = 'abcd1234';

function setCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as string | string[] | undefined;
  return header === undefined ? [] : ([] as string[]).concat(header);
}

function cookieValue(res: request.Response, name: string): string | undefined {
  const found = setCookies(res).find((c) => c.startsWith(`${name}=`));
  return found?.split(';')[0]?.slice(name.length + 1);
}

describe('인증 흐름', () => {
  let app: NestExpressApplication;
  let owner: Database;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    owner = createDb(TEST_DATABASE_URL_OWNER, { max: 1 });
  });

  afterAll(async () => {
    await owner.$client.end();
    await app.close();
  });

  it('가입하면 쿠키가 발급되고, 회사 선택 전 세션을 돌려준다', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post('/api/auth/signup')
      .send({ email: 'Kim@Test.local', password, name: '김경리' })
      .expect(201);
    expect(res.body).toMatchObject({ user: { email: 'kim@test.local' }, companyId: null });
    expect(res.body.accessToken).toBeUndefined();
    expect(cookieValue(res, 'wb_at')).toBeTruthy();
    expect(cookieValue(res, 'wb_rt')).toBeTruthy();
    expect(setCookies(res).join(';')).toMatch(/HttpOnly/);

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ company: null, role: null, companies: [] });
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });

  it('같은 이메일로 다시 가입할 수 없다', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'kim@test.local', password, name: '중복' })
      .expect(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('입력값 오류는 한국어 메시지와 함께 400 으로 응답한다', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'bad', password: 'short', name: '' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    const paths = new Set(res.body.details.map((d: { path: string }) => d.path));
    expect([...paths].sort()).toEqual(['email', 'name', 'password']);
  });

  it('비밀번호가 틀리면 로그인할 수 없다', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'kim@test.local', password: 'wrong1234' })
      .expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password })
      .expect(401);
  });

  it('로그인하지 않으면 보호된 API 에 접근할 수 없다', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('리프레시 토큰은 사용할 때마다 교체되고, 재사용하면 전체 세션을 폐기한다', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'kim@test.local', password })
      .expect(200);
    const firstRefresh = cookieValue(login, 'wb_rt')!;

    const rotated = await agent.post('/api/auth/refresh').expect(200);
    const secondRefresh = cookieValue(rotated, 'wb_rt')!;
    expect(secondRefresh).toBeTruthy();
    expect(secondRefresh).not.toBe(firstRefresh);

    // 유예 시간(10초)이 지난 것으로 만들고 옛 토큰을 다시 사용 → 탈취로 간주
    await owner.execute(
      sql`update refresh_tokens set revoked_at = now() - interval '1 minute' where revoked_at is not null`,
    );
    const reused = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `wb_rt=${firstRefresh}`)
      .expect(401);
    expect(reused.body.code).toBe('REFRESH_REUSED');

    // 같은 family 의 최신 토큰도 폐기되었다
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `wb_rt=${secondRefresh}`)
      .expect(401);
    const [first] = await owner
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, createHash('sha256').update(firstRefresh).digest('hex')));
    const stillActive = await owner
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, first!.familyId), isNull(refreshTokens.revokedAt)));
    expect(stillActive).toHaveLength(0);
  });

  it('로그아웃하면 리프레시 토큰을 더 쓸 수 없다', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'kim@test.local', password })
      .expect(200);
    const refresh = cookieValue(login, 'wb_rt')!;
    await agent.post('/api/auth/logout').expect(204);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `wb_rt=${refresh}`)
      .expect(401);
  });

  it('모바일(x-auth-mode: token)은 응답 본문으로 토큰을 받고 Bearer 로 인증한다', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-auth-mode', 'token')
      .send({ email: 'kim@test.local', password })
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeTruthy();
    expect(setCookies(login)).toEqual([]);

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    const refreshed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('x-auth-mode', 'token')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);
  });
});
