import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TEST_DATABASE_URL } from '@wellbuddy/db/testing';
import { createApp } from '../src/app.factory.js';
import { type AppConfig, loadConfig } from '../src/config/env.js';
import { MailService } from '../src/mail/mail.service.js';

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    FIELD_ENCRYPTION_KEY_ID: 'test',
    ...overrides,
  });
}

/** 실제 DB·Redis(테스트용)에 붙는 API 앱을 띄운다. */
export async function createTestApp(config = testConfig()): Promise<NestExpressApplication> {
  const app = await createApp({ config, logger: false });
  await app.init();
  return app;
}

export const TEST_PASSWORD = 'abcd1234';
export type Agent = ReturnType<typeof request.agent>;

export async function signupAgent(app: NestExpressApplication, email: string, name: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/signup').send({ email, password: TEST_PASSWORD, name }).expect(201);
  return agent;
}

/** 가입 + 회사 생성까지 마친 대표 관리자 */
export async function ownerWithCompany(
  app: NestExpressApplication,
  email: string,
  company: string,
) {
  const agent = await signupAgent(app, email, '대표');
  const res = await agent
    .post('/api/companies')
    .send({ name: company, bizRegNo: '000-00-00000' })
    .expect(201);
  return { agent, companyId: res.body.company.id as string };
}

/** 초대 메일의 토큰으로 새 사용자를 가입·수락시켜 구성원으로 만든다. */
export async function inviteAndJoin(
  app: NestExpressApplication,
  inviter: Agent,
  email: string,
  role: 'admin' | 'accountant' | 'approver' | 'employee',
) {
  await inviter.post('/api/invitations').send({ email, role }).expect(201);
  const sent = app.get(MailService).outbox.at(-1)!;
  const token = /\/invite\/([\w-]+)/.exec(sent.text)![1]!;
  const agent = await signupAgent(app, email, role);
  await agent.post('/api/invitations/accept').send({ token }).expect(200);
  return agent;
}
