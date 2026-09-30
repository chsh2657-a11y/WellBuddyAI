import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));

/** KB국민은행 엑셀 저장 양식(CSV) */
const KB = csv([
  ['KB국민은행 거래내역'],
  [
    '거래일시',
    '적요',
    '보낸분/받는분',
    '송금메모',
    '출금액(원)',
    '입금액(원)',
    '잔액(원)',
    '거래점',
  ],
  ['2026-03-10 09:00:00', '타행이체', '한빛상사', '', '0', '"1,100,000"', '"6,100,000"', '강남'],
  ['2026-03-10 14:30:00', '카드대금', '신한카드', '', '"300,000"', '0', '"5,800,000"', '강남'],
]);

describe('증빙 파일 업로드', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let other: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let bankId: string;
  let cardId: string;

  const upload = (
    agent: Agent,
    step: 'preview' | 'commit',
    file: Buffer,
    filename: string,
    options: object,
  ) =>
    agent
      .post(`/api/evidence/uploads/${step}`)
      .field('options', JSON.stringify(options))
      .attach('file', file, filename);

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@up.local', '업로드상사'));
    ({ agent: other } = await ownerWithCompany(app, 'other@up.local', '다른회사'));
    employee = await inviteAndJoin(app, owner, 'emp@up.local', 'employee');
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
    await owner
      .post('/api/partners')
      .send({ name: '한빛상사', bizRegNo: '220-81-12341' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('통장: 미리보기 → 등록 → 같은 파일은 중복으로 건너뛴다', async () => {
    const options = { kind: 'bank', sourceId: bankId };
    await upload(employee, 'preview', KB, 'kb.csv', options).expect(403);
    const preview = (await upload(owner, 'preview', KB, 'kb.csv', options).expect(200)).body;
    expect(preview).toMatchObject({ headerRow: 1, total: 2, duplicates: 0, issueCount: 0 });
    expect(preview.mapping).toMatchObject({
      date: 0,
      description: 1,
      counterparty: 2,
      withdrawal: 4,
      deposit: 5,
    });
    expect(preview.sample[0]).toMatchObject({
      row: 3,
      deposit: 1_100_000,
      counterparty: '한빛상사',
    });

    const first = (await upload(owner, 'commit', KB, 'kb.csv', options).expect(200)).body;
    expect(first).toMatchObject({ fetched: 2, inserted: 2, duplicates: 0 });
    const again = (await upload(owner, 'commit', KB, 'kb.csv', options).expect(200)).body;
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(
      (await upload(owner, 'preview', KB, 'kb.csv', options).expect(200)).body.duplicates,
    ).toBe(2);

    const list = (await owner.get('/api/evidence/bank-transactions').expect(200)).body;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ accountAlias: '운영자금', status: 'pending', source: 'file' });
    const runs = (await owner.get('/api/evidence/runs').expect(200)).body;
    expect(runs.map((r: { inserted: number }) => r.inserted)).toEqual([0, 2]);

    // 다른 회사에는 보이지 않고, 남의 계좌로 올릴 수도 없다
    expect((await other.get('/api/evidence/bank-transactions').expect(200)).body).toEqual([]);
    await upload(other, 'preview', KB, 'kb.csv', options).expect(400);
  });

  it('처음 보는 양식: 열을 지정해 등록하고 매핑을 저장하면 다음에는 저절로 쓴다', async () => {
    const custom = csv([
      ['A', 'B', 'C'],
      ['2026-03-15', '사무실 월세', '"500,000"'],
    ]);
    const auto = (
      await upload(owner, 'preview', custom, 'custom.csv', {
        kind: 'bank',
        sourceId: bankId,
      }).expect(200)
    ).body;
    expect(auto).toMatchObject({ headerRow: -1, total: 0 });
    expect(auto.issues[0].message).toMatch(/직접 지정/);
    expect(auto.topRows).toEqual([
      ['A', 'B', 'C'],
      ['2026-03-15', '사무실 월세', '500,000'],
    ]);

    const manual = {
      kind: 'bank',
      sourceId: bankId,
      headerRow: 0,
      mapping: { date: 0, description: 1, withdrawal: 2 },
    };
    const committed = (
      await upload(owner, 'commit', custom, 'custom.csv', {
        ...manual,
        saveMapping: true,
        mappingName: '관리비 계좌 양식',
      }).expect(200)
    ).body;
    expect(committed.inserted).toBe(1);
    const reuse = (
      await upload(owner, 'preview', custom, 'custom2.csv', {
        kind: 'bank',
        sourceId: bankId,
      }).expect(200)
    ).body;
    expect(reuse).toMatchObject({ savedMappingName: '관리비 계좌 양식', total: 1, duplicates: 1 });
    const mappings = (await owner.get('/api/evidence/mappings').expect(200)).body;
    expect(mappings).toHaveLength(1);
    await owner.delete(`/api/evidence/mappings/${mappings[0].id}`).expect(204);
  });

  it('카드: 확장자만 .xls 인 HTML 표도 읽고, 취소를 구분한다', async () => {
    const html = `<table>
      <tr><td>승인일자</td><td>승인시간</td><td>가맹점명</td><td>승인금액</td><td>승인번호</td><td>승인구분</td></tr>
      <tr><td>2026.03.10</td><td>12:30</td><td>김밥천국</td><td>8,000</td><td>30012345</td><td>승인</td></tr>
      <tr><td>2026.03.11</td><td>09:00</td><td>김밥천국</td><td>8,000</td><td>30012345</td><td>취소</td></tr>
    </table>`;
    const result = (
      await upload(owner, 'commit', Buffer.from(html), '카드이용내역.xls', {
        kind: 'card',
        sourceId: cardId,
      }).expect(200)
    ).body;
    expect(result.inserted).toBe(2);
    const list = (await owner.get('/api/evidence/card-transactions').expect(200)).body;
    expect(list.map((c: { cancelled: boolean }) => c.cancelled).sort()).toEqual([false, true]);
  });

  it('홈택스: 세금계산서는 사업자번호로 매출·매입을 가르고 거래처를 찾는다, 현금영수증은 방향 필수', async () => {
    const invoices = csv([
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
        '2026-03-10',
        '20260310-41000000-00000001',
        '220-81-12341',
        '한빛상사',
        '000-00-00000',
        '업로드상사',
        '"1,100,000"',
        '"1,000,000"',
        '"100,000"',
        '원자재',
      ],
      [
        '2026-03-12',
        '20260312-41000000-00000002',
        '000-00-00000',
        '업로드상사',
        '220-81-12341',
        '한빛상사',
        '"550,000"',
        '"500,000"',
        '"50,000"',
        '제품',
      ],
    ]);
    const done = (
      await upload(owner, 'commit', invoices, '세금계산서.csv', { kind: 'tax_invoice' }).expect(200)
    ).body;
    expect(done.inserted).toBe(2);
    const list = (await owner.get('/api/evidence/tax-invoices').expect(200)).body as {
      direction: string;
      partnerName: string | null;
    }[];
    expect(list.map((t) => [t.direction, t.partnerName]).sort()).toEqual([
      ['purchase', '한빛상사'],
      ['sales', '한빛상사'],
    ]);
    const receipts = csv([
      ['매입일시', '가맹점명', '부가세', '총금액', '승인번호', '승인구분', '공제여부'],
      ['2026-03-10 11:00:00', '문구나라', '"1,000"', '"11,000"', 'A0001', '승인거래', '지출증빙'],
    ]);
    const noDirection = await upload(owner, 'preview', receipts, '현금영수증.csv', {
      kind: 'cash_receipt',
    }).expect(400);
    expect(noDirection.body.message).toMatch(/매출·매입/);
    await upload(owner, 'commit', receipts, '현금영수증.csv', {
      kind: 'cash_receipt',
      direction: 'purchase',
    }).expect(200);
    const [latest] = (await owner.get('/api/evidence/runs').expect(200)).body;
    expect(latest).toMatchObject({ channel: 'hometax', provider: 'file', trigger: 'file' });
    expect(latest.message).toMatch(/^현금영수증\.csv: 1건 등록/);
    const cash = (await owner.get('/api/evidence/cash-receipts').expect(200)).body;
    expect(cash[0]).toMatchObject({
      supplyAmount: 10_000,
      vatAmount: 1_000,
      usage: 'expense_proof',
    });
  });

  it('제외 처리와 되살리기, 사용 중지한 계좌에는 올릴 수 없다', async () => {
    const [first] = (await owner.get('/api/evidence/bank-transactions').expect(200)).body;
    await owner
      .patch(`/api/evidence/bank/${first.id}/status`)
      .send({ status: 'ignored' })
      .expect(204);
    const ignored = (
      await owner.get('/api/evidence/bank-transactions').query({ status: 'ignored' }).expect(200)
    ).body;
    expect(ignored).toHaveLength(1);
    await owner
      .patch(`/api/evidence/bank/${first.id}/status`)
      .send({ status: 'pending' })
      .expect(204);
    await owner
      .patch(`/api/evidence/unknown/${first.id}/status`)
      .send({ status: 'pending' })
      .expect(400);

    await owner.patch(`/api/bank-accounts/${bankId}`).send({ isActive: false }).expect(200);
    const inactive = await upload(owner, 'preview', KB, 'kb.csv', {
      kind: 'bank',
      sourceId: bankId,
    }).expect(400);
    expect(inactive.body.code).toBe('SOURCE_INACTIVE');
    await owner.delete(`/api/bank-accounts/${bankId}`).expect(409);
  });
});
