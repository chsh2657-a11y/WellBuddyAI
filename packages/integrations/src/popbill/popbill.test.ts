import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProviderRegistry, MockTaxInvoiceIssuer, mockApprovalNo } from '../mock/index.js';
import { ProviderError } from '../registry.js';
import { LINKHUB_AUTH_URL, POPBILL_HOSTS, PopbillClient } from './client.js';
import { PopbillHometaxProvider } from './hometax.js';
import { issueStatusOf, PopbillTaxInvoiceIssuer } from './issuer.js';

const SECRET = Buffer.from('popbill-secret-key').toString('base64');
const NOW = new Date('2026-09-29T12:00:00.000Z');
const base = { linkId: 'LINKID', secretKey: SECRET, corpNum: '124-81-00998', now: () => NOW };

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

/** 링크허브 인증 + 팝빌 서비스 흉내. 서명은 여기서 따로 계산해 맞는지 본다 */
function popbillServer(
  routes: Record<string, (call: Call, n: number) => { status?: number; body: unknown }>,
  calls: Call[] = [],
  token: { expiration?: string } = {},
) {
  let tokens = 0;
  const seen: Record<string, number> = {};
  return (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === 'string' && init.body ? init.body : null;
    const call = {
      method: init?.method ?? 'GET',
      url,
      headers,
      body: raw ? JSON.parse(raw) : null,
    };
    calls.push(call);
    if (url.startsWith(LINKHUB_AUTH_URL)) {
      const uri = new URL(url).pathname;
      const digest = createHash('sha256')
        .update(raw ?? '')
        .digest('base64');
      const expected = createHmac('sha256', Buffer.from(SECRET, 'base64'))
        .update(`POST\n${digest}\n${headers.get('x-lh-date')}\n2.0\n${uri}`)
        .digest('base64');
      if (headers.get('authorization') !== `LINKHUB LINKID ${expected}`) {
        return Response.json({ code: -99999999, message: '서명 불일치' }, { status: 401 });
      }
      tokens += 1;
      return Response.json({
        session_token: `session-${tokens}`,
        expiration: token.expiration ?? '2099-01-01T00:00:00Z',
      });
    }
    const u = new URL(url);
    const key = `${headers.get('x-http-method-override') ?? call.method} ${u.pathname}`;
    seen[key] = (seen[key] ?? 0) + 1;
    const route = routes[key];
    if (!route) return Response.json({ code: -99, message: `없는 경로 ${key}` }, { status: 404 });
    const { status = 200, body } = route(call, seen[key]!);
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
}

describe('팝빌 인증', () => {
  it('링크허브 서명으로 토큰을 받아 재사용하고, 테스트·운영 서버를 구분한다', async () => {
    const calls: Call[] = [];
    const client = new PopbillClient(
      { ...base, fetch: popbillServer({ 'GET /Ping': () => ({ body: { code: 1 } }) }, calls) },
      ['110'],
    );
    await client.request('GET', '/Ping');
    await client.request('GET', '/Ping');
    const [token, first, second] = calls;
    expect(token!.url).toBe(`${LINKHUB_AUTH_URL}/POPBILL_TEST/Token`);
    expect(token!.headers.get('x-lh-date')).toBe(NOW.toISOString());
    expect(token!.headers.get('x-lh-version')).toBe('2.0');
    expect(token!.body).toEqual({ access_id: '1248100998', scope: ['member', '110'] });
    expect(first!.url).toBe(`${POPBILL_HOSTS.test}/Ping`);
    expect(first!.headers.get('authorization')).toBe('Bearer session-1');
    expect(second!.headers.get('authorization')).toBe('Bearer session-1');
    expect(calls.filter((c) => c.url.startsWith(LINKHUB_AUTH_URL))).toHaveLength(1);

    const prodCalls: Call[] = [];
    const prod = new PopbillClient(
      {
        ...base,
        environment: 'production',
        fetch: popbillServer({ 'GET /Ping': () => ({ body: {} }) }, prodCalls),
      },
      [],
    );
    await prod.request('GET', '/Ping');
    expect(prodCalls[0]!.url).toBe(`${LINKHUB_AUTH_URL}/POPBILL/Token`);
    expect(prodCalls[1]!.url).toBe(`${POPBILL_HOSTS.production}/Ping`);
  });

  it('만료된 토큰은 새로 받고, 키가 틀리면 인증 오류, 서비스 오류는 코드와 함께', async () => {
    const calls: Call[] = [];
    const client = new PopbillClient(
      {
        ...base,
        fetch: popbillServer(
          {
            'GET /Ping': () => ({ body: {} }),
            'GET /Fail': () => ({
              status: 400,
              body: { code: -11000010, message: '연동회원이 아닙니다.' },
            }),
          },
          calls,
          { expiration: '2000-01-01T00:00:00Z' },
        ),
      },
      [],
    );
    await client.request('GET', '/Ping');
    await client.request('GET', '/Ping');
    expect(calls.filter((c) => c.url.startsWith(LINKHUB_AUTH_URL))).toHaveLength(2);
    await expect(client.request('GET', '/Fail')).rejects.toThrow(
      '팝빌: 연동회원이 아닙니다. (-11000010)',
    );

    const wrong = new PopbillClient(
      { ...base, secretKey: Buffer.from('wrong').toString('base64'), fetch: popbillServer({}) },
      [],
    );
    await expect(wrong.request('GET', '/Ping')).rejects.toThrow(
      '팝빌 인증에 실패했습니다: 서명 불일치 (-99999999)',
    );
    expect(() => new PopbillClient({ ...base, corpNum: '123' }, [])).toThrow('사업자번호');
    expect(() => new PopbillClient({ ...base, environment: 'dev' }, [])).toThrow('test·production');
    expect(() => new PopbillClient({ ...base, linkId: '' }, [])).toThrow(ProviderError);
  });
});

describe('팝빌 홈택스 수집', () => {
  const invoice = (n: number) => ({
    ntsconfirmNum: `20260310410000110000000${n}`,
    writeDate: '20260310',
    taxType: n === 3 ? '영세' : '과세',
    invoicerCorpNum: '1248100998',
    invoicerCorpName: '우리회사',
    invoiceeCorpNum: '2208112345',
    invoiceeCorpName: '(주)한빛상사',
    supplyCostTotal: '1000000',
    taxTotal: n === 3 ? '0' : '100000',
    totalAmount: n === 3 ? '1000000' : '1100000',
    itemName: '제품',
  });

  it('세금계산서: 작업 요청 → 완료까지 기다림 → 모든 페이지를 읽는다', async () => {
    const calls: Call[] = [];
    const hometax = new PopbillHometaxProvider({
      ...base,
      pollIntervalMs: 0,
      fetch: popbillServer(
        {
          'POST /HomeTax/Taxinvoice/SELL': () => ({ body: { jobID: '016092912000000001' } }),
          'GET /HomeTax/Taxinvoice/016092912000000001/State': (_, n) => ({
            body: { jobState: n < 3 ? 2 : 3, errorCode: 1, collectCount: 3 },
          }),
          'GET /HomeTax/Taxinvoice/016092912000000001': (call) => {
            const page = new URL(call.url).searchParams.get('Page');
            return {
              body: {
                code: 1,
                pageCount: 2,
                list:
                  page === '1' ? [invoice(1), invoice(2)] : [invoice(3), { writeDate: '20260310' }],
              },
            };
          },
        },
        calls,
      ),
    });
    const records = await hometax.fetchTaxInvoices('sales', {
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(records.map((r) => [r.approvalNo.slice(-1), r.kind, r.totalAmount])).toEqual([
      ['1', 'tax', 1_100_000],
      ['2', 'tax', 1_100_000],
      ['3', 'zero', 1_000_000],
    ]);
    expect(records[0]).toMatchObject({
      direction: 'sales',
      issueDate: '2026-03-10',
      supplierBizNo: '1248100998',
      buyerBizNo: '2208112345',
      buyerName: '(주)한빛상사',
      itemSummary: '제품',
    });
    const job = calls.find((c) => c.url.includes('/HomeTax/Taxinvoice/SELL'))!;
    expect(job.method).toBe('POST');
    expect(new URL(job.url).search).toBe('?DType=W&SDate=20260301&EDate=20260331');
    expect(calls.filter((c) => c.url.endsWith('/State'))).toHaveLength(3);
    expect(new URL(calls.at(-1)!.url).searchParams.get('PerPage')).toBe('1000');
  });

  it('현금영수증: 매입은 가맹점, 매출은 고객 번호, 취소 거래 구분', async () => {
    const hometax = new PopbillHometaxProvider({
      ...base,
      pollIntervalMs: 0,
      fetch: popbillServer({
        'POST /HomeTax/Cashbill/BUY': () => ({ body: { jobID: '016092912000000002' } }),
        'GET /HomeTax/Cashbill/016092912000000002/State': () => ({
          body: { jobState: 3, errorCode: 1 },
        }),
        'GET /HomeTax/Cashbill/016092912000000002': () => ({
          body: {
            pageCount: 1,
            list: [
              {
                ntsconfirmNum: 'C1',
                tradeDate: '20260315',
                tradeType: '승인거래',
                tradeUsage: '지출증빙용',
                supplyCost: '8000',
                tax: '800',
                serviceFee: '0',
                totalAmount: '8800',
                franchiseCorpNum: '2207812125',
                franchiseCorpName: '한솥도시락',
              },
              {
                ntsconfirmNum: 'C2',
                tradeDate: '20260316',
                tradeType: '취소거래',
                tradeUsage: '소득공제용',
                supplyCost: '-1000',
                tax: '-100',
                totalAmount: '-1100',
                franchiseCorpNum: '2207812125',
                franchiseCorpName: '한솥도시락',
              },
            ],
          },
        }),
      }),
    });
    expect(
      await hometax.fetchCashReceipts('purchase', { from: '2026-03-01', to: '2026-03-31' }),
    ).toEqual([
      {
        direction: 'purchase',
        date: '2026-03-15',
        approvalNo: 'C1',
        bizNo: '2207812125',
        name: '한솥도시락',
        supplyAmount: 8_000,
        vatAmount: 800,
        totalAmount: 8_800,
        usage: 'expense_proof',
        cancelled: false,
      },
      expect.objectContaining({
        approvalNo: 'C2',
        cancelled: true,
        totalAmount: 1_100,
        usage: 'income_deduction',
      }),
    ]);
    expect(await hometax.fetchCardPurchases()).toEqual([]);
  });

  it('작업이 실패하거나 끝나지 않으면 알려 준다', async () => {
    const make = (state: object) =>
      new PopbillHometaxProvider({
        ...base,
        pollIntervalMs: 0,
        maxPolls: 3,
        fetch: popbillServer({
          'POST /HomeTax/Taxinvoice/BUY': () => ({ body: { jobID: 'J1' } }),
          'GET /HomeTax/Taxinvoice/J1/State': () => ({ body: state }),
          'GET /HomeTax/Taxinvoice/CertCheck': () => ({
            status: 400,
            body: { code: -99003008, message: '등록된 인증서가 없습니다.' },
          }),
        }),
      });
    const range = { from: '2026-03-01', to: '2026-03-31' };
    await expect(
      make({
        jobState: 3,
        errorCode: -99003008,
        errorReason: '홈택스 로그인 실패',
      }).fetchTaxInvoices('purchase', range),
    ).rejects.toThrow('홈택스 수집이 실패했습니다: 홈택스 로그인 실패');
    await expect(make({ jobState: 2 }).fetchTaxInvoices('purchase', range)).rejects.toThrow(
      '오래 걸립니다',
    );
    expect(await make({}).testConnection()).toEqual({
      ok: false,
      message: '팝빌: 등록된 인증서가 없습니다. (-99003008)',
    });
  });
});

describe('팝빌 전자세금계산서 발행', () => {
  const draft = {
    issueDate: '2026-09-29',
    buyerBizNo: '220-81-12345',
    buyerName: '(주)한빛상사',
    buyerEmail: 'tax@hanbit.test',
    supplyAmount: 1_000_000,
    vatAmount: 100_000,
    itemName: '제품 납품',
    mgtKey: 'WB20260929ABC123',
  };

  it('정발행으로 보내고, 취소·상태조회는 관리번호로 한다', async () => {
    const calls: Call[] = [];
    const issuer = new PopbillTaxInvoiceIssuer(
      {
        ...base,
        fetch: popbillServer(
          {
            'ISSUE /Taxinvoice': () => ({
              body: { code: 1, message: '발행 완료', ntsConfirmNum: '20260929410000110000ABCD' },
            }),
            'CANCELISSUE /Taxinvoice/SELL/WB20260929ABC123': () => ({
              body: { code: 1, message: '취소 완료' },
            }),
            'GET /Taxinvoice/SELL/WB20260929ABC123': () => ({
              body: { stateCode: 304, ntsconfirmNum: '20260929410000110000ABCD', stateMemo: '' },
            }),
          },
          calls,
        ),
      },
      { companyName: '우리회사' },
    );
    expect(
      await issuer.issue({ ...draft, supplierCeoName: '김대표', buyerCeoName: '박대표' }),
    ).toEqual({
      mgtKey: 'WB20260929ABC123',
      approvalNo: '20260929410000110000ABCD',
      status: 'issued',
      message: '발행 완료',
    });
    const issued = calls.find((c) => c.headers.get('x-http-method-override') === 'ISSUE')!;
    expect(issued.method).toBe('POST');
    expect(issued.body).toEqual({
      writeDate: '20260929',
      chargeDirection: '정과금',
      issueType: '정발행',
      purposeType: '영수',
      taxType: '과세',
      invoicerCorpNum: '1248100998',
      invoicerMgtKey: 'WB20260929ABC123',
      invoicerCorpName: '우리회사',
      invoicerCEOName: '김대표',
      invoiceeType: '사업자',
      invoiceeCorpNum: '2208112345',
      invoiceeCorpName: '(주)한빛상사',
      invoiceeCEOName: '박대표',
      invoiceeEmail1: 'tax@hanbit.test',
      supplyCostTotal: '1000000',
      taxTotal: '100000',
      totalAmount: '1100000',
      detailList: [
        {
          serialNum: 1,
          purchaseDT: '20260929',
          itemName: '제품 납품',
          supplyCost: '1000000',
          tax: '100000',
        },
      ],
    });
    expect(await issuer.cancel('WB20260929ABC123', '금액 오류')).toMatchObject({
      status: 'cancelled',
    });
    const cancel = calls.find((c) => c.headers.get('x-http-method-override') === 'CANCELISSUE')!;
    expect(cancel.body).toEqual({ memo: '금액 오류' });
    expect(await issuer.getStatus('WB20260929ABC123')).toMatchObject({
      status: 'sent',
      approvalNo: '20260929410000110000ABCD',
    });
  });

  it('상태코드: 발행·전송완료·전송실패·취소', () => {
    expect([300, 301, 304, 305, 600].map(issueStatusOf)).toEqual([
      'issued',
      'issued',
      'sent',
      'failed',
      'cancelled',
    ]);
  });

  it('모의 발행은 관리번호로 정해지는 승인번호를 준다', async () => {
    const mock = new MockTaxInvoiceIssuer();
    const a = await mock.issue(draft);
    expect(a).toMatchObject({
      status: 'issued',
      approvalNo: mockApprovalNo(draft.mgtKey, draft.issueDate),
    });
    expect(a.approvalNo).toMatch(/^2026092941000000\d{8}$/);
    expect((await mock.issue({ ...draft, mgtKey: 'OTHER' })).approvalNo).not.toBe(a.approvalNo);
    expect(await mock.cancel(draft.mgtKey)).toMatchObject({ status: 'cancelled' });
  });

  it('레지스트리: 홈택스·발행 채널에서 팝빌을 고른다', () => {
    const registry = createProviderRegistry();
    const ctx = { companyId: 'c', companyName: '회사', bizNo: null };
    const setting = {
      provider: 'popbill',
      enabled: true,
      credentials: { linkId: 'L', secretKey: SECRET, corpNum: '1248100998' },
    };
    expect(registry.resolve('hometax', setting, ctx)).toBeInstanceOf(PopbillHometaxProvider);
    expect(registry.resolve('taxinvoice', setting, ctx)).toBeInstanceOf(PopbillTaxInvoiceIssuer);
    expect(registry.resolve('taxinvoice', { ...setting, provider: 'mock' }, ctx)).toBeInstanceOf(
      MockTaxInvoiceIssuer,
    );
  });
});
