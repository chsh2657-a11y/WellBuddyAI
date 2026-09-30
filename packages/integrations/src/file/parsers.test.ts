import { describe, expect, it } from 'vitest';
import { BANK_PRESETS, parseBankRows } from './bank.js';
import { parseCardRows } from './card.js';
import { normalizeBizNo, parseAmount, parseDateTime } from './cells.js';
import { parseCashReceiptRows, parseTaxInvoiceRows } from './hometax.js';

describe('셀 해석', () => {
  it('금액', () => {
    expect(
      ['1,234', '-1,234', '(1,234)', '1,234원', '', '-', '1234.00', 'abc'].map(parseAmount),
    ).toEqual([1234, -1234, -1234, 1234, 0, 0, 1234, null]);
  });

  it('날짜·일시', () => {
    expect(parseDateTime('2026.03.10 14:23:11')).toEqual({ date: '2026-03-10', time: '14:23:11' });
    expect(parseDateTime('2026/3/9')).toEqual({ date: '2026-03-09', time: null });
    expect(parseDateTime('20260310')).toEqual({ date: '2026-03-10', time: null });
    expect(parseDateTime('2026년 3월 10일')).toEqual({ date: '2026-03-10', time: null });
    expect(parseDateTime('2026-03-10 9:05')).toEqual({ date: '2026-03-10', time: '09:05:00' });
    expect(parseDateTime('46091')).toEqual({ date: '2026-03-10', time: null });
    expect(parseDateTime('합계')).toBeNull();
    expect(parseDateTime('2026-13-01')).toBeNull();
    expect(normalizeBizNo('124-81-00998')).toBe('1248100998');
  });
});

/** 은행별 양식: 제목 줄 + 머리글 + 입금 1건·출금 1건 + 합계 줄 */
const BANK_SAMPLES: Record<string, string[][]> = {
  '0004': [
    [
      '2026-03-10 09:00:00',
      '타행이체',
      '한빛상사',
      '',
      '0',
      '1,100,000',
      '6,100,000',
      '강남',
      '입금',
    ],
    [
      '2026-03-10 14:30:00',
      '카드대금',
      '신한카드',
      '',
      '300,000',
      '0',
      '5,800,000',
      '강남',
      '출금',
    ],
  ],
  '0088': [
    ['2026-03-10', '09:00:00', '타행이체', '', '1,100,000', '한빛상사', '6,100,000', '강남'],
    ['2026-03-10', '14:30:00', '카드대금', '300,000', '', '신한카드', '5,800,000', '강남'],
  ],
  '0020': [
    ['2026.03.10 09:00', '타행이체', '한빛상사', '', '1,100,000', '6,100,000', '강남', ''],
    ['2026.03.10 14:30', '카드대금', '신한카드', '300,000', '', '5,800,000', '강남', ''],
  ],
  '0081': [
    ['2026-03-10 09:00:00', '타행이체', '한빛상사', '1,100,000', '0', '6,100,000', '입금', '강남'],
    ['2026-03-10 14:30:00', '카드대금', '신한카드', '0', '300,000', '5,800,000', '출금', '강남'],
  ],
  '0003': [
    ['2026-03-10 09:00:00', '0', '1,100,000', '6,100,000', '한빛상사', '110-***', '신한', ''],
    ['2026-03-10 14:30:00', '300,000', '0', '5,800,000', '신한카드', '', '', ''],
  ],
  '0011': [
    ['2026/03/10 09:00:00', '0', '1,100,000', '6,100,000', '타행이체', '한빛상사', '강남'],
    ['2026/03/10 14:30:00', '300,000', '0', '5,800,000', '카드대금', '신한카드', '강남'],
  ],
};

describe('은행 거래내역 파서', () => {
  it.each(BANK_PRESETS.map((p) => [p.name, p]))('%s 엑셀 양식을 자동 인식한다', (_name, preset) => {
    const rows = [
      [`${preset.name} 거래내역 조회`],
      ['계좌번호', '110-123-456789', '', '조회기간', '2026-03-01 ~ 2026-03-31'],
      preset.headers,
      ...BANK_SAMPLES[preset.code]!,
      ['합계', '', '', '', '', '', ''],
    ];
    const result = parseBankRows(rows);
    expect(result.issues).toEqual([]);
    expect(result.headerRow).toBe(2);
    expect(
      result.records.map((r) => [
        r.record.date,
        r.record.deposit,
        r.record.withdrawal,
        r.record.balance,
      ]),
    ).toEqual([
      ['2026-03-10', 1_100_000, 0, 6_100_000],
      ['2026-03-10', 0, 300_000, 5_800_000],
    ]);
    const deposit = result.records[0]!.record;
    expect(`${deposit.description} ${deposit.counterparty ?? ''}`).toContain('한빛상사');
    expect(deposit.time).toMatch(/^09:00/);
  });

  it('금액 한 열 + 입출금 구분, 음수 출금, 읽지 못한 줄은 줄 번호와 함께 알려 준다', () => {
    const rows = [
      ['일자', '적요', '거래금액', '입출금구분', '잔액'],
      ['2026-03-11', '이자', '1,200', '입금', '1,001,200'],
      ['2026-03-12', '수수료', '500', '출금', '1,000,700'],
      ['2026-03-13', '환불', '-3,000', '', '997,700'],
      ['어제', '??', '100', '입금', ''],
    ];
    const result = parseBankRows(rows);
    expect(result.records.map((r) => [r.record.deposit, r.record.withdrawal])).toEqual([
      [1_200, 0],
      [0, 500],
      [0, 3_000],
    ]);
    expect(result.issues).toEqual([{ row: 5, message: '거래일을 읽지 못했습니다(어제).' }]);
  });

  it('머리글을 못 찾거나 필수 열이 없으면 열 지정을 요청한다', () => {
    expect(
      parseBankRows([
        ['a', 'b'],
        ['1', '2'],
      ]).issues[0]!.message,
    ).toMatch(/직접 지정/);
    const noAmount = parseBankRows([
      ['거래일자', '적요'],
      ['2026-03-10', 'x'],
    ]);
    expect(noAmount.issues[0]!.message).toContain('입금·출금');
    // 사용자가 고른 매핑으로 다시 읽는다
    const manual = parseBankRows(
      [
        ['A', 'B', 'C'],
        ['2026-03-10', '월세', '500,000'],
      ],
      {
        headerRow: 0,
        mapping: { date: 0, description: 1, withdrawal: 2 },
      },
    );
    expect(manual.records[0]!.record).toMatchObject({ withdrawal: 500_000, description: '월세' });
  });
});

describe('카드 승인내역 파서', () => {
  it('승인·취소, 할부, 가맹점 사업자번호', () => {
    const rows = [
      ['법인카드 이용내역'],
      [
        '이용일자',
        '승인시간',
        '이용하신곳',
        '가맹점사업자번호',
        '이용금액',
        '승인번호',
        '할부기간',
        '승인구분',
        '업종',
      ],
      [
        '2026.03.10',
        '12:31:05',
        '김밥천국 역삼점',
        '220-81-12341',
        '8,000',
        '30012345',
        '일시불',
        '승인',
        '일반음식점',
      ],
      ['2026.03.11', '09:10', '오피스디포', '', '330,000', '30012399', '3개월', '승인', '문구'],
      [
        '2026.03.12',
        '10:00',
        '김밥천국 역삼점',
        '220-81-12341',
        '-8,000',
        '30012345',
        '',
        '취소',
        '',
      ],
    ];
    const result = parseCardRows(rows);
    expect(result.issues).toEqual([]);
    expect(
      result.records.map((r) => [
        r.record.merchantName,
        r.record.amount,
        r.record.cancelled,
        r.record.installmentMonths,
        r.record.merchantBizNo,
      ]),
    ).toEqual([
      ['김밥천국 역삼점', 8_000, false, null, '2208112341'],
      ['오피스디포', 330_000, false, 3, null],
      ['김밥천국 역삼점', 8_000, true, null, '2208112341'],
    ]);
    expect(result.records[0]!.record.time).toBe('12:31:05');
  });
});

describe('홈택스 파서', () => {
  const header = [
    '작성일자',
    '승인번호',
    '발급일자',
    '전송일자',
    '공급자사업자등록번호',
    '종사업장번호',
    '상호',
    '대표자명',
    '주소',
    '공급받는자사업자등록번호',
    '종사업장번호',
    '상호',
    '대표자명',
    '주소',
    '합계금액',
    '공급가액',
    '세액',
    '전자세금계산서분류',
    '전자세금계산서종류',
    '발급유형',
    '비고',
    '영수/청구 구분',
    '품목일자',
    '품목명',
    '품목공급가액',
    '품목세액',
  ];
  const row = (
    supplier: string,
    buyer: string,
    supply: string,
    vat: string,
    total: string,
    kind = '일반',
  ) => [
    '2026-03-10',
    '20260310-41000000-00000001',
    '2026-03-10',
    '2026-03-11',
    supplier,
    '',
    supplier === '124-81-00998' ? '우리회사' : '한빛상사',
    '김',
    '서울',
    buyer,
    '',
    buyer === '124-81-00998' ? '우리회사' : '한빛상사',
    '이',
    '서울',
    total,
    supply,
    vat,
    '세금계산서',
    kind,
    '정발급',
    '',
    '청구',
    '0310',
    '사무용품',
    supply,
    vat,
  ];

  it('세금계산서: 제목 줄을 건너뛰고, 상호 두 열을 공급자·공급받는자로 짝짓고, 매출·매입을 가른다', () => {
    const rows = [
      ['전자세금계산서 목록조회'],
      ['조회기간', '2026-03-01 ~ 2026-03-31'],
      header,
      row('220-81-12341', '124-81-00998', '1,000,000', '100,000', '1,100,000'),
      row('124-81-00998', '220-81-12341', '500,000', '0', '500,000', '영세율'),
      row('220-81-12341', '124-81-00998', '1,000,000', '100,000', '1,000,000'),
    ];
    const result = parseTaxInvoiceRows(rows, { companyBizNo: '1248100998' });
    expect(
      result.records.map((r) => [
        r.record.direction,
        r.record.kind,
        r.record.supplierName,
        r.record.buyerName,
      ]),
    ).toEqual([
      ['purchase', 'tax', '한빛상사', '우리회사'],
      ['sales', 'zero', '우리회사', '한빛상사'],
    ]);
    expect(result.records[0]!.record).toMatchObject({
      supplyAmount: 1_000_000,
      vatAmount: 100_000,
      totalAmount: 1_100_000,
      itemSummary: '사무용품',
    });
    expect(result.issues).toEqual([{ row: 6, message: '합계금액이 공급가액 + 세액과 다릅니다.' }]);
    // 우리 사업자번호가 없는 파일은 매출·매입을 골라야 한다
    expect(parseTaxInvoiceRows(rows.slice(0, 4)).issues[0]!.message).toMatch(/매출·매입을 골라/);
    expect(
      parseTaxInvoiceRows(rows.slice(0, 4), { direction: 'purchase', exempt: true }).records[0]!
        .record.kind,
    ).toBe('exempt');
  });

  it('현금영수증 매입: 총금액에서 공급가액을 구하고 취소를 표시한다', () => {
    const rows = [
      [
        '매입일시',
        '가맹점 사업자등록번호',
        '가맹점명',
        '업종',
        '부가세',
        '봉사료',
        '총금액',
        '승인번호',
        '승인구분',
        '공제여부',
      ],
      [
        '2026-03-10 11:00:00',
        '220-81-12341',
        '문구나라',
        '소매',
        '1,000',
        '0',
        '11,000',
        'A0001',
        '승인거래',
        '지출증빙',
      ],
      [
        '2026-03-11 11:00:00',
        '220-81-12341',
        '문구나라',
        '소매',
        '-1,000',
        '0',
        '-11,000',
        'A0001',
        '취소거래',
        '지출증빙',
      ],
    ];
    const result = parseCashReceiptRows(rows, { direction: 'purchase' });
    expect(result.issues).toEqual([]);
    expect(
      result.records.map((r) => [
        r.record.supplyAmount,
        r.record.vatAmount,
        r.record.cancelled,
        r.record.usage,
      ]),
    ).toEqual([
      [10_000, 1_000, false, 'expense_proof'],
      [10_000, 1_000, true, 'expense_proof'],
    ]);
  });
});
