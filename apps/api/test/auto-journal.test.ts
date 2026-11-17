import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayInKorea } from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import {
  type AiClassifier,
  bizNo,
  type ClassifyInput,
  ClaudeClassifier,
  ProviderRegistry,
} from '@wellbuddy/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));
const today = todayInKorea();
const d = (n: number) => addDays(today, -n);
const HANBIT = bizNo('220811234');
const DONGYANG = bizNo('312813456');
const BANK_HEADER = [
  '거래일시',
  '적요',
  '보낸분/받는분',
  '송금메모',
  '출금액(원)',
  '입금액(원)',
  '잔액(원)',
  '거래점',
];

interface ReviewItem {
  evidenceKind: string;
  evidenceId: string;
  kind: string;
  description: string;
  counterparty: string | null;
  accountId: string | null;
  accountCode: string | null;
  partnerName: string | null;
  confidence: number;
  method: string;
  reason: string | null;
  error: string | null;
  edited: boolean;
  memo: string | null;
  lines: { accountCode: string; debit: number; credit: number }[];
}

describe('자동분개: 매칭·분류·검토함·승인·학습·규칙·자동 전기', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let other: Agent;
  let employee: Agent;
  let accountant: Agent;
  const acc: Record<string, string> = {};
  let bankId: string;
  let cardId: string;

  const upload = (kind: string, file: Buffer, name: string, extra: object = {}) =>
    owner
      .post('/api/evidence/uploads/commit')
      .field('options', JSON.stringify({ kind, ...extra }))
      .attach('file', file, name)
      .expect(200);
  const review = async (agent: Agent = owner) =>
    (await agent.get('/api/auto-journal/review').expect(200)).body as ReviewItem[];
  const find = (items: ReviewItem[], text: string) =>
    items.find((i) => `${i.counterparty} ${i.description}`.includes(text))!;
  const ref = (i: ReviewItem) => ({ evidenceKind: i.evidenceKind, evidenceId: i.evidenceId });
  const journal = async (id: string) => (await owner.get(`/api/journals/${id}`).expect(200)).body;
  const lineCodes = (j: { lines: { accountCode: string; debit: number; credit: number }[] }) =>
    j.lines.map((l) => [l.accountCode, l.debit, l.credit]);

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@aj.local', '자동분개상사'));
    ({ agent: other } = await ownerWithCompany(app, 'other@aj.local', '다른회사'));
    employee = await inviteAndJoin(app, owner, 'emp@aj.local', 'employee');
    accountant = await inviteAndJoin(app, owner, 'acct@aj.local', 'accountant');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    bankId = (
      await owner
        .post('/api/bank-accounts')
        .send({
          bankCode: '0004',
          alias: '운영자금',
          accountNo: '12345678901234',
          ledgerAccountId: acc['103'],
        })
        .expect(201)
    ).body.id;
    cardId = (
      await owner
        .post('/api/corporate-cards')
        .send({
          cardCompany: '0306',
          alias: '법인카드',
          cardNo: '4518123456789012',
          ledgerAccountId: acc['253'],
        })
        .expect(201)
    ).body.id;
    await owner.post('/api/partners').send({ name: '(주)한빛상사', bizRegNo: HANBIT }).expect(201);

    await upload(
      'bank',
      csv([
        BANK_HEADER,
        [
          `${d(10)} 09:00:00`,
          '타행입금',
          '(주)한빛상사',
          '',
          '0',
          '"1,100,000"',
          '"11,100,000"',
          '강남',
        ],
        [
          `${d(9)} 10:00:00`,
          '임대료',
          '(주)강남빌딩',
          '',
          '"2,200,000"',
          '0',
          '"8,900,000"',
          '강남',
        ],
        [
          `${d(8)} 11:00:00`,
          '타행이체',
          '처음보는상점',
          '',
          '"50,000"',
          '0',
          '"8,850,000"',
          '강남',
        ],
      ]),
      'bank.csv',
      { sourceId: bankId },
    );
    await upload(
      'card',
      csv([
        ['승인일자', '승인시간', '가맹점명', '업종', '승인금액', '승인번호', '승인구분'],
        [d(7), '12:30', '스타벅스 역삼점', '커피전문점', '"11,000"', '30010001', '승인'],
        [d(7), '13:00', '김밥천국 역삼점', '일반음식점', '"8,000"', '30010002', '승인'],
        [d(6), '09:00', '김밥천국 역삼점', '일반음식점', '"8,000"', '30010002', '취소'],
      ]),
      'card.csv',
      { sourceId: cardId },
    );
    await upload(
      'tax_invoice',
      csv([
        [
          '작성일자',
          '승인번호',
          '공급자사업자등록번호',
          '상호',
          '공급받는자사업자등록번호',
          '상호',
          '합계금액',
          '공급가액',
          '세액',
          '품목명',
        ],
        [
          d(5),
          '20260901-41000000-00000001',
          DONGYANG,
          '동양자재(주)',
          '0000000000',
          '자동분개상사',
          '"3,300,000"',
          '"3,000,000"',
          '"300,000"',
          '원자재',
        ],
        [
          d(4),
          '20260902-41000000-00000002',
          '0000000000',
          '자동분개상사',
          HANBIT,
          '(주)한빛상사',
          '"5,500,000"',
          '"5,000,000"',
          '"500,000"',
          '제품',
        ],
      ]),
      'invoices.csv',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('실행: 카드 승인·취소는 서로 상쇄하고, 나머지는 추천과 함께 검토함으로', async () => {
    expect((await owner.get('/api/auto-journal/settings').expect(200)).body).toEqual({
      autoPost: false,
      threshold: 0.9,
    });
    await employee.post('/api/auto-journal/run').expect(403);
    const summary = (await owner.post('/api/auto-journal/run').expect(200)).body;
    expect(summary).toEqual({
      total: 8,
      matched: 2,
      posted: 0,
      review: 6,
      failed: 0,
      aiClassified: 0,
      aiError: null,
    });

    const cards = (await owner.get('/api/evidence/card-transactions').expect(200)).body as {
      merchantName: string;
      status: string;
    }[];
    expect(cards.filter((c) => c.merchantName.startsWith('김밥')).map((c) => c.status)).toEqual([
      'matched',
      'matched',
    ]);

    const items = await review();
    expect(items).toHaveLength(6);
    expect(find(items, '타행입금')).toMatchObject({
      kind: 'bank_in',
      accountCode: '108',
      partnerName: '(주)한빛상사',
      method: 'default',
      confidence: 0.6,
    });
    const rent = find(items, '임대료');
    expect(rent).toMatchObject({ kind: 'bank_out', accountCode: '819', method: 'default' });
    expect(rent.lines).toEqual([
      { accountCode: '819', accountName: '지급임차료', debit: 2_200_000, credit: 0 },
      { accountCode: '103', accountName: '보통예금', debit: 0, credit: 2_200_000 },
    ]);
    expect(find(items, '처음보는상점')).toMatchObject({
      accountId: null,
      method: 'none',
      lines: [],
    });
    expect(find(items, '스타벅스')).toMatchObject({ kind: 'card', accountCode: '811' });
    expect(find(items, '원자재')).toMatchObject({ kind: 'tax_purchase', accountCode: '153' });
    expect(find(items, '제품')).toMatchObject({
      kind: 'tax_sales',
      accountCode: '404',
      partnerName: '(주)한빛상사',
    });
    // 다른 회사에는 보이지 않는다
    expect(await review(other)).toEqual([]);
  });

  it('승인: 하나씩 전표로 만들고, 실패한 건은 이유와 함께 남긴다, 거래처는 사업자번호로 자동 등록', async () => {
    const items = await review();
    const rent = find(items, '임대료');
    const unknown = find(items, '처음보는상점');
    const material = find(items, '원자재');
    const result = (
      await owner
        .post('/api/auto-journal/approve')
        .send({ items: [ref(rent), ref(unknown), ref(material)] })
        .expect(200)
    ).body;
    expect(result.posted).toHaveLength(2);
    expect(result.failed).toEqual([{ ...ref(unknown), message: '분개할 계정을 골라 주세요.' }]);

    const rentEntry = await journal(
      result.posted.find((p: { evidenceId: string }) => p.evidenceId === rent.evidenceId).entryId,
    );
    expect(rentEntry).toMatchObject({ status: 'posted', source: 'evidence', type: 'payment' });
    expect(lineCodes(rentEntry)).toEqual([
      ['819', 2_200_000, 0],
      ['103', 0, 2_200_000],
    ]);
    const materialEntry = await journal(
      result.posted.find((p: { evidenceId: string }) => p.evidenceId === material.evidenceId)
        .entryId,
    );
    expect(materialEntry.type).toBe('purchase');
    expect(lineCodes(materialEntry)).toEqual([
      ['153', 3_000_000, 0],
      ['135', 300_000, 0],
      ['251', 0, 3_300_000],
    ]);
    expect(materialEntry.lines[2].partnerName).toBe('동양자재(주)');
    const partners = (await owner.get('/api/partners').expect(200)).body as {
      name: string;
      bizRegNo: string;
    }[];
    expect(partners.find((p) => p.name === '동양자재(주)')?.bizRegNo).toBe(DONGYANG);
    const invoices = (await owner.get('/api/evidence/tax-invoices').expect(200)).body;
    expect(invoices.find((i: { itemSummary: string }) => i.itemSummary === '원자재')).toMatchObject(
      {
        status: 'posted',
        partnerName: '동양자재(주)',
      },
    );
    const bank = (await owner.get('/api/evidence/bank-transactions').expect(200)).body;
    expect(
      bank.find((t: { description: string }) => t.description === '임대료').entryNumber,
    ).toBeTruthy();

    const after = await review();
    expect(after).toHaveLength(4);
    expect(find(after, '처음보는상점').error).toBe('분개할 계정을 골라 주세요.');
    // 이미 전기한 증빙은 다시 승인할 수 없고, 다른 회사는 남의 증빙을 승인할 수 없다
    const again = (
      await owner
        .post('/api/auto-journal/approve')
        .send({ items: [ref(rent)] })
        .expect(200)
    ).body;
    expect(again.failed[0].message).toMatch(/이미 처리/);
    const stolen = (
      await other
        .post('/api/auto-journal/approve')
        .send({ items: [ref(unknown)] })
        .expect(200)
    ).body;
    expect(stolen).toMatchObject({ posted: [] });
  });

  it('검토함에서 계정을 고치면 다시 실행해도 그대로이고, 승인하면 전표가 된다', async () => {
    const unknown = find(await review(), '처음보는상점');
    await owner
      .put(`/api/auto-journal/review/bank/${unknown.evidenceId}`)
      .send({ accountId: acc['831'], memo: '소액 송금 수수료' })
      .expect(204);
    await owner.post('/api/auto-journal/run').expect(200);
    const edited = find(await review(), '처음보는상점');
    expect(edited).toMatchObject({
      accountCode: '831',
      method: 'manual',
      edited: true,
      confidence: 1,
      error: null,
    });
    expect(edited.lines.map((l) => l.accountCode)).toEqual(['831', '103']);
    const done = (
      await owner
        .post('/api/auto-journal/approve')
        .send({ items: [ref(edited)] })
        .expect(200)
    ).body;
    const entry = await journal(done.posted[0].entryId);
    expect(entry.description).toBe('소액 송금 수수료');
    await owner
      .put(`/api/auto-journal/review/bank/${unknown.evidenceId}`)
      .send({ accountId: acc['831'] })
      .expect(404);
  });

  it('학습: 승인한 분개는 같은 거래처의 다음 거래에 과거 이력으로 추천된다', async () => {
    await upload(
      'bank',
      csv([
        BANK_HEADER,
        [
          `${d(2)} 10:00:00`,
          '임대료',
          '(주)강남빌딩',
          '',
          '"2,200,000"',
          '0',
          '"6,650,000"',
          '강남',
        ],
        [
          `${d(2)} 11:00:00`,
          '타행이체',
          '미지의거래처',
          '',
          '"70,000"',
          '0',
          '"6,580,000"',
          '강남',
        ],
      ]),
      'bank2.csv',
      { sourceId: bankId },
    );
    await owner.post('/api/auto-journal/run').expect(200);
    const rent = (await review()).find((i) => i.description === '임대료')!;
    expect(rent).toMatchObject({ accountCode: '819', method: 'history', confidence: 0.7 });
    expect(rent.reason).toContain('1번 중 1번');
  });

  it('회사 규칙이 과거 이력·기본 추천보다 먼저이고, 조건이 없거나 남의 계정이면 거절', async () => {
    await owner
      .post('/api/auto-journal/rules')
      .send({ name: '조건 없음', accountId: acc['811'] })
      .expect(400);
    const otherAccount = (
      (await other.get('/api/accounts').expect(200)).body as { id: string; code: string }[]
    ).find((a) => a.code === '811')!.id;
    const foreign = await owner
      .post('/api/auto-journal/rules')
      .send({ name: '남의 계정', keywords: '스타벅스', accountId: otherAccount })
      .expect(400);
    expect(foreign.body.code).toBe('NOT_FOUND');

    const rule = (
      await owner
        .post('/api/auto-journal/rules')
        .send({
          name: '커피는 복리후생비',
          kinds: ['card'],
          keywords: '스타벅스, 이디야',
          accountId: acc['811'],
          memo: '직원 커피',
        })
        .expect(201)
    ).body;
    expect(rule).toMatchObject({ account: '811 복리후생비', hitCount: 0, isActive: true });
    await owner.post('/api/auto-journal/run').expect(200);
    const coffee = find(await review(), '스타벅스');
    expect(coffee).toMatchObject({ method: 'rule', confidence: 1, memo: '직원 커피' });
    expect(coffee.reason).toContain('커피는 복리후생비');
    const [listed] = (await owner.get('/api/auto-journal/rules').expect(200)).body;
    expect(listed.hitCount).toBe(1);
    expect(listed.lastHitAt).not.toBeNull();
  });

  it('자동 전기: 신뢰도 기준 이상만 전표가 되고, 한 건이 실패해도 나머지는 만든다', async () => {
    await owner
      .post('/api/auto-journal/rules')
      .send({
        name: '외상매입금 시험',
        kinds: ['bank_out'],
        keywords: '미지의거래처',
        accountId: acc['251'],
      })
      .expect(201);
    await owner
      .put('/api/auto-journal/settings')
      .send({ autoPost: true, threshold: 0.9 })
      .expect(200);
    const summary = (await owner.post('/api/auto-journal/run').expect(200)).body;
    expect(summary).toMatchObject({ posted: 1, failed: 1 });

    const cards = (await owner.get('/api/evidence/card-transactions').expect(200)).body;
    const coffee = cards.find((c: { merchantName: string }) =>
      c.merchantName.startsWith('스타벅스'),
    );
    expect(coffee.status).toBe('posted');
    const entry = await journal(coffee.entryId);
    expect(entry).toMatchObject({ type: 'purchase', status: 'posted', description: '직원 커피' });
    expect(lineCodes(entry)).toEqual([
      ['811', 10_000, 0],
      ['135', 1_000, 0],
      ['253', 0, 11_000],
    ]);
    expect(entry.lines[2].partnerName).toBe('신한카드');
    expect(entry.vat).toMatchObject({
      evidenceType: 'card',
      supplyAmount: 10_000,
      vatAmount: 1_000,
    });

    const failed = find(await review(), '미지의거래처');
    expect(failed.method).toBe('rule');
    expect(failed.error).toMatch(/거래처가 필요/);
    // 기준보다 낮은 추천(과거 이력 0.7)은 그대로 검토함
    expect((await review()).find((i) => i.description === '임대료')?.method).toBe('history');
  });

  it('전표 승인을 쓰는 회사에서 경리가 승인하면 승인요청 전표가 된다', async () => {
    await owner.patch('/api/companies/current').send({ journalApprovalRequired: true }).expect(200);
    try {
      const deposit = find(await review(accountant), '타행입금');
      const done = (
        await accountant
          .post('/api/auto-journal/approve')
          .send({ items: [ref(deposit)] })
          .expect(200)
      ).body;
      expect(done.failed).toEqual([]);
      const entry = await journal(done.posted[0].entryId);
      expect(entry.status).toBe('pending');
      expect(lineCodes(entry)).toEqual([
        ['103', 1_100_000, 0],
        ['108', 0, 1_100_000],
      ]);
      expect(entry.lines[1].partnerName).toBe('(주)한빛상사');
    } finally {
      await owner
        .patch('/api/companies/current')
        .send({ journalApprovalRequired: false })
        .expect(200);
    }
  });
  it('마감한 기간이면 전기하지 못하고, 그 사이 자동 등록한 거래처도 함께 되돌린다', async () => {
    const lastYear = String(Number(today.slice(0, 4)) - 1);
    const supplier = bizNo('409812345');
    await owner
      .post('/api/fiscal-years')
      .send({ date: `${lastYear}-01-01` })
      .expect(201);
    const years = (await owner.get('/api/fiscal-years').expect(200)).body;
    const june = years.find((y: { label: string }) => y.label === lastYear).periods[5];
    await owner.post(`/api/accounting-periods/${june.id}/lock`).expect(200);
    await upload(
      'tax_invoice',
      csv([
        [
          '작성일자',
          '승인번호',
          '공급자사업자등록번호',
          '상호',
          '공급받는자사업자등록번호',
          '상호',
          '합계금액',
          '공급가액',
          '세액',
          '품목명',
        ],
        [
          `${lastYear}-06-15`,
          `${lastYear}0615-41000000-00000009`,
          supplier,
          '신규자재상사',
          '0000000000',
          '자동분개상사',
          '"110,000"',
          '"100,000"',
          '"10,000"',
          '작년자재',
        ],
      ]),
      'old.csv',
    );
    await owner
      .post('/api/auto-journal/rules')
      .send({
        name: '작년 매입',
        kinds: ['tax_purchase'],
        keywords: '작년자재',
        accountId: acc['153'],
      })
      .expect(201);
    const summary = (await owner.post('/api/auto-journal/run').expect(200)).body;
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    const old = find(await review(), '작년자재');
    expect(old).toMatchObject({ method: 'rule', confidence: 1 });
    expect(old.error).toBeTruthy();
    const partners = (await owner.get('/api/partners').expect(200)).body as { name: string }[];
    expect(partners.some((p) => p.name === '신규자재상사')).toBe(false);
    const invoices = (await owner.get('/api/evidence/tax-invoices').expect(200)).body;
    expect(
      invoices.find((i: { itemSummary: string }) => i.itemSummary === '작년자재'),
    ).toMatchObject({
      status: 'review',
      partnerName: null,
    });
  });
  it('AI 분류: 규칙·이력이 없는 거래만 AI 에 묻고, 기준 이상이면 자동 전기, AI 가 실패해도 실행은 끝난다', async () => {
    await upload(
      'bank',
      csv([
        BANK_HEADER,
        [`${d(1)} 15:00:00`, '타행이체', '낯선상호', '', '"88,000"', '0', '"6,492,000"', '강남'],
      ]),
      'bank3.csv',
      { sourceId: bankId },
    );
    const sent: ClassifyInput[][] = [];
    let fail = false;
    const fake: AiClassifier = {
      testConnection: async () => ({ ok: true, message: 'Claude 연결 확인' }),
      classify: async () => {
        throw new Error('not used');
      },
      classifyMany: async (inputs) => {
        sent.push(inputs);
        if (fail) throw new Error('rate limited');
        return inputs.map((i) =>
          i.counterparty === '낯선상호'
            ? {
                accountCode: '831',
                vatType: 'none' as const,
                confidence: 0.95,
                reason: '수수료로 보입니다',
              }
            : null,
        );
      },
    };
    const registry = app.get(ProviderRegistry);
    registry.register('ai', 'claude', () => fake);
    await owner
      .put('/api/integrations/ai')
      .send({ enabled: true, provider: 'claude', credentials: { apiKey: 'sk-test' } })
      .expect(200);
    try {
      // 연동관리의 연결 테스트는 구현체를 실제로 불러 본다
      expect((await owner.post('/api/integrations/ai/test').expect(200)).body).toEqual({
        ok: true,
        message: 'Claude 연결 확인',
      });
      const summary = (await owner.post('/api/auto-journal/run').expect(200)).body;
      expect(summary).toMatchObject({ aiClassified: 1, aiError: null });
      const asked = sent.flat();
      expect(asked.some((i) => i.counterparty === '낯선상호' && i.amount === -88_000)).toBe(true);
      // 과거 이력(임대료)·회사 규칙(미지의거래처, 작년자재)은 AI 에 보내지 않는다
      expect(asked.map((i) => i.description)).not.toContain('임대료');
      expect(asked.map((i) => i.counterparty)).not.toContain('미지의거래처');
      expect(asked.map((i) => i.description)).not.toContain('작년자재');

      const bank = (await owner.get('/api/evidence/bank-transactions').expect(200)).body;
      const stranger = bank.find((t: { counterparty: string }) => t.counterparty === '낯선상호');
      expect(stranger.status).toBe('posted');
      const entry = await journal(stranger.entryId);
      expect(lineCodes(entry)).toEqual([
        ['831', 88_000, 0],
        ['103', 0, 88_000],
      ]);

      fail = true;
      const failed = (await owner.post('/api/auto-journal/run').expect(200)).body;
      expect(failed).toMatchObject({ aiClassified: 0, aiError: 'rate limited' });
      expect(find(await review(), '제품').method).toBe('default');
    } finally {
      registry.register('ai', 'claude', (c) => new ClaudeClassifier({ apiKey: c.apiKey ?? '' }));
      await owner
        .put('/api/integrations/ai')
        .send({ enabled: false, provider: 'rules' })
        .expect(200);
    }
  });

  it('카드대금 출금은 상대 카드사를 미지급금 거래처로 찾거나 등록해 전기한다', async () => {
    await upload(
      'bank',
      csv([
        BANK_HEADER,
        [
          `${d(1)} 16:00:00`,
          '카드대금',
          '롯데카드 결제',
          '',
          '"350,000"',
          '0',
          '"6,142,000"',
          '강남',
        ],
      ]),
      'bank4.csv',
      { sourceId: bankId },
    );
    await owner.post('/api/auto-journal/run').expect(200);
    const item = find(await review(), '롯데카드 결제 카드대금');
    expect(item).toMatchObject({ accountCode: '253', partnerId: null });
    const result = (
      await owner
        .post('/api/auto-journal/approve')
        .send({ items: [ref(item)] })
        .expect(200)
    ).body as { posted: { entryId: string }[]; failed: unknown[] };
    expect(result.failed).toEqual([]);

    const partners = (await owner.get('/api/partners').expect(200)).body as {
      id: string;
      name: string;
      kind: string;
    }[];
    const lotte = partners.filter((p) => p.name === '롯데카드');
    expect(lotte).toHaveLength(1);
    expect(lotte[0]!.kind).toBe('other');
    const entry = await journal(result.posted[0]!.entryId);
    expect(entry.lines.find((l: { accountCode: string }) => l.accountCode === '253')).toMatchObject(
      {
        debit: 350_000,
        partnerId: lotte[0]!.id,
      },
    );
  });
});
