import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import {
  type AccountConnectInput,
  type BankAccountRef,
  type BankProvider,
  CodefBankProvider,
  type DateRange,
  ProviderError,
  ProviderRegistry,
} from '@wellbuddy/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

const CREDENTIALS = {
  clientId: 'client-id',
  clientSecret: 'client-secret-123456',
  publicKey: 'public-key-abcdef',
  environment: 'sandbox',
};

describe('CODEF 실연동 설정: 계정 연결과 수집(P2-10·15)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let accountant: Agent;
  let registry: ProviderRegistry;
  const seen: {
    credentials: Record<string, string>[];
    connects: AccountConnectInput[];
    fetches: { account: BankAccountRef; range: DateRange }[];
  } = { credentials: [], connects: [], fetches: [] };
  let failConnect = false;

  /** CODEF 은행 공급자 대역: 받은 자격증명·요청을 기록한다 */
  const fake = (
    credentials: Record<string, string>,
  ): BankProvider & {
    connectAccount(input: AccountConnectInput): Promise<{ connectedId: string; message: string }>;
  } => {
    seen.credentials.push(credentials);
    return {
      testConnection: async () => ({ ok: true, message: `CODEF 연결(${credentials.environment})` }),
      connectAccount: async (input) => {
        seen.connects.push(input);
        if (failConnect) {
          throw new ProviderError(
            'PROVIDER_FAILED',
            'CODEF 계정 연결에 실패했습니다: 비밀번호 오류',
          );
        }
        return { connectedId: 'CID-ABC123', message: '기관 계정을 연결했습니다.' };
      },
      fetchTransactions: async (account, range) => {
        if (!credentials.connectedId) throw new ProviderError('PROVIDER_FAILED', '계정 미연결');
        seen.fetches.push({ account, range });
        return [
          {
            date: range.to,
            time: '09:00:00',
            description: '타행입금',
            counterparty: '(주)한빛상사',
            deposit: 1_100_000,
            withdrawal: 0,
            balance: 11_100_000,
            externalId: null,
          },
        ];
      },
    };
  };

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    registry = app.get(ProviderRegistry);
    registry.register('bank', 'codef', fake);
    ({ agent: owner } = await ownerWithCompany(app, 'owner@codef.local', '코드에프상사'));
    accountant = await inviteAndJoin(app, owner, 'acct@codef.local', 'accountant');
  });

  afterAll(async () => {
    registry.register(
      'bank',
      'codef',
      (c) =>
        new CodefBankProvider({ clientId: c.clientId ?? '', clientSecret: c.clientSecret ?? '' }),
    );
    await app.close();
  });

  it('CODEF 서버는 정해진 값만 받고, 켜려면 필수 자격증명이 있어야 한다', async () => {
    const bad = await owner
      .put('/api/integrations/bank')
      .send({
        enabled: false,
        provider: 'codef',
        credentials: { ...CREDENTIALS, environment: 'prod' },
      })
      .expect(400);
    expect(bad.body.message).toMatch(/서버은\(는\) .*샌드박스/);
    const missing = await owner
      .put('/api/integrations/bank')
      .send({ enabled: true, provider: 'codef', credentials: { clientId: 'x' } })
      .expect(400);
    expect(missing.body.code).toBe('CREDENTIALS_REQUIRED');

    const saved = (
      await owner
        .put('/api/integrations/bank')
        .send({ enabled: true, provider: 'codef', credentials: CREDENTIALS, schedule: 'daily' })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ enabled: true, provider: 'codef', schedule: 'daily' });
    expect(saved.credentials.clientId).toBe('client-id');
    expect(saved.credentials.environment).toBe('sandbox');
    expect(saved.credentials.clientSecret).not.toContain('client-secret');
    expect(saved.credentials.connectedId).toBeUndefined();
    expect((await owner.post('/api/integrations/bank/test').expect(200)).body).toEqual({
      ok: true,
      message: 'CODEF 연결(sandbox)',
    });
  });

  it('계정을 연결하면 Connected ID 만 저장하고 기관 비밀번호는 남기지 않는다', async () => {
    const res = await owner
      .post('/api/integrations/bank/connect-account')
      .send({ organization: '0004', loginId: 'bizbank', password: 'bank-pw-!@#' })
      .expect(200);
    expect(res.body).toEqual({ connectedId: 'CID-ABC123', message: '기관 계정을 연결했습니다.' });
    expect(seen.connects.at(-1)).toEqual({
      organization: '0004',
      loginId: 'bizbank',
      password: 'bank-pw-!@#',
    });

    const bank = (await owner.get('/api/integrations').expect(200)).body.find(
      (s: { channel: string }) => s.channel === 'bank',
    );
    expect(bank.credentials.connectedId).toBe('CID-ABC123');
    expect(Object.keys(bank.credentials).sort()).toEqual([
      'clientId',
      'clientSecret',
      'connectedId',
      'environment',
      'publicKey',
    ]);
    expect(bank).toMatchObject({ lastStatus: 'success', lastMessage: '기관 계정을 연결했습니다.' });
    // 감사로그에는 기관 코드만
    const logs = (await owner.get('/api/audit-logs').query({ limit: 50 }).expect(200)).body as {
      action: string;
      after: unknown;
    }[];
    const log = logs.find((l) => l.action === 'integration.connect_account')!;
    expect(log.after).toEqual({ provider: 'codef', organization: '0004' });
    expect(JSON.stringify(logs)).not.toContain('bank-pw');
    expect(JSON.stringify(logs)).not.toContain('bizbank');

    // 다시 저장해도(빈 값은 유지) Connected ID 는 남고, 공급자는 그 값을 받는다
    await owner
      .put('/api/integrations/bank')
      .send({ enabled: true, provider: 'codef', credentials: {}, schedule: 'daily' })
      .expect(200);
    await owner.post('/api/integrations/bank/test').expect(200);
    expect(seen.credentials.at(-1)).toEqual({ ...CREDENTIALS, connectedId: 'CID-ABC123' });
  });

  it('연결한 계정으로 수집하면 CODEF 가 출처로 남는다', async () => {
    const accounts = (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[];
    await owner
      .post('/api/bank-accounts')
      .send({
        bankCode: '0004',
        alias: '운영자금',
        accountNo: '12345678901234',
        ledgerAccountId: accounts.find((a) => a.code === '103')!.id,
      })
      .expect(201);
    const result = (await accountant.post('/api/evidence/collect/bank').send({}).expect(200)).body;
    expect(result).toMatchObject({ status: 'success', inserted: 1 });
    expect(seen.fetches.at(-1)!.account).toMatchObject({
      bankCode: '0004',
      accountNo: '12345678901234',
    });
    expect(seen.credentials.at(-1)).toMatchObject({
      connectedId: 'CID-ABC123',
      clientId: 'client-id',
    });
    const txs = (await owner.get('/api/evidence/bank-transactions').expect(200)).body;
    expect(txs).toEqual([
      expect.objectContaining({ counterparty: '(주)한빛상사', source: 'codef' }),
    ]);
  });

  it('연결 실패·계정 연결이 없는 공급자·권한 없음', async () => {
    failConnect = true;
    const failed = await owner
      .post('/api/integrations/bank/connect-account')
      .send({ organization: '0004', loginId: 'x', password: 'y' })
      .expect(502);
    expect(failed.body.message).toBe('CODEF 계정 연결에 실패했습니다: 비밀번호 오류');
    failConnect = false;

    await owner
      .post('/api/integrations/bank/connect-account')
      .send({ organization: '0004', loginId: '', password: 'y' })
      .expect(400);
    // 모의 데이터는 계정 연결이 없다
    await owner.put('/api/integrations/card').send({ enabled: true, provider: 'mock' }).expect(200);
    const unsupported = await owner
      .post('/api/integrations/card/connect-account')
      .send({ organization: '0306', loginId: 'x', password: 'y' })
      .expect(400);
    expect(unsupported.body.code).toBe('ACCOUNT_CONNECT_UNSUPPORTED');
    const notSaved = await owner
      .post('/api/integrations/hometax/connect-account')
      .send({ loginId: 'x', password: 'y' })
      .expect(400);
    expect(notSaved.body.code).toBe('ACCOUNT_CONNECT_UNSUPPORTED');

    const employee = await inviteAndJoin(app, owner, 'emp@codef.local', 'employee');
    await employee
      .post('/api/integrations/bank/connect-account')
      .send({ organization: '0004', loginId: 'x', password: 'y' })
      .expect(403);
  });
});
