import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayInKorea } from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import {
  bizNo,
  type BizCheckProvider,
  ClaudeOcrProvider,
  MockOcrProvider,
  NtsBizCheckProvider,
  type OcrProvider,
  ProviderError,
  ProviderRegistry,
} from '@wellbuddy/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

/** 1×1 PNG 뒤에 표시를 붙여 파일마다 내용(해시)을 다르게 한다 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const png = (mark: string) => Buffer.concat([PNG, Buffer.from(mark)]);
const STARBUCKS = bizNo('201819876');
const today = todayInKorea();
const compact = (d: string) => d.replaceAll('-', '');
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));

interface Receipt {
  id: string;
  fileId: string | null;
  filename: string | null;
  txDate: string | null;
  merchantName: string | null;
  bizNo: string | null;
  bizNoStatus: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  ocrProvider: string | null;
  ocrError: string | null;
  confidence: number | null;
  status: string;
  card: { approvalNo: string } | null;
  duplicate?: boolean;
  message?: string | null;
}

describe('영수증 업로드 → OCR → 증빙 등록, 사업자번호 확인(P2-18)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let other: Agent;
  let approver: Agent;
  let registry: ProviderRegistry;

  const upload = (agent: Agent, file: Buffer, name: string) =>
    agent.post('/api/evidence/receipts').attach('file', file, name);
  const setChannel = (channel: string, body: object) =>
    owner.put(`/api/integrations/${channel}`).send(body).expect(200);
  const list = async (agent: Agent = owner, query = '') =>
    (await agent.get(`/api/evidence/receipts${query}`).expect(200)).body as Receipt[];

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    registry = app.get(ProviderRegistry);
    ({ agent: owner } = await ownerWithCompany(app, 'owner@rcpt.local', '영수증상사'));
    ({ agent: other } = await ownerWithCompany(app, 'other@rcpt.local', '다른회사'));
    approver = await inviteAndJoin(app, owner, 'approver@rcpt.local', 'approver');
  });

  afterAll(async () => {
    await app.close();
  });

  it('OCR 이 꺼져 있으면 파일만 저장하고 빈 영수증(검토 필요)을 만든다', async () => {
    const res = (await upload(owner, png('off'), 'receipt.png').expect(200)).body as Receipt;
    expect(res).toMatchObject({
      filename: 'receipt.png',
      mimeType: 'image/png',
      txDate: null,
      totalAmount: null,
      ocrProvider: null,
      confidence: null,
      status: 'review',
      duplicate: false,
      message: 'OCR 이 꺼져 있어 값을 직접 입력해 주세요.',
    });
    expect(res.fileId).toBeTruthy();
    // 원본은 파일 저장소에서 내려받을 수 있다
    const file = await owner.get(`/api/files/${res.fileId}/download`).expect(200);
    expect(Buffer.from(file.body).subarray(0, 8)).toEqual(PNG.subarray(0, 8));

    // 직접 입력하면 검토 필요가 풀린다
    const edited = (
      await owner
        .patch(`/api/evidence/receipts/${res.id}`)
        .send({ txDate: today, merchantName: '동네문구', totalAmount: 5_500, vatAmount: 500 })
        .expect(200)
    ).body as Receipt;
    expect(edited).toMatchObject({ status: 'pending', merchantName: '동네문구', bizNo: null });
  });

  it('모의 OCR: 읽은 값·사업자번호 확인·같은 파일은 다시 등록하지 않는다', async () => {
    await setChannel('ocr', { enabled: true, provider: 'mock' });
    const name = `${compact(today)}_스타벅스 역삼점_11000.png`;
    const res = (await upload(owner, png('a'), name).expect(200)).body as Receipt;
    expect(res).toMatchObject({
      txDate: today,
      merchantName: '스타벅스 역삼점',
      bizNo: STARBUCKS,
      bizNoStatus: 'valid',
      totalAmount: 11_000,
      vatAmount: 1_000,
      ocrProvider: 'mock',
      confidence: 0.95,
      status: 'pending',
      duplicate: false,
      message: null,
    });

    const again = (await upload(owner, png('a'), 'renamed.png').expect(200)).body as Receipt;
    expect(again).toMatchObject({
      id: res.id,
      duplicate: true,
      message: '이미 올린 영수증입니다.',
    });
    expect((await list()).filter((r) => r.merchantName === '스타벅스 역삼점')).toHaveLength(1);

    // 이름 규칙이 아닌 사진은 샘플을 낮은 신뢰도로 → 검토 필요
    const sample = (await upload(owner, png('photo'), 'IMG_0001.png').expect(200)).body;
    expect(sample.confidence).toBeLessThan(0.8);
    expect(sample.status).toBe('review');
    expect((await list(owner, '?status=review')).map((r) => r.id)).toContain(sample.id);
    expect((await list(owner, '?status=review')).map((r) => r.id)).not.toContain(res.id);
  });

  it('검증번호가 틀린 사업자번호는 번호 오류(검토 필요), 고치면 다시 확인한다', async () => {
    const res = (
      await upload(owner, png('bad'), `${compact(today)}_동네식당_8000_1234567890.png`).expect(200)
    ).body as Receipt;
    expect(res).toMatchObject({ bizNo: '1234567890', bizNoStatus: 'invalid', status: 'review' });

    const fixed = (
      await owner
        .patch(`/api/evidence/receipts/${res.id}`)
        .send({ bizNo: '124-81-00998' })
        .expect(200)
    ).body as Receipt;
    expect(fixed).toMatchObject({ bizNo: '1248100998', bizNoStatus: 'valid', status: 'pending' });

    // 잘못된 입력
    await owner
      .patch(`/api/evidence/receipts/${res.id}`)
      .send({ totalAmount: 1_000, vatAmount: 2_000 })
      .expect(400);
    await owner.patch(`/api/evidence/receipts/${res.id}`).send({ vatAmount: 9_000 }).expect(400);
  });

  it('국세청 조회를 켜면 계속·폐업을 확인하고, 조회가 실패하면 형식만 확인했다고 알린다', async () => {
    const statuses: Record<string, 'active' | 'closed'> = { [STARBUCKS]: 'active' };
    let fail = false;
    const fake: BizCheckProvider = {
      testConnection: async () => ({ ok: true, message: '국세청 연결' }),
      check: async (nos) => {
        if (fail) throw new ProviderError('PROVIDER_FAILED', '서비스키 오류');
        return new Map(nos.map((b) => [b, statuses[b] ?? 'closed']));
      },
    };
    registry.register('bizcheck', 'nts', () => fake);
    try {
      await setChannel('bizcheck', {
        enabled: true,
        provider: 'nts',
        credentials: { serviceKey: 'key' },
      });
      expect((await owner.post('/api/integrations/bizcheck/test').expect(200)).body).toEqual({
        ok: true,
        message: '국세청 연결',
      });
      const closed = (
        await upload(
          owner,
          png('closed'),
          `${compact(today)}_폐업가게_3300_124-81-00998.png`,
        ).expect(200)
      ).body as Receipt;
      expect(closed).toMatchObject({ bizNoStatus: 'closed', status: 'review' });

      const starbucks = (await list()).find((r) => r.merchantName === '스타벅스 역삼점')!;
      const verified = (
        await owner.post(`/api/evidence/receipts/${starbucks.id}/verify-biz-no`).expect(200)
      ).body as Receipt;
      expect(verified).toMatchObject({ bizNoStatus: 'active', status: 'pending', message: null });

      fail = true;
      const fallback = (
        await owner.post(`/api/evidence/receipts/${starbucks.id}/verify-biz-no`).expect(200)
      ).body as Receipt;
      expect(fallback.bizNoStatus).toBe('valid');
      expect(fallback.message).toMatch(/번호 형식만 확인했습니다: 서비스키 오류/);
    } finally {
      registry.register(
        'bizcheck',
        'nts',
        (c) => new NtsBizCheckProvider({ serviceKey: c.serviceKey ?? '' }),
      );
      await setChannel('bizcheck', { enabled: false, provider: 'format' });
    }
  });

  it('OCR 이 실패하면 오류를 남기고 직접 입력하게 한다', async () => {
    const failing: OcrProvider = {
      testConnection: async () => ({ ok: true, message: '' }),
      extractReceipt: async () => {
        throw new ProviderError('PROVIDER_FAILED', 'Claude 요청이 많습니다.');
      },
    };
    registry.register('ocr', 'claude', () => failing);
    try {
      await setChannel('ocr', { enabled: true, provider: 'claude', credentials: { apiKey: 'sk' } });
      const res = (await upload(owner, png('fail'), 'fail.png').expect(200)).body as Receipt;
      expect(res).toMatchObject({
        ocrProvider: 'claude',
        ocrError: 'Claude Vision: Claude 요청이 많습니다.',
        status: 'review',
        totalAmount: null,
      });
      expect(res.message).toMatch(/^영수증을 읽지 못했습니다/);
    } finally {
      registry.register('ocr', 'claude', (c) => new ClaudeOcrProvider({ apiKey: c.apiKey ?? '' }));
      await setChannel('ocr', { enabled: true, provider: 'mock' });
    }
  });

  it('형식·권한 검사: 영수증이 아닌 파일, 읽기 권한만 있는 사용자', async () => {
    const text = await upload(owner, Buffer.from('a,b\n1,2'), 'x.csv').expect(415);
    expect(text.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    await owner.post('/api/evidence/receipts').expect(400);
    // 결재자는 볼 수만 있다
    expect((await list(approver)).length).toBeGreaterThan(0);
    await upload(approver, png('approver'), 'a.png').expect(403);
  });

  it('자동분개 실행 때 같은 금액의 카드 승인과 짝지어지고, 짝지은 영수증은 고치거나 지울 수 없다', async () => {
    const accounts = (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[];
    const card = (
      await owner
        .post('/api/corporate-cards')
        .send({
          cardCompany: '0306',
          alias: '법인카드',
          cardNo: '4518123456789012',
          ledgerAccountId: accounts.find((a) => a.code === '253')!.id,
        })
        .expect(201)
    ).body;
    await owner
      .post('/api/evidence/uploads/commit')
      .field('options', JSON.stringify({ kind: 'card', sourceId: card.id }))
      .attach(
        'file',
        csv([
          ['승인일자', '승인시간', '가맹점명', '업종', '승인금액', '승인번호', '승인구분'],
          [
            addDays(today, -1),
            '12:30',
            '스타벅스 역삼점',
            '커피전문점',
            '"11,000"',
            '30010001',
            '승인',
          ],
        ]),
        'card.csv',
      )
      .expect(200);
    await owner.post('/api/auto-journal/run').expect(200);

    const starbucks = (await list()).find((r) => r.merchantName === '스타벅스 역삼점')!;
    expect(starbucks).toMatchObject({ status: 'matched', card: { approvalNo: '30010001' } });
    const locked = await owner
      .patch(`/api/evidence/receipts/${starbucks.id}`)
      .send({ totalAmount: 12_000 })
      .expect(409);
    expect(locked.body.code).toBe('RECEIPT_LOCKED');
    await owner.delete(`/api/evidence/receipts/${starbucks.id}`).expect(409);
  });

  it('지우면 원본 파일도 지우고, 다른 회사 영수증은 보이지 않는다', async () => {
    const res = (await upload(owner, png('delete'), 'delete.png').expect(200)).body as Receipt;
    await other.get(`/api/evidence/receipts/${res.id}`).expect(404);
    await other.delete(`/api/evidence/receipts/${res.id}`).expect(404);
    expect(await list(other)).toEqual([]);

    await owner.delete(`/api/evidence/receipts/${res.id}`).expect(204);
    await owner.get(`/api/evidence/receipts/${res.id}`).expect(404);
    await owner.get(`/api/files/${res.fileId}`).expect(404);
    // 지운 뒤에는 같은 파일을 다시 올릴 수 있다
    expect((await upload(owner, png('delete'), 'delete.png').expect(200)).body.duplicate).toBe(
      false,
    );
  });

  it('모의 OCR 구현체는 레지스트리에 등록되어 있다', () => {
    expect(
      registry.resolve(
        'ocr',
        { provider: 'mock', enabled: true, credentials: {} },
        {
          companyId: 'c',
          companyName: '',
          bizNo: null,
        },
      ),
    ).toBeInstanceOf(MockOcrProvider);
  });
});
