import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { MockBankProvider, ProviderError, ProviderRegistry } from '@wellbuddy/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CollectionScheduler } from '../src/evidence/collection.scheduler.js';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

interface Run {
  channel: string;
  trigger: string;
  status: string;
  inserted: number;
  duplicates: number;
  message: string | null;
}

describe('예약 수집 스케줄러(P2-16)', () => {
  let app: NestExpressApplication;
  let scheduler: CollectionScheduler;
  let registry: ProviderRegistry;
  let a: Agent;
  let b: Agent;
  let aId: string;
  let failFor: string | null = null;

  const runs = async (agent: Agent) =>
    (await agent.get('/api/evidence/runs').expect(200)).body as Run[];
  interface Status {
    channel: string;
    schedule: string;
    collectable: boolean;
    lastStatus: string | null;
    lastMessage: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }
  const status = async (agent: Agent, channel: string) =>
    ((await agent.get('/api/evidence/collect').expect(200)).body as Status[]).find(
      (s) => s.channel === channel,
    )!;
  const addBank = async (agent: Agent) => {
    const accounts = (await agent.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[];
    await agent
      .post('/api/bank-accounts')
      .send({
        bankCode: '0004',
        alias: '운영자금',
        accountNo: '12345678901234',
        ledgerAccountId: accounts.find((x) => x.code === '103')!.id,
      })
      .expect(201);
  };

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    scheduler = app.get(CollectionScheduler);
    registry = app.get(ProviderRegistry);
    // 특정 회사만 수집이 실패하게 할 수 있는 모의 은행
    registry.register('bank', 'mock', (_, ctx) => {
      const mock = new MockBankProvider();
      return {
        testConnection: () => mock.testConnection(),
        fetchTransactions: async (account, range) => {
          if (ctx.companyId === failFor) {
            throw new ProviderError('PROVIDER_FAILED', '은행 점검 시간입니다.');
          }
          return mock.fetchTransactions(account, range);
        },
      };
    });
    ({ agent: a, companyId: aId } = await ownerWithCompany(app, 'a@sched.local', '예약상사'));
    ({ agent: b } = await ownerWithCompany(app, 'b@sched.local', '계좌없는상사'));

    // A: 통장 매시간 + 계좌, 카드는 켜 두었지만 수동
    await a
      .put('/api/integrations/bank')
      .send({ enabled: true, provider: 'mock', schedule: 'hourly' })
      .expect(200);
    await a
      .put('/api/integrations/card')
      .send({ enabled: true, provider: 'mock', schedule: 'manual' })
      .expect(200);
    await addBank(a);
    // B: 통장 매시간인데 계좌가 없다
    await b
      .put('/api/integrations/bank')
      .send({ enabled: true, provider: 'mock', schedule: 'hourly' })
      .expect(200);
  });

  afterAll(async () => {
    registry.register('bank', 'mock', () => new MockBankProvider());
    await app.close();
  });

  it('돌 때가 된 채널만 사용자 없이 최근 7일을 수집하고, 설정 문제는 상태에 남긴다', async () => {
    const before = await status(a, 'bank');
    expect(before).toMatchObject({ schedule: 'hourly', collectable: true, lastRunAt: null });
    expect(before.nextRunAt).toBeTruthy();
    expect((await status(a, 'card')).nextRunAt).toBeNull();

    const now = new Date();
    const result = await scheduler.tick(now);
    expect(result).toMatchObject({ checked: 2, due: 2, failures: [] });

    const aRuns = await runs(a);
    expect(aRuns).toHaveLength(1);
    expect(aRuns[0]).toMatchObject({ channel: 'bank', trigger: 'schedule', status: 'success' });
    expect(aRuns[0]!.inserted).toBeGreaterThan(0);
    expect(aRuns[0]!.message).toMatch(/계좌 1개/);
    const after = await status(a, 'bank');
    expect(after.lastStatus).toBe('success');
    // 다음 예정은 마지막 실행 55분 뒤
    expect(new Date(after.nextRunAt!).getTime() - new Date(after.lastRunAt!).getTime()).toBe(
      55 * 60_000,
    );

    // 계좌가 없는 회사는 수집 이력 없이 상태에만 남긴다(다시 시도하지 않음)
    expect(await runs(b)).toEqual([]);
    expect(await status(b, 'bank')).toMatchObject({
      lastStatus: 'error',
      lastMessage:
        '예약 수집을 하지 못했습니다: 사용 중인 계좌가 없습니다. 계좌·카드에서 등록해 주세요.',
    });

    // 바로 다시 확인하면 돌 때가 아니다
    expect(await scheduler.tick(new Date())).toMatchObject({ due: 0, started: 0 });
  });

  it('한 시간 뒤에는 다시 수집하고(겹친 거래는 중복), 한 회사가 실패해도 다른 회사는 계속한다', async () => {
    await addBank(b);
    failFor = aId;
    const later = new Date(Date.now() + 60 * 60_000);
    const result = await scheduler.tick(later);
    expect(result.due).toBe(2);
    expect(result.failures).toEqual([`${aId}:bank`]);

    const [latestA] = await runs(a);
    expect(latestA).toMatchObject({ trigger: 'schedule', status: 'error' });
    expect(latestA!.message).toMatch(/은행 점검 시간입니다/);
    expect(await status(a, 'bank')).toMatchObject({ lastStatus: 'error' });

    const bRuns = await runs(b);
    expect(bRuns).toEqual([expect.objectContaining({ trigger: 'schedule', status: 'success' })]);

    failFor = null;
    const again = await scheduler.tick(new Date(Date.now() + 2 * 60 * 60_000));
    expect(again).toMatchObject({ due: 2, failures: [] });
    const [retried] = await runs(a);
    expect(retried).toMatchObject({ status: 'success', inserted: 0 });
    expect(retried!.duplicates).toBeGreaterThan(0);
  });

  it('꺼진 채널·수동 주기·파일 업로드는 예약하지 않는다', async () => {
    await a
      .put('/api/integrations/bank')
      .send({ enabled: false, provider: 'mock', schedule: 'hourly' })
      .expect(200);
    await b.put('/api/integrations/bank').send({ enabled: true, provider: 'file' }).expect(200);
    const result = await scheduler.tick(new Date(Date.now() + 5 * 60 * 60_000));
    expect(result).toMatchObject({ checked: 0, due: 0 });
  });
});
