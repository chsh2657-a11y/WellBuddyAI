import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskSensitive } from '../src/audit/audit.service.js';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

describe('역할 권한·구성원·감사로그', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let accountant: Agent;
  let admin: Agent;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@audit.local', '감사상사'));
    accountant = await inviteAndJoin(app, owner, 'acc@audit.local', 'accountant');
    admin = await inviteAndJoin(app, owner, 'admin@audit.local', 'admin');
  });

  afterAll(async () => {
    await app.close();
  });

  it('역할별 권한 매트릭스를 조회하고, 역할 권한을 바꾸면 즉시 반영된다', async () => {
    const roles = await owner.get('/api/roles').expect(200);
    const acc = roles.body.find((r: { role: string }) => r.role === 'accountant');
    expect(acc).toMatchObject({ editable: true, overridden: false });
    expect(acc.permissions['settings.users']).toBe('none');

    await accountant.get('/api/members').expect(403);
    const updated = await owner
      .put('/api/roles/accountant/permissions')
      .send({ permissions: { 'settings.users': 'read' } })
      .expect(200);
    expect(updated.body).toMatchObject({
      overridden: true,
      permissions: { 'settings.users': 'read' },
    });

    // 토큰을 다시 받지 않아도 다음 요청부터 새 권한이 적용된다
    await accountant.get('/api/members').expect(200);
    await accountant.patch('/api/companies/current').send({ phone: '1' }).expect(403);
  });

  it('대표 관리자 역할의 권한은 바꿀 수 없다', async () => {
    const res = await owner
      .put('/api/roles/owner/permissions')
      .send({ permissions: { 'settings.users': 'none' } })
      .expect(400);
    expect(res.body.code).toBe('ROLE_NOT_EDITABLE');
  });

  it('자기 자신이나 대표 관리자는 관리자라도 바꿀 수 없다', async () => {
    const members = (await admin.get('/api/members').expect(200)).body as Array<{
      id: string;
      role: string;
      isMe: boolean;
    }>;
    const me = members.find((m) => m.isMe)!;
    const ownerMember = members.find((m) => m.role === 'owner')!;

    const self = await admin.patch(`/api/members/${me.id}`).send({ role: 'employee' }).expect(400);
    expect(self.body.code).toBe('CANNOT_CHANGE_SELF');
    const ownerChange = await admin
      .patch(`/api/members/${ownerMember.id}`)
      .send({ status: 'disabled' })
      .expect(403);
    expect(ownerChange.body.code).toBe('OWNER_ONLY');
    const promote = await admin
      .patch(`/api/members/${members.find((m) => m.role === 'accountant')!.id}`)
      .send({ role: 'owner' })
      .expect(403);
    expect(promote.body.code).toBe('OWNER_ONLY');
  });

  it('비활성화된 구성원은 즉시 회사 데이터에 접근할 수 없다', async () => {
    const members = (await owner.get('/api/members').expect(200)).body as Array<{
      id: string;
      email: string;
    }>;
    const acc = members.find((m) => m.email === 'acc@audit.local')!;
    await owner.patch(`/api/members/${acc.id}`).send({ status: 'disabled' }).expect(200);

    const res = await accountant.get('/api/companies/current').expect(403);
    expect(res.body.code).toBe('COMPANY_REQUIRED');
    const me = await accountant.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ company: null, companies: [] });

    await owner.patch(`/api/members/${acc.id}`).send({ status: 'active' }).expect(200);
  });

  it('변경 요청과 업무 변경 내역이 감사로그에 남는다', async () => {
    await owner
      .post('/api/business-places')
      .send({ name: '감사지점', bizRegNo: '124-81-00998' })
      .expect(201);
    const logs = (await owner.get('/api/audit-logs').query({ limit: 100 }).expect(200))
      .body as Array<{
      action: string;
      before: unknown;
      after: unknown;
      userEmail: string | null;
      statusCode: number | null;
    }>;
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'company.create',
        'invitation.create',
        'invitation.accept',
        'role.permissions.update',
        'member.update',
        'business_place.create',
        'http:POST /api/business-places',
      ]),
    );
    const roleChange = logs.find((l) => l.action === 'role.permissions.update')!;
    expect(roleChange.before).toMatchObject({ 'settings.users': 'none' });
    expect(roleChange.after).toMatchObject({ 'settings.users': 'read' });
    expect(logs.find((l) => l.action === 'http:POST /api/business-places')).toMatchObject({
      statusCode: 201,
      userEmail: 'owner@audit.local',
    });
    // 실패한 요청(권한 없음)도 남는다
    expect(logs.some((l) => l.statusCode === 403)).toBe(true);
  });

  it('다른 회사의 감사로그는 보이지 않고, 권한이 없으면 조회할 수 없다', async () => {
    const { agent: other } = await ownerWithCompany(app, 'other@audit.local', '다른회사');
    const logs = (await other.get('/api/audit-logs').expect(200)).body as Array<{
      userEmail: string;
    }>;
    expect(logs.every((l) => l.userEmail === 'other@audit.local')).toBe(true);

    const res = await accountant.get('/api/audit-logs').expect(403);
    expect(res.body.details).toMatchObject({ permission: 'settings.audit' });
  });

  it('감사로그에는 비밀번호·토큰·자격증명이 남지 않는다', () => {
    expect(
      maskSensitive({
        email: 'a@b.c',
        password: 'pw',
        nested: { apiKey: 'k', refreshToken: 't', residentNo: '900101', name: '홍' },
        credentials: { id: 'x' },
      }),
    ).toEqual({
      email: 'a@b.c',
      password: '***',
      nested: { apiKey: '***', refreshToken: '***', residentNo: '***', name: '홍' },
      credentials: '***',
    });
  });
});
