import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../mock/index.js';
import { ProviderError } from '../registry.js';
import { CodefBankProvider } from './bank.js';
import { CodefCardProvider } from './card.js';
import { CODEF_HOSTS, CODEF_OAUTH_URL, CodefClient } from './client.js';
import { CodefHometaxProvider } from './hometax.js';
import { CODEF_PRODUCTS } from './products.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_KEY = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .replace(/-----[^-]+-----|\s/g, '');

interface Call {
  url: string;
  headers: Headers;
  params: Record<string, unknown> | null;
  form: string | null;
}

/** CODEF 서버 흉내: 응답은 URL 인코딩(공백은 +) */
function codefServer(
  products: Record<string, (params: Record<string, unknown>, call: number) => unknown>,
  calls: Call[] = [],
  options: { tokenStatus?: number; expireFirstToken?: boolean } = {},
) {
  let tokens = 0;
  const count: Record<string, number> = {};
  const encoded = (json: unknown) => encodeURIComponent(JSON.stringify(json)).replace(/%20/g, '+');
  return (async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    const isToken = url === CODEF_OAUTH_URL;
    calls.push({
      url,
      headers: new Headers(init?.headers),
      params: isToken ? null : JSON.parse(decodeURIComponent(body)),
      form: isToken ? body : null,
    });
    if (isToken) {
      tokens += 1;
      if (options.tokenStatus)
        return new Response('{"error":"invalid_client"}', { status: options.tokenStatus });
      return Response.json({ access_token: `token-${tokens}`, expires_in: 604_799 });
    }
    const auth = new Headers(init?.headers).get('authorization');
    const path = new URL(url).pathname;
    count[path] = (count[path] ?? 0) + 1;
    if (options.expireFirstToken && auth === 'Bearer token-1') {
      return new Response(encoded({ error: 'invalid_token' }), { status: 401 });
    }
    const handler = products[path];
    if (!handler) return new Response(encoded({ error: 'not_found' }), { status: 404 });
    const out = handler(JSON.parse(decodeURIComponent(body)), count[path]);
    return new Response(encoded(out), { status: 200 });
  }) as unknown as typeof fetch;
}

const ok = (data: unknown) => ({
  result: { code: 'CF-00000', message: '성공', extraMessage: '' },
  data,
});
const base = {
  clientId: 'cid',
  clientSecret: 'secret',
  publicKey: PUBLIC_KEY,
  connectedId: 'CID1',
};
const MARCH = { from: '2026-03-01', to: '2026-03-31' };

describe('CODEF 공통', () => {
  it('토큰은 Basic 인증으로 받아 재사용하고, 본문은 URL 인코딩한 JSON 으로 보낸다', async () => {
    const calls: Call[] = [];
    const client = new CodefClient({
      ...base,
      environment: 'sandbox',
      fetch: codefServer({ '/v1/test': (p) => ok({ echo: p.name, text: 'a b+c' }) }, calls),
    });
    expect(await client.request('/v1/test', { name: '한글 이름' })).toEqual({
      echo: '한글 이름',
      text: 'a b+c',
    });
    await client.request('/v1/test', {});
    const [token, first, second] = calls;
    expect(token!.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('cid:secret').toString('base64')}`,
    );
    expect(token!.form).toBe('grant_type=client_credentials&scope=read');
    expect(first!.url).toBe(`${CODEF_HOSTS.sandbox}/v1/test`);
    expect(first!.headers.get('authorization')).toBe('Bearer token-1');
    expect(first!.params).toEqual({ name: '한글 이름' });
    expect(second!.headers.get('authorization')).toBe('Bearer token-1');
    expect(calls.filter((c) => c.url === CODEF_OAUTH_URL)).toHaveLength(1);
  });

  it('결과 코드가 정상이 아니면 메시지와 코드를 알려 주고, 키가 틀리면 연결 테스트가 실패한다', async () => {
    const client = new CodefClient({
      ...base,
      fetch: codefServer({
        '/v1/fail': () => ({
          result: {
            code: 'CF-12803',
            message: '조회기간이 올바르지 않습니다.',
            extraMessage: '최대 3개월',
          },
          data: {},
        }),
      }),
    });
    await expect(client.request('/v1/fail', {})).rejects.toThrow(
      'CODEF: 조회기간이 올바르지 않습니다. 최대 3개월 (CF-12803)',
    );
    expect(await client.test()).toEqual({
      ok: true,
      message: 'CODEF(development)에 연결했습니다. 계정이 연결되어 있습니다.',
    });
    const bad = new CodefClient({ ...base, fetch: codefServer({}, [], { tokenStatus: 401 }) });
    expect(await bad.test()).toEqual({
      ok: false,
      message: 'CODEF Client ID·Secret 이 올바르지 않습니다.',
    });
    expect(() => new CodefClient({ ...base, environment: 'prod' })).toThrow(
      'sandbox·development·production',
    );
    expect(() => new CodefClient({ ...base, clientSecret: '' })).toThrow(ProviderError);
  });

  it('토큰이 만료되면(invalid_token) 한 번 새로 받아 다시 요청한다', async () => {
    const calls: Call[] = [];
    const client = new CodefClient({
      ...base,
      fetch: codefServer({ '/v1/test': () => ok({ done: true }) }, calls, {
        expireFirstToken: true,
      }),
    });
    expect(await client.request('/v1/test', {})).toEqual({ done: true });
    expect(
      calls.map((c) => (c.url === CODEF_OAUTH_URL ? 'token' : c.headers.get('authorization'))),
    ).toEqual(['token', 'Bearer token-1', 'token', 'Bearer token-2']);
  });

  it('비밀번호는 RSA 공개키로 암호화한다', () => {
    const client = new CodefClient(base);
    const encrypted = client.encrypt('pw!1234');
    const plain = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(encrypted, 'base64'),
    ).toString();
    expect(plain).toBe('pw!1234');
    expect(() => new CodefClient({ ...base, publicKey: 'nope' }).encrypt('x')).toThrow('공개키');
  });
});

describe('CODEF 계정 연결', () => {
  it('Connected ID 가 없으면 새로 만들고, 있으면 기관을 더한다(비밀번호는 암호화)', async () => {
    const calls: Call[] = [];
    const fetch = codefServer(
      {
        [CODEF_PRODUCTS.accountCreate]: () =>
          ok({ connectedId: 'NEW-CID', successList: [{}], errorList: [] }),
        [CODEF_PRODUCTS.accountAdd]: (p) =>
          ok({ connectedId: p.connectedId, successList: [{}], errorList: [] }),
      },
      calls,
    );
    const fresh = new CodefBankProvider({ ...base, connectedId: '', fetch });
    expect(
      await fresh.connectAccount({ organization: '0004', loginId: 'biz', password: 'pw' }),
    ).toEqual({ connectedId: 'NEW-CID', message: '기관 계정을 연결했습니다.' });
    const created = calls.find((c) => c.url.endsWith(CODEF_PRODUCTS.accountCreate))!;
    const [account] = created.params!.accountList as Record<string, string>[];
    expect(account).toMatchObject({
      countryCode: 'KR',
      businessType: 'BK',
      clientType: 'B',
      organization: '0004',
      loginType: '1',
      id: 'biz',
    });
    expect(account!.password).not.toBe('pw');
    expect(
      privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        Buffer.from(account!.password!, 'base64'),
      ).toString(),
    ).toBe('pw');

    const hometax = new CodefHometaxProvider({ ...base, fetch });
    expect(
      await hometax.connectAccount({ organization: 'ignored', loginId: 'ht', password: 'pw' }),
    ).toEqual({ connectedId: 'CID1', message: '기관 계정을 더 연결했습니다.' });
    const added = calls.find((c) => c.url.endsWith(CODEF_PRODUCTS.accountAdd))!;
    expect(added.params).toMatchObject({
      connectedId: 'CID1',
      accountList: [{ businessType: 'NT', organization: '0001' }],
    });
  });

  it('기관이 거부하면 사유를 알려 준다', async () => {
    const card = new CodefCardProvider({
      ...base,
      connectedId: '',
      fetch: codefServer({
        [CODEF_PRODUCTS.accountCreate]: () => ({
          result: { code: 'CF-04000', message: '사용자 계정정보 오류', extraMessage: '' },
          data: {
            successList: [],
            errorList: [
              { code: 'CF-12100', message: '아이디 또는 비밀번호가 틀립니다.', extraMessage: '' },
            ],
          },
        }),
      }),
    });
    await expect(
      card.connectAccount({ organization: '0306', loginId: 'a', password: 'b' }),
    ).rejects.toThrow(
      'CODEF 계정 연결에 실패했습니다: 아이디 또는 비밀번호가 틀립니다. (CF-12100)',
    );
    await expect(
      card.connectAccount({ organization: '', loginId: 'a', password: 'b' }),
    ).rejects.toThrow('모두 입력');
  });
});

describe('CODEF 은행·카드·홈택스 수집', () => {
  it('은행: 기업 거래내역을 통장 거래로 바꾸고 기간 밖·금액 없는 줄은 뺀다', async () => {
    const calls: Call[] = [];
    const bank = new CodefBankProvider({
      ...base,
      fetch: codefServer(
        {
          [CODEF_PRODUCTS.bankTransactions]: () =>
            ok({
              resAccount: '12345678901234',
              resTrHistoryList: [
                {
                  resAccountTrDate: '20260305',
                  resAccountTrTime: '093000',
                  resAccountOut: '0',
                  resAccountIn: '1,100,000',
                  resAccountDesc1: '타행입금',
                  resAccountDesc2: '',
                  resAccountDesc3: '(주)한빛상사',
                  resAccountDesc4: '역삼지점',
                  resAfterTranBalance: '11,100,000',
                },
                {
                  resAccountTrDate: '20260306',
                  resAccountTrTime: '1400',
                  resAccountOut: '50000',
                  resAccountIn: '0',
                  resAccountDesc1: '',
                  resAccountDesc2: '',
                  resAccountDesc3: '처음보는상점',
                  resAfterTranBalance: '',
                },
                { resAccountTrDate: '20260307', resAccountOut: '0', resAccountIn: '0' },
                { resAccountTrDate: '20260401', resAccountOut: '1', resAccountIn: '0' },
              ],
            }),
        },
        calls,
      ),
    });
    const records = await bank.fetchTransactions(
      { id: 'b1', bankCode: '0004', accountNo: '12345678901234' },
      MARCH,
    );
    expect(records).toEqual([
      {
        date: '2026-03-05',
        time: '09:30:00',
        description: '타행입금',
        counterparty: '(주)한빛상사',
        deposit: 1_100_000,
        withdrawal: 0,
        balance: 11_100_000,
        memo: '역삼지점',
        externalId: null,
      },
      {
        date: '2026-03-06',
        time: '14:00:00',
        description: '처음보는상점',
        counterparty: '처음보는상점',
        deposit: 0,
        withdrawal: 50_000,
        balance: null,
        memo: null,
        externalId: null,
      },
    ]);
    const req = calls.find((c) => c.url.endsWith(CODEF_PRODUCTS.bankTransactions))!;
    expect(req.params).toEqual({
      connectedId: 'CID1',
      organization: '0004',
      account: '12345678901234',
      startDate: '20260301',
      endDate: '20260331',
      orderBy: '1',
    });
  });

  it('카드: 취소·부분취소는 취소로, 거절은 빼고, 다른 카드 것은 끝 4자리로 거른다', async () => {
    const approval = (over: Record<string, string>) => ({
      resUsedDate: '20260310',
      resUsedTime: '123000',
      resCardNo: '4518-****-****-9012',
      resMemberStoreName: '스타벅스 역삼점',
      resMemberStoreCorpNo: '201-81-98765',
      resMemberStoreType: '커피전문점',
      resUsedAmount: '11000',
      resVAT: '1000',
      resApprovalNo: '30010001',
      resInstallmentMonth: '0',
      resCancelYN: '0',
      ...over,
    });
    const card = new CodefCardProvider({
      ...base,
      fetch: codefServer({
        [CODEF_PRODUCTS.cardApprovals]: () =>
          ok([
            approval({}),
            approval({
              resApprovalNo: '30010002',
              resCancelYN: '1',
              resUsedAmount: '-11000',
              resInstallmentMonth: '3',
            }),
            approval({ resApprovalNo: '30010003', resCancelYN: '3' }),
            approval({ resApprovalNo: '30010005', resCancelYN: '2', resUsedAmount: '5000' }),
            approval({ resApprovalNo: '30010004', resCardNo: '9999-****-****-1111' }),
          ]),
      }),
    });
    const records = await card.fetchApprovals(
      { id: 'c1', cardCompany: '0306', cardNo: '4518123456789012' },
      MARCH,
    );
    expect(records).toEqual([
      {
        date: '2026-03-10',
        time: '12:30:00',
        merchantName: '스타벅스 역삼점',
        merchantBizNo: '2018198765',
        amount: 11_000,
        vatAmount: 1_000,
        approvalNo: '30010001',
        installmentMonths: null,
        cancelled: false,
        category: '커피전문점',
      },
      expect.objectContaining({
        approvalNo: '30010002',
        cancelled: true,
        amount: 11_000,
        installmentMonths: 3,
      }),
      // 부분취소도 취소로
      expect.objectContaining({ approvalNo: '30010005', cancelled: true, amount: 5_000 }),
    ]);
  });

  it('홈택스: 세금계산서(과세·영세·계산서)·현금영수증·사업용 카드 매입', async () => {
    const calls: Call[] = [];
    const hometax = new CodefHometaxProvider({
      ...base,
      fetch: codefServer(
        {
          [CODEF_PRODUCTS.taxInvoices]: (p) =>
            ok({
              resList: [
                {
                  resApprovalNo: `2026031041000011${p.inquiryType}`,
                  resWriteDate: '20260310',
                  resTaxInvoiceType: '일반(세금계산서)',
                  resSupplierRegNumber: '220-81-12345',
                  resSupplierCompanyName: '(주)한빛상사',
                  resContractorRegNumber: '124-81-00998',
                  resContractorCompanyName: '우리회사',
                  resSupplyValue: '1000000',
                  resTaxAmt: '100000',
                  resTotalAmount: '1100000',
                  resItemName: '제품',
                },
                {
                  resApprovalNo: 'Z1',
                  resWriteDate: '20260311',
                  resTaxInvoiceType: '영세율 세금계산서',
                  resSupplyValue: '500000',
                  resTaxAmt: '0',
                },
                {
                  resApprovalNo: 'E1',
                  resWriteDate: '20260312',
                  resTaxInvoiceType: '계산서',
                  resSupplyValue: '30000',
                  resTaxAmt: '0',
                },
                { resWriteDate: '20260313' },
              ],
            }),
          [CODEF_PRODUCTS.cashReceiptPurchases]: () =>
            ok({
              resList: [
                {
                  resUsedDate: '20260315',
                  resApprovalNo: 'C1',
                  resMemberStoreCorpNo: '2207812125',
                  resMemberStoreName: '한솥도시락',
                  resTotalAmount: '8800',
                  resTaxAmt: '800',
                  resUsage: '지출증빙',
                  resCancelYN: '0',
                },
              ],
            }),
          [CODEF_PRODUCTS.cashReceiptSales]: () => ok({ resList: [] }),
          [CODEF_PRODUCTS.businessCardPurchases]: () =>
            ok({
              resList: [
                {
                  resUsedDate: '20260310',
                  resApprovalNo: '30010001',
                  resUsedAmount: '11000',
                  resVAT: '1000',
                  resMemberStoreName: '스타벅스',
                },
              ],
            }),
        },
        calls,
      ),
    });
    const sales = await hometax.fetchTaxInvoices('sales', MARCH);
    expect(sales.map((i) => [i.approvalNo, i.kind, i.totalAmount])).toEqual([
      ['2026031041000011' + '01', 'tax', 1_100_000],
      ['Z1', 'zero', 500_000],
      ['E1', 'exempt', 30_000],
    ]);
    expect(sales[0]).toMatchObject({
      direction: 'sales',
      issueDate: '2026-03-10',
      supplierBizNo: '2208112345',
      buyerBizNo: '1248100998',
      itemSummary: '제품',
    });
    expect((await hometax.fetchTaxInvoices('purchase', MARCH))[0]!.approvalNo).toMatch(/02$/);
    expect(await hometax.fetchCashReceipts('purchase', MARCH)).toEqual([
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
    ]);
    expect(await hometax.fetchCashReceipts('sales', MARCH)).toEqual([]);
    expect(await hometax.fetchCardPurchases(MARCH)).toEqual([
      expect.objectContaining({ approvalNo: '30010001', amount: 11_000, vatAmount: 1_000 }),
    ]);
    const req = calls.find((c) => c.url.endsWith(CODEF_PRODUCTS.cashReceiptPurchases))!;
    expect(req.params).toMatchObject({
      organization: '0001',
      connectedId: 'CID1',
      startDate: '20260301',
    });
  });

  it('계정을 연결하지 않았으면 수집하지 않고 안내한다', async () => {
    const calls: Call[] = [];
    const bank = new CodefBankProvider({ ...base, connectedId: '', fetch: codefServer({}, calls) });
    await expect(
      bank.fetchTransactions({ id: 'b', bankCode: '0004', accountNo: '1' }, MARCH),
    ).rejects.toThrow('CODEF 계정이 연결되지 않았습니다');
    expect(calls).toHaveLength(0);
    expect(await bank.testConnection()).toMatchObject({
      ok: true,
      message: expect.stringContaining('계정을 연결해 주세요'),
    });
  });

  it('레지스트리: 통장·카드·홈택스 채널에서 CODEF 를 고른다', () => {
    const registry = createProviderRegistry();
    const ctx = { companyId: 'c', companyName: '회사', bizNo: null };
    const setting = {
      provider: 'codef',
      enabled: true,
      credentials: { clientId: 'a', clientSecret: 'b' },
    };
    expect(registry.resolve('bank', setting, ctx)).toBeInstanceOf(CodefBankProvider);
    expect(registry.resolve('card', setting, ctx)).toBeInstanceOf(CodefCardProvider);
    expect(registry.resolve('hometax', setting, ctx)).toBeInstanceOf(CodefHometaxProvider);
    expect(() => registry.resolve('bank', { ...setting, credentials: {} }, ctx)).toThrow(
      ProviderError,
    );
  });
});
