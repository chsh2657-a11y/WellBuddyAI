import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, todayInKorea } from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import { bizNo } from '@wellbuddy/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));
const today = todayInKorea();
const d = (n: number) => addDays(today, -n);
const HANBIT = bizNo('220811234');
const DONGYANG = bizNo('312813456');
const BANK_HEADER = ['거래일시', '적요', '보낸분/받는분', '출금액(원)', '입금액(원)'];
const INVOICE_HEADER = [
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
];
const sale = (n: number, date: string, supply: number) => [
  date,
  `${date.replace(/-/g, '')}-41000000-0000000${n}`,
  '0000000000',
  '반제상사',
  HANBIT,
  '(주)한빛상사',
  `"${(supply * 1.1).toLocaleString('en-US')}"`,
  `"${supply.toLocaleString('en-US')}"`,
  `"${(supply / 10).toLocaleString('en-US')}"`,
  '제품',
];

interface ReviewItem {
  evidenceKind: string;
  evidenceId: string;
  kind: string;
  counterparty: string | null;
  description: string;
  amount: number;
  accountCode: string | null;
  partnerName: string | null;
  method: string;
  confidence: number;
  reason: string | null;
  settleCount: number;
}

describe('외상 반제 매칭(P2-27)·규칙 제안(P2-25)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let bankId: string;
  let cardId: string;

  const upload = (kind: string, file: Buffer, extra: object = {}) =>
    owner
      .post('/api/evidence/uploads/commit')
      .field('options', JSON.stringify({ kind, ...extra }))
      .attach('file', file, `${kind}.csv`)
      .expect(200);
  const run = async () => (await owner.post('/api/auto-journal/run').expect(200)).body;
  const review = async () =>
    (await owner.get('/api/auto-journal/review').expect(200)).body as ReviewItem[];
  const ref = (i: ReviewItem) => ({ evidenceKind: i.evidenceKind, evidenceId: i.evidenceId });
  const approve = async (items: ReviewItem[]) =>
    (
      await owner
        .post('/api/auto-journal/approve')
        .send({ items: items.map(ref) })
        .expect(200)
    ).body;
  const invoices = async () =>
    (await owner.get('/api/evidence/tax-invoices').expect(200)).body as {
      direction: string;
      totalAmount: number;
      status: string;
      settledAt: string | null;
    }[];

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@settle.local', '반제상사'));
    employee = await inviteAndJoin(app, owner, 'emp@settle.local', 'employee');
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

    // 외상 매출 3장, 매입 1장을 전표로
    await upload(
      'tax_invoice',
      csv([
        INVOICE_HEADER,
        sale(1, d(20), 1_000_000),
        sale(2, d(15), 2_000_000),
        sale(3, d(12), 500_000),
        [
          d(14),
          `${d(14).replace(/-/g, '')}-41000000-00000009`,
          DONGYANG,
          '동양자재(주)',
          '0000000000',
          '반제상사',
          '"3,300,000"',
          '"3,000,000"',
          '"300,000"',
          '원자재',
        ],
      ]),
    );
    await run();
    const done = await approve(await review());
    expect(done.failed).toEqual([]);
    expect((await invoices()).every((i) => i.status === 'posted' && !i.settledAt)).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('입금은 미결 매출 세금계산서와, 출금은 매입 세금계산서와 금액을 맞춰 반제를 추천한다', async () => {
    await upload(
      'bank',
      csv([
        BANK_HEADER,
        [`${d(5)} 09:00:00`, '타행입금', '(주)한빛상사', '0', '"3,300,000"'],
        [`${d(4)} 09:00:00`, '타행입금', '한빛상사', '0', '"400,000"'],
        [`${d(3)} 09:00:00`, '타행이체', '동양자재', '"3,300,000"', '0'],
        [`${d(2)} 09:00:00`, '타행입금', '(주)한빛상사', '0', '"550,000"'],
      ]),
      { sourceId: bankId },
    );
    await run();
    const items = await review();
    const byAmount = (kind: string, amount: number) =>
      items.find((i) => i.kind === kind && i.amount === amount)!;

    // 1,100,000 + 2,200,000 (오래된 순서 합)
    expect(byAmount('bank_in', 3_300_000)).toMatchObject({
      method: 'settlement',
      confidence: 0.93,
      accountCode: '108',
      partnerName: '(주)한빛상사',
      settleCount: 2,
    });
    expect(byAmount('bank_in', 3_300_000).reason).toContain('세금계산서 2장');
    // 앞 입금이 가져간 두 장을 빼고, 남은 550,000 중 일부
    expect(byAmount('bank_in', 400_000)).toMatchObject({
      method: 'settlement',
      confidence: 0.7,
      settleCount: 0,
      reason: '외상매출금 일부 반제(미결 1장 550,000원 중 400,000원)',
    });
    // 남은 550,000 과 정확히 같다
    expect(byAmount('bank_in', 550_000)).toMatchObject({ confidence: 0.95, settleCount: 1 });
    // 매입: 이름 '동양자재' ↔ 세금계산서 '동양자재(주)'
    expect(byAmount('bank_out', 3_300_000)).toMatchObject({
      method: 'settlement',
      confidence: 0.95,
      accountCode: '251',
      partnerName: '동양자재(주)',
      settleCount: 1,
    });
  });

  it('승인하면 세금계산서가 반제되고, 계정을 바꾸면 반제 짝을 버린다', async () => {
    const items = await review();
    const deposit = items.find((i) => i.kind === 'bank_in' && i.amount === 3_300_000)!;
    const payment = items.find((i) => i.kind === 'bank_out')!;
    const exact = items.find((i) => i.kind === 'bank_in' && i.amount === 550_000)!;

    const done = await approve([deposit, payment]);
    expect(done.failed).toEqual([]);
    const entry = (await owner.get(`/api/journals/${done.posted[0].entryId}`).expect(200)).body;
    expect(
      entry.lines.map((l: { accountCode: string; debit: number; credit: number }) => [
        l.accountCode,
        l.debit,
        l.credit,
      ]),
    ).toEqual([
      ['103', 3_300_000, 0],
      ['108', 0, 3_300_000],
    ]);
    const settled = (await invoices()).filter((i) => i.settledAt);
    expect(settled.map((i) => [i.direction, i.totalAmount]).sort()).toEqual([
      ['purchase', 3_300_000],
      ['sales', 1_100_000],
      ['sales', 2_200_000],
    ]);

    // 550,000 입금을 잡이익으로 바꾸면 세금계산서는 미결로 남는다
    await owner
      .put(`/api/auto-journal/review/bank/${exact.evidenceId}`)
      .send({ accountId: acc['930'] })
      .expect(204);
    const changed = (await review()).find((i) => i.evidenceId === exact.evidenceId)!;
    expect(changed).toMatchObject({ method: 'manual', settleCount: 0 });
    await approve([changed]);
    expect((await invoices()).find((i) => i.totalAmount === 550_000)?.settledAt).toBeNull();
    // 다시 실행하면 남은 입금(400,000)이 남은 550,000 의 일부 반제로 추천된다
    await run();
    expect((await review()).find((i) => i.amount === 400_000)).toMatchObject({
      method: 'settlement',
      confidence: 0.7,
    });
  });

  it('같은 거래를 같은 계정으로 3번 승인하면 규칙을 제안하고, 수락하면 규칙이 된다', async () => {
    const card = (n: number) => [
      d(n),
      '12:00',
      '스타벅스 역삼점',
      '커피전문점',
      '"5,500"',
      `3001000${n}`,
      '승인',
    ];
    await upload(
      'card',
      csv([
        ['승인일자', '승인시간', '가맹점명', '업종', '승인금액', '승인번호', '승인구분'],
        card(1),
        card(2),
        card(3),
      ]),
      { sourceId: cardId },
    );
    await run();
    const coffee = (await review()).filter((i) => i.kind === 'card');
    expect(coffee).toHaveLength(3);
    // 2번 승인만으로는 제안하지 않는다
    await approve(coffee.slice(0, 2));
    let suggestions = (await owner.get('/api/auto-journal/rule-suggestions').expect(200)).body;
    expect(suggestions.find((s: { kind: string }) => s.kind === 'card')).toBeUndefined();
    await approve(coffee.slice(2));

    suggestions = (await owner.get('/api/auto-journal/rule-suggestions').expect(200)).body;
    const cardSuggestion = suggestions.find((s: { kind: string }) => s.kind === 'card');
    expect(cardSuggestion).toMatchObject({
      label: '스타벅스 역삼점',
      keywords: '스타벅스 역삼점',
      partnerId: null,
      account: '811 복리후생비',
      useCount: 3,
      total: 3,
      name: '스타벅스 역삼점 → 복리후생비',
    });
    // 매출 세금계산서 3장(같은 거래처·같은 계정)은 사업자번호·거래처·이름 열쇠를 합친 거래처 조건
    const sales = suggestions.find((s: { kind: string }) => s.kind === 'tax_sales');
    expect(sales).toMatchObject({
      partnerName: '(주)한빛상사',
      keywords: null,
      account: '404 제품매출',
    });
    expect(sales.keys).toHaveLength(3);

    const refOf = (s: { kind: string; keys: string[] }) => ({ kind: s.kind, keys: s.keys });
    await employee
      .post('/api/auto-journal/rule-suggestions/accept')
      .send(refOf(cardSuggestion))
      .expect(403);
    const rule = (
      await owner
        .post('/api/auto-journal/rule-suggestions/accept')
        .send(refOf(cardSuggestion))
        .expect(201)
    ).body;
    expect(rule).toMatchObject({
      kinds: ['card'],
      keywords: '스타벅스 역삼점',
      account: '811 복리후생비',
    });
    await owner.post('/api/auto-journal/rule-suggestions/dismiss').send(refOf(sales)).expect(204);
    expect((await owner.get('/api/auto-journal/rule-suggestions').expect(200)).body).toEqual([]);
    await owner.post('/api/auto-journal/rule-suggestions/accept').send(refOf(sales)).expect(404);

    // 다음 스타벅스는 규칙으로 분류된다
    await upload(
      'card',
      csv([
        ['승인일자', '승인시간', '가맹점명', '업종', '승인금액', '승인번호', '승인구분'],
        card(0),
      ]),
      { sourceId: cardId },
    );
    await run();
    expect((await review()).find((i) => i.kind === 'card')).toMatchObject({
      method: 'rule',
      confidence: 1,
    });
  });
});
