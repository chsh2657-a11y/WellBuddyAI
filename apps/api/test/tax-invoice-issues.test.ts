import type { NestExpressApplication } from '@nestjs/platform-express';
import { todayInKorea } from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import {
  MockTaxInvoiceIssuer,
  mockApprovalNo,
  ProviderError,
  ProviderRegistry,
  type TaxInvoiceDraft,
  type TaxInvoiceIssuer,
} from '@wellbuddy/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

const today = todayInKorea();
/** 검증번호가 맞는 공급받는자 사업자번호 */
const BUYER = '220-81-12341';

interface Issue {
  id: string;
  mgtKey: string;
  provider: string;
  status: string;
  kind: string;
  buyerBizNo: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  approvalNo: string | null;
  taxInvoiceId: string | null;
  evidenceStatus: string | null;
  notice?: string | null;
}

describe('전자세금계산서 발행·취소·상태조회(P2-14)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let other: Agent;
  let registry: ProviderRegistry;
  const drafts: TaxInvoiceDraft[] = [];

  const body = (over: object = {}) => ({
    issueDate: today,
    buyerBizNo: BUYER,
    buyerName: '(주)한빛상사',
    buyerCeoName: '박대표',
    buyerEmail: 'tax@hanbit.test',
    itemName: '제품 납품',
    supplyAmount: 1_000_000,
    ...over,
  });
  const issue = (agent: Agent, over: object = {}) =>
    agent.post('/api/tax-invoice-issues').send(body(over));

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    registry = app.get(ProviderRegistry);
    // 모의 발행을 감싸서 보낸 초안을 기록한다
    registry.register('taxinvoice', 'mock', () => {
      const mock = new MockTaxInvoiceIssuer();
      return {
        testConnection: () => mock.testConnection(),
        issue: (draft) => {
          drafts.push(draft);
          return mock.issue(draft);
        },
        cancel: (key) => mock.cancel(key),
        getStatus: (key) => mock.getStatus(key),
      } satisfies TaxInvoiceIssuer;
    });
    ({ agent: owner } = await ownerWithCompany(app, 'owner@issue.local', '발행상사'));
    ({ agent: other } = await ownerWithCompany(app, 'other@issue.local', '다른회사'));
  });

  afterAll(async () => {
    registry.register('taxinvoice', 'mock', () => new MockTaxInvoiceIssuer());
    await app.close();
  });

  it('발행 채널이 꺼져 있으면 발행하지 않는다', async () => {
    const res = await issue(owner).expect(400);
    expect(res.body).toMatchObject({ code: 'CHANNEL_DISABLED' });
    expect(res.body.message).toMatch(/전자세금계산서 발행을 켜 주세요/);
    expect((await owner.get('/api/tax-invoice-issues').expect(200)).body).toEqual([]);
  });

  it('모의로 발행하면 승인번호를 받고 매출 세금계산서로 등록한다', async () => {
    await owner
      .put('/api/integrations/taxinvoice')
      .send({ enabled: true, provider: 'mock' })
      .expect(200);
    const issued = (await issue(owner).expect(201)).body as Issue;
    expect(issued).toMatchObject({
      provider: 'mock',
      status: 'issued',
      kind: 'tax',
      buyerBizNo: '2208112341',
      supplyAmount: 1_000_000,
      vatAmount: 100_000,
      totalAmount: 1_100_000,
      evidenceStatus: 'pending',
    });
    expect(issued.mgtKey).toMatch(new RegExp(`^WB${today.replaceAll('-', '')}[0-9A-F]{8}$`));
    expect(issued.approvalNo).toBe(mockApprovalNo(issued.mgtKey, today));
    expect(drafts.at(-1)).toMatchObject({
      mgtKey: issued.mgtKey,
      kind: 'tax',
      buyerBizNo: '2208112341',
      buyerCeoName: '박대표',
      buyerEmail: 'tax@hanbit.test',
      vatAmount: 100_000,
    });

    const invoices = (
      await owner.get('/api/evidence/tax-invoices').query({ direction: 'sales' }).expect(200)
    ).body as {
      id: string;
      approvalNo: string;
      buyerName: string;
      totalAmount: number;
      source: string;
      itemSummary: string;
    }[];
    expect(invoices).toEqual([
      expect.objectContaining({
        id: issued.taxInvoiceId,
        approvalNo: issued.approvalNo,
        buyerName: '(주)한빛상사',
        totalAmount: 1_100_000,
        source: 'mock',
        itemSummary: '제품 납품',
      }),
    ]);

    // 영세율은 세액 0
    const zero = (await issue(owner, { kind: 'zero', supplyAmount: 500_000 }).expect(201))
      .body as Issue;
    expect(zero).toMatchObject({ kind: 'zero', vatAmount: 0, totalAmount: 500_000 });
  });

  it('입력 검사: 사업자번호·영세율 세액·빈 품목', async () => {
    expect((await issue(owner, { buyerBizNo: '123-45-67890' }).expect(400)).body.details).toEqual([
      { path: 'buyerBizNo', message: '공급받는자 사업자번호가 올바르지 않습니다.' },
    ]);
    await issue(owner, { kind: 'exempt', vatAmount: 1_000 }).expect(400);
    await issue(owner, { itemName: '' }).expect(400);
    await issue(owner, { supplyAmount: 0 }).expect(400);
  });

  it('상태를 다시 조회하면 전송 결과로 바뀌고, 취소하면 증빙을 제외한다', async () => {
    const [latest, first] = (await owner.get('/api/tax-invoice-issues').expect(200))
      .body as Issue[];
    expect(latest!.kind).toBe('zero');
    const refreshed = (await owner.post(`/api/tax-invoice-issues/${first!.id}/refresh`).expect(200))
      .body as Issue;
    // 모의 조회는 승인번호를 주지 않지만 발행 때 받은 번호는 남는다
    expect(refreshed).toMatchObject({ status: 'sent', approvalNo: first!.approvalNo });

    await owner
      .post(`/api/tax-invoice-issues/${first!.id}/cancel`)
      .send({ reason: '' })
      .expect(400);
    const cancelled = (
      await owner
        .post(`/api/tax-invoice-issues/${first!.id}/cancel`)
        .send({ reason: '금액 오류' })
        .expect(200)
    ).body as Issue;
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      evidenceStatus: 'ignored',
      notice: null,
    });
    const again = await owner
      .post(`/api/tax-invoice-issues/${first!.id}/cancel`)
      .send({ reason: '다시' })
      .expect(409);
    expect(again.body.code).toBe('ALREADY_CANCELLED');
    // 취소한 건은 상태를 다시 묻지 않는다
    expect(
      (await owner.post(`/api/tax-invoice-issues/${first!.id}/refresh`).expect(200)).body.status,
    ).toBe('cancelled');
  });

  it('공급자가 실패하면 502 로 알리고 발행 기록을 남기지 않는다', async () => {
    registry.register('taxinvoice', 'popbill', () => ({
      testConnection: async () => ({ ok: true, message: '' }),
      issue: async () => {
        throw new ProviderError('PROVIDER_FAILED', '팝빌: 연동회원이 아닙니다. (-11000010)');
      },
      cancel: async () => {
        throw new Error('not used');
      },
      getStatus: async () => {
        throw new Error('not used');
      },
    }));
    await owner
      .put('/api/integrations/taxinvoice')
      .send({
        enabled: true,
        provider: 'popbill',
        credentials: { linkId: 'L', secretKey: 'S', corpNum: '1248100998' },
      })
      .expect(200);
    const before = (await owner.get('/api/tax-invoice-issues').expect(200)).body.length;
    const res = await issue(owner).expect(502);
    expect(res.body.message).toBe('팝빌: 연동회원이 아닙니다. (-11000010)');
    expect((await owner.get('/api/tax-invoice-issues').expect(200)).body).toHaveLength(before);
  });

  it('권한과 회사 격리', async () => {
    const employee = await inviteAndJoin(app, owner, 'emp@issue.local', 'employee');
    await issue(employee).expect(403);
    await employee.get('/api/tax-invoice-issues').expect(403);
    const mine = (await owner.get('/api/tax-invoice-issues').expect(200)).body as Issue[];
    expect(await (await other.get('/api/tax-invoice-issues').expect(200)).body).toEqual([]);
    await other.post(`/api/tax-invoice-issues/${mine[0]!.id}/refresh`).expect(404);
  });
});
