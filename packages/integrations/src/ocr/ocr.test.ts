import { describe, expect, it } from 'vitest';
import { claudeFetch, type SeenRequest } from '../ai/fake-anthropic.fixture.js';
import { FormatBizCheckProvider, NTS_STATUS_URL, NtsBizCheckProvider } from '../bizcheck/index.js';
import { MERCHANTS } from '../mock/catalog.js';
import { createProviderRegistry } from '../mock/index.js';
import { ProviderError } from '../registry.js';
import { ClaudeOcrProvider } from './claude.js';
import { ClovaOcrProvider } from './clova.js';
import { MockOcrProvider } from './mock.js';
import { normalizeAmount, normalizeDate, receiptFields } from './normalize.js';
import { UPSTAGE_URL, UpstageOcrProvider } from './upstage.js';

interface Call {
  url: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

/** 요청을 기록하고 정해 둔 JSON 을 돌려주는 가짜 fetch */
function jsonFetch(reply: (call: Call) => { status?: number; body: unknown }, calls: Call[] = []) {
  return (async (url: string, init?: RequestInit) => {
    const call = {
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const { status = 200, body } = reply(call);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const png = { data: Buffer.from('fake-png'), mimeType: 'image/png', filename: 'r.png' };

describe('영수증 값 정리', () => {
  it('날짜 표기를 YYYY-MM-DD 로 바꾼다', () => {
    expect(normalizeDate('2026.09.15 12:30')).toBe('2026-09-15');
    expect(normalizeDate('2026년 9월 5일')).toBe('2026-09-05');
    expect(normalizeDate('2026/9/5')).toBe('2026-09-05');
    expect(normalizeDate('20260915')).toBe('2026-09-15');
    expect(normalizeDate('26-09-15')).toBe('2026-09-15');
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('영수증')).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });

  it('금액 표기를 원 단위 정수로 바꾼다', () => {
    expect(normalizeAmount('12,000원')).toBe(12_000);
    expect(normalizeAmount('₩ 3,300')).toBe(3_300);
    expect(normalizeAmount(11_000.4)).toBe(11_000);
    expect(normalizeAmount('없음')).toBeNull();
    expect(normalizeAmount(undefined)).toBeNull();
  });

  it('사업자번호는 숫자 10자리만, 합계보다 큰 부가세는 버리고, 신뢰도는 0~1', () => {
    expect(
      receiptFields({
        date: '2026.09.15',
        merchantName: '  스타벅스  ',
        bizNo: '201-81-98765',
        totalAmount: '11,000',
        vatAmount: '99,000',
        confidence: 1.7,
        items: [
          { name: '아메리카노', amount: '4,500' },
          { name: '', amount: 1 },
        ],
      }),
    ).toEqual({
      date: '2026-09-15',
      merchantName: '스타벅스',
      bizNo: '2018198765',
      totalAmount: 11_000,
      vatAmount: null,
      confidence: 1,
      items: [{ name: '아메리카노', amount: 4_500 }],
    });
    expect(receiptFields({ bizNo: '12345' }).bizNo).toBeNull();
  });
});

describe('모의 OCR', () => {
  const ocr = new MockOcrProvider();

  it('파일 이름 YYYYMMDD_가맹점_금액[_사업자번호] 를 읽는다', async () => {
    const starbucks = MERCHANTS.find((m) => m.name === '스타벅스 역삼점')!;
    expect(
      await ocr.extractReceipt({ ...png, filename: '20260915_스타벅스 역삼점_11000.png' }),
    ).toEqual({
      date: '2026-09-15',
      merchantName: '스타벅스 역삼점',
      bizNo: starbucks.bizNo,
      totalAmount: 11_000,
      vatAmount: 1_000,
      confidence: 0.95,
    });
    // 사업자번호를 적으면 그 값을, 면세 가맹점은 부가세 0
    expect(
      await ocr.extractReceipt({
        ...png,
        filename: '20260915_교보문고 강남점_22000_123-45-67890.jpg',
      }),
    ).toMatchObject({ bizNo: '1234567890', vatAmount: 0 });
    // 모르는 가맹점은 사업자번호 없음
    expect(
      await ocr.extractReceipt({ ...png, filename: '20260915_동네식당_8000.png' }),
    ).toMatchObject({ merchantName: '동네식당', bizNo: null, vatAmount: 727 });
  });

  it('이름 규칙이 아니면 파일 내용으로 정한 샘플을 낮은 신뢰도로 돌려준다', async () => {
    const a = await ocr.extractReceipt({ ...png, filename: 'IMG_0001.png' });
    const again = await ocr.extractReceipt({ ...png, filename: 'other.png' });
    const other = await ocr.extractReceipt({
      ...png,
      data: Buffer.from('another'),
      filename: 'x.png',
    });
    expect(again).toEqual(a);
    expect(other).not.toEqual(a);
    expect(a.confidence).toBeLessThan(0.8);
    expect(MERCHANTS.map((m) => m.name)).toContain(a.merchantName);
    expect(a.totalAmount).toBeGreaterThan(0);
    expect(await ocr.testConnection()).toMatchObject({ ok: true });
  });
});

describe('Claude Vision OCR', () => {
  const answer = {
    date: '2026.09.15',
    merchantName: '스타벅스 역삼점',
    bizNo: '201-81-98765',
    totalAmount: 11_000,
    vatAmount: 1_000,
    items: [{ name: '아메리카노', amount: 4_500 }],
    confidence: 0.9,
  };

  it('이미지는 image 블록, PDF 는 document 블록으로 보내고 값을 정리해 돌려준다', async () => {
    const seen: SeenRequest[] = [];
    const ocr = new ClaudeOcrProvider({
      apiKey: 'sk',
      fetch: claudeFetch({ output: answer }, seen),
    });
    expect(await ocr.extractReceipt(png)).toEqual({
      date: '2026-09-15',
      merchantName: '스타벅스 역삼점',
      bizNo: '2018198765',
      totalAmount: 11_000,
      vatAmount: 1_000,
      confidence: 0.9,
      items: [{ name: '아메리카노', amount: 4_500 }],
    });
    const body = seen[0]!.body!;
    expect(body.model).toBe('claude-opus-5-5');
    expect((body.output_config as { effort: string }).effort).toBe('low');
    const [image, text] = (body.messages as { content: Record<string, unknown>[] }[])[0]!.content;
    expect(image).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: png.data.toString('base64') },
    });
    expect(text).toMatchObject({ type: 'text' });

    await ocr.extractReceipt({ ...png, mimeType: 'application/pdf' });
    const [doc] = (seen[1]!.body!.messages as { content: Record<string, unknown>[] }[])[0]!.content;
    expect(doc).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf' },
    });
  });

  it('읽을 수 없는 형식·큰 이미지는 보내지 않고 오류', async () => {
    const seen: SeenRequest[] = [];
    const ocr = new ClaudeOcrProvider({
      apiKey: 'sk',
      fetch: claudeFetch({ output: answer }, seen),
    });
    await expect(ocr.extractReceipt({ ...png, mimeType: 'image/heic' })).rejects.toThrow(
      /JPG 로 바꿔/,
    );
    await expect(
      ocr.extractReceipt({ ...png, data: Buffer.alloc(5 * 1024 * 1024 + 1) }),
    ).rejects.toThrow('5MB');
    expect(seen).toHaveLength(0);
  });
});

describe('Upstage OCR', () => {
  it('정보 추출 API 로 보내고 문자열 값을 정리한다', async () => {
    const calls: Call[] = [];
    const ocr = new UpstageOcrProvider({
      apiKey: 'up-key',
      fetch: jsonFetch(
        () => ({
          body: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    date: '2026-09-15 12:30',
                    merchant_name: 'GS25 역삼점',
                    business_number: '220-85-10108',
                    total_amount: '3,300원',
                    vat_amount: '300',
                    items: [{ name: '생수', amount: '1,100' }],
                  }),
                },
              },
            ],
          },
        }),
        calls,
      ),
    });
    expect(await ocr.extractReceipt(png)).toEqual({
      date: '2026-09-15',
      merchantName: 'GS25 역삼점',
      bizNo: '2208510108',
      totalAmount: 3_300,
      vatAmount: 300,
      confidence: 0.85,
      items: [{ name: '생수', amount: 1_100 }],
    });
    const call = calls[0]!;
    expect(call.url).toBe(UPSTAGE_URL);
    expect(call.headers.get('authorization')).toBe('Bearer up-key');
    expect(call.body!.model).toBe('information-extract');
    const content = (call.body!.messages as { content: { image_url: { url: string } }[] }[])[0]!
      .content[0]!;
    expect(content.image_url.url).toBe(`data:image/png;base64,${png.data.toString('base64')}`);
    expect(call.body!.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('키 오류·실패는 공급자 오류, 연결 테스트는 인증만 본다', async () => {
    const denied = new UpstageOcrProvider({
      apiKey: 'bad',
      fetch: jsonFetch(() => ({ status: 401, body: { error: { message: 'Invalid API key' } } })),
    });
    await expect(denied.extractReceipt(png)).rejects.toThrow(
      'Upstage API Key 가 올바르지 않습니다.',
    );
    expect(await denied.testConnection()).toMatchObject({ ok: false });
    const forbidden = new UpstageOcrProvider({
      apiKey: 'k',
      fetch: jsonFetch(() => ({ status: 403, body: {} })),
    });
    expect(await forbidden.testConnection()).toEqual({
      ok: false,
      message: 'Upstage API Key 가 올바르지 않습니다.',
    });
    const rejected = new UpstageOcrProvider({
      apiKey: 'k',
      fetch: jsonFetch(() => ({ status: 400, body: { error: { message: 'image too small' } } })),
    });
    await expect(rejected.extractReceipt(png)).rejects.toThrow('(400): image too small');
    // 빈 이미지라 400 이어도 키는 통과
    expect(await rejected.testConnection()).toEqual({
      ok: true,
      message: 'Upstage 에 연결했습니다.',
    });
    expect(() => new UpstageOcrProvider({ apiKey: '' })).toThrow(ProviderError);
  });
});

describe('CLOVA OCR', () => {
  const field = (text: string, value?: string) => ({ text, formatted: { value: value ?? text } });
  const receipt = {
    storeInfo: { name: field('한솥도시락 역삼점'), bizNum: field('220-78-12125', '2207812125') },
    paymentInfo: {
      date: { text: '26.09.15', formatted: { year: '2026', month: '09', day: '15' } },
    },
    totalPrice: { price: field('8,800', '8800') },
    subTotal: [{ taxPrice: [field('800')] }],
    subResults: [{ items: [{ name: field('도시락'), price: { price: field('8,800', '8800') } }] }],
  };

  it('Invoke URL 로 보내고 영수증 결과를 읽는다', async () => {
    const calls: Call[] = [];
    const ocr = new ClovaOcrProvider({
      invokeUrl: 'https://clova.example/custom/v1/1/abc/document/receipt',
      secretKey: 'secret',
      fetch: jsonFetch(
        () => ({ body: { images: [{ inferResult: 'SUCCESS', receipt: { result: receipt } }] } }),
        calls,
      ),
    });
    expect(await ocr.extractReceipt({ ...png, mimeType: 'image/jpeg' })).toEqual({
      date: '2026-09-15',
      merchantName: '한솥도시락 역삼점',
      bizNo: '2207812125',
      totalAmount: 8_800,
      vatAmount: 800,
      confidence: 0.85,
      items: [{ name: '도시락', amount: 8_800 }],
    });
    const call = calls[0]!;
    expect(call.url).toBe('https://clova.example/custom/v1/1/abc/document/receipt');
    expect(call.headers.get('x-ocr-secret')).toBe('secret');
    expect(call.body).toMatchObject({
      version: 'V2',
      images: [{ format: 'jpg', data: png.data.toString('base64') }],
    });
  });

  it('인식 실패·잘못된 주소·키는 오류, 설정 형식도 확인한다', async () => {
    const make = (status: number, body: unknown) =>
      new ClovaOcrProvider({
        invokeUrl: 'https://clova.example/receipt',
        secretKey: 's',
        fetch: jsonFetch(() => ({ status, body })),
      });
    await expect(
      make(200, { images: [{ inferResult: 'FAILURE', message: 'not a receipt' }] }).extractReceipt(
        png,
      ),
    ).rejects.toThrow('not a receipt');
    await expect(make(404, {}).extractReceipt(png)).rejects.toThrow('Invoke URL');
    expect(await make(401, {}).testConnection()).toEqual({
      ok: false,
      message: 'CLOVA OCR Secret Key 가 올바르지 않습니다.',
    });
    expect(await make(400, { message: 'invalid image' }).testConnection()).toMatchObject({
      ok: true,
    });
    await expect(make(200, {}).extractReceipt({ ...png, mimeType: 'image/webp' })).rejects.toThrow(
      'JPG·PNG·TIFF',
    );
    expect(() => new ClovaOcrProvider({ invokeUrl: 'http://x', secretKey: 's' })).toThrow(
      'https://',
    );
  });
});

describe('사업자 상태 조회', () => {
  it('형식 확인(내장)은 넘어온 번호를 모두 valid 로 본다', async () => {
    const status = await new FormatBizCheckProvider().check(['1248100998']);
    expect([...status]).toEqual([['1248100998', 'valid']]);
  });

  it('국세청 상태조회: 계속·휴업·폐업·미등록을 구분하고 100개씩 나눠 묻는다', async () => {
    const calls: Call[] = [];
    const codes: Record<string, string> = {
      '1111111111': '01',
      '2222222222': '02',
      '3333333333': '03',
    };
    const nts = new NtsBizCheckProvider({
      serviceKey: 'a/b+c==',
      fetch: jsonFetch(
        (call) => ({
          body: {
            status_code: 'OK',
            data: (call.body!.b_no as string[])
              .filter((b) => b !== '5555555555')
              .map((b) => ({ b_no: b, b_stt_cd: codes[b] ?? '' })),
          },
        }),
        calls,
      ),
    });
    const many = Array.from({ length: 150 }, (_, i) => String(6_000_000_000 + i));
    const status = await nts.check([
      '1111111111',
      '2222222222',
      '3333333333',
      '4444444444',
      '5555555555',
      '1111111111',
      ...many,
    ]);
    expect(status.get('1111111111')).toBe('active');
    expect(status.get('2222222222')).toBe('suspended');
    expect(status.get('3333333333')).toBe('closed');
    expect(status.get('4444444444')).toBe('unregistered');
    expect(status.get('5555555555')).toBe('unknown');
    expect(calls).toHaveLength(2);
    expect((calls[0]!.body!.b_no as string[]).length).toBe(100);
    expect(calls[0]!.url).toBe(`${NTS_STATUS_URL}?serviceKey=${encodeURIComponent('a/b+c==')}`);

    // 이미 인코딩된 키는 그대로
    const encoded: Call[] = [];
    await new NtsBizCheckProvider({
      serviceKey: 'a%2Fb',
      fetch: jsonFetch(() => ({ body: { status_code: 'OK', data: [] } }), encoded),
    }).check(['1111111111']);
    expect(encoded[0]!.url).toBe(`${NTS_STATUS_URL}?serviceKey=a%2Fb`);
  });

  it('서비스키 오류는 공급자 오류, 연결 테스트로 알려 준다', async () => {
    const nts = new NtsBizCheckProvider({
      serviceKey: 'bad',
      fetch: jsonFetch(() => ({ status: 401, body: { msg: '등록되지 않은 인증키 입니다.' } })),
    });
    await expect(nts.check(['1111111111'])).rejects.toThrow('서비스키가 올바르지 않습니다');
    expect(await nts.testConnection()).toMatchObject({ ok: false });
    expect(() => new NtsBizCheckProvider({ serviceKey: '' })).toThrow(ProviderError);
  });
});

describe('레지스트리', () => {
  it('OCR·사업자 상태 조회 공급자를 설정으로 고른다', () => {
    const registry = createProviderRegistry();
    const ctx = { companyId: 'c', companyName: '회사', bizNo: null };
    const on = (provider: string, credentials: Record<string, string> = {}) => ({
      provider,
      enabled: true,
      credentials,
    });
    expect(registry.resolve('ocr', on('mock'), ctx)).toBeInstanceOf(MockOcrProvider);
    expect(registry.resolve('ocr', on('claude', { apiKey: 'sk' }), ctx)).toBeInstanceOf(
      ClaudeOcrProvider,
    );
    expect(registry.resolve('ocr', on('upstage', { apiKey: 'k' }), ctx)).toBeInstanceOf(
      UpstageOcrProvider,
    );
    expect(
      registry.resolve('ocr', on('clova', { invokeUrl: 'https://x', secretKey: 's' }), ctx),
    ).toBeInstanceOf(ClovaOcrProvider);
    expect(registry.resolve('bizcheck', on('format'), ctx)).toBeInstanceOf(FormatBizCheckProvider);
    expect(registry.resolve('bizcheck', on('nts', { serviceKey: 'k' }), ctx)).toBeInstanceOf(
      NtsBizCheckProvider,
    );
    expect(() => registry.resolve('ocr', on('claude'), ctx)).toThrow(ProviderError);
  });
});
