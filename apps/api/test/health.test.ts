import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('GET /api/health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('DB 와 Redis 가 정상이면 ok 를 돌려준다', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('없는 경로는 한국어 404 오류 형식으로 응답한다', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
