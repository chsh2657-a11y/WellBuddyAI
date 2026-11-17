import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../src/mail/mail.service.js';
import { createTestApp } from './helpers.js';

const password = 'abcd1234';

async function signup(app: NestExpressApplication, email: string, name: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/signup').send({ email, password, name }).expect(201);
  return agent;
}

describe('회사·사업장·초대', () => {
  let app: NestExpressApplication;
  let ownerAgent: ReturnType<typeof request.agent>;
  let companyId: string;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ownerAgent = await signup(app, 'owner@test.local', '대표');
  });

  afterAll(async () => {
    await app.close();
  });

  it('회사를 선택하기 전에는 회사 데이터 API 를 쓸 수 없다', async () => {
    const res = await ownerAgent.get('/api/business-places').expect(403);
    expect(res.body.code).toBe('COMPANY_REQUIRED');
  });

  it('사업자등록번호가 틀리면 회사를 만들 수 없다', async () => {
    const res = await ownerAgent
      .post('/api/companies')
      .send({ name: '웰버디상사', bizRegNo: '123-45-67890' })
      .expect(400);
    expect(res.body.details[0].path).toBe('bizRegNo');
  });

  it('회사를 만들면 대표 관리자가 되고 그 회사로 전환된다', async () => {
    const res = await ownerAgent
      .post('/api/companies')
      .send({ name: '웰버디상사', bizRegNo: '124-81-00998', representative: '홍길동' })
      .expect(201);
    companyId = res.body.company.id;
    expect(res.body.company).toMatchObject({ name: '웰버디상사', bizRegNo: '1248100998' });

    const me = await ownerAgent.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({
      company: { id: companyId, name: '웰버디상사' },
      role: 'owner',
      companies: [{ id: companyId, role: 'owner' }],
    });
    expect(me.body.permissions['settings.users']).toBe('write');
  });

  it('본점 사업장이 자동으로 생기고, 사업장을 추가·수정할 수 있지만 본점은 삭제할 수 없다', async () => {
    const list = await ownerAgent.get('/api/business-places').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ name: '본점', isHeadquarters: true });

    const created = await ownerAgent
      .post('/api/business-places')
      .send({ name: '부산지점', bizRegNo: '000-00-00000' })
      .expect(201);
    await ownerAgent
      .patch(`/api/business-places/${created.body.id}`)
      .send({ address: '부산광역시' })
      .expect(200);
    const dup = await ownerAgent
      .post('/api/business-places')
      .send({ name: '중복', bizRegNo: '000-00-00000' })
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_BIZ_REG_NO');

    const hq = await ownerAgent.delete(`/api/business-places/${list.body[0].id}`).expect(400);
    expect(hq.body.code).toBe('HEADQUARTERS_REQUIRED');
    await ownerAgent.delete(`/api/business-places/${created.body.id}`).expect(204);
  });

  it('초대 메일로 새 사용자가 가입·수락하면 초대한 역할로 회사에 들어온다', async () => {
    const mail = app.get(MailService);
    await ownerAgent
      .post('/api/invitations')
      .send({ email: 'Acc@Test.local', role: 'accountant' })
      .expect(201);
    const sent = mail.outbox.at(-1)!;
    expect(sent.to).toBe('acc@test.local');
    const token = /\/invite\/([\w-]+)/.exec(sent.text)![1]!;

    const lookup = await request(app.getHttpServer())
      .get('/api/invitations/lookup')
      .query({ token })
      .expect(200);
    expect(lookup.body).toEqual({
      companyName: '웰버디상사',
      email: 'acc@test.local',
      role: 'accountant',
      status: 'pending',
    });

    // 다른 이메일로 로그인한 사람은 수락할 수 없다
    const stranger = await signup(app, 'stranger@test.local', '타인');
    const mismatch = await stranger.post('/api/invitations/accept').send({ token }).expect(403);
    expect(mismatch.body.code).toBe('INVITATION_EMAIL_MISMATCH');

    const accountant = await signup(app, 'acc@test.local', '이경리');
    const accepted = await accountant.post('/api/invitations/accept').send({ token }).expect(200);
    expect(accepted.body.companyId).toBe(companyId);

    const me = await accountant.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ role: 'accountant', company: { id: companyId } });

    const again = await accountant.post('/api/invitations/accept').send({ token }).expect(410);
    expect(again.body.code).toBe('INVITATION_NOT_PENDING');

    // 경리는 사용자·권한 메뉴 권한이 없다
    const forbidden = await accountant.get('/api/invitations').expect(403);
    expect(forbidden.body).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'settings.users' },
    });
    // 회사정보는 읽기만 가능
    await accountant.get('/api/companies/current').expect(200);
    await accountant.patch('/api/companies/current').send({ phone: '02-000-0000' }).expect(403);
  });

  it('소속되지 않은 회사로는 전환할 수 없고, 다른 회사 데이터가 보이지 않는다', async () => {
    const other = await signup(app, 'other@test.local', '다른회사');
    await other
      .post('/api/companies')
      .send({ name: '다른상사', bizRegNo: '000-00-00000' })
      .expect(201);
    const places = await other.get('/api/business-places').expect(200);
    expect(places.body.map((p: { name: string }) => p.name)).toEqual(['본점']);

    const res = await other.post('/api/auth/switch-company').send({ companyId }).expect(403);
    expect(res.body.code).toBe('NOT_A_MEMBER');
  });

  it('여러 회사에 소속되면 회사를 전환할 수 있다', async () => {
    const second = await ownerAgent
      .post('/api/companies')
      .send({ name: '웰버디2호', bizRegNo: '000-00-00000' })
      .expect(201);
    let me = await ownerAgent.get('/api/auth/me').expect(200);
    expect(me.body.company.id).toBe(second.body.company.id);
    expect(me.body.companies).toHaveLength(2);

    await ownerAgent.post('/api/auth/switch-company').send({ companyId }).expect(200);
    me = await ownerAgent.get('/api/auth/me').expect(200);
    expect(me.body.company.id).toBe(companyId);

    // 다시 로그인하면 마지막으로 선택한 회사로 들어간다
    const relogin = request.agent(app.getHttpServer());
    const login = await relogin
      .post('/api/auth/login')
      .send({ email: 'owner@test.local', password })
      .expect(200);
    expect(login.body.companyId).toBe(companyId);
  });
});
