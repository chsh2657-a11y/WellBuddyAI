import type { BankTransactionRecord } from '../records.js';
import { parseAmount, parseDateTime, parseTime } from './cells.js';
import {
  type ColumnMapping,
  detectHeader,
  type FieldSpec,
  missingFields,
  type ParseResult,
} from './columns.js';

export type BankField =
  | 'date'
  | 'time'
  | 'description'
  | 'counterparty'
  | 'deposit'
  | 'withdrawal'
  | 'amount'
  | 'kind'
  | 'balance'
  | 'memo';

/** 은행 거래내역 머리글(국민·신한·우리·하나·기업·농협 엑셀 저장 양식의 이름을 모두 담았다) */
export const BANK_FIELDS: FieldSpec<BankField>[] = [
  {
    key: 'date',
    label: '거래일(시)',
    required: true,
    synonyms: ['거래일시', '거래일자', '거래일', '일자', '날짜', '거래날짜', '일시'],
  },
  { key: 'time', label: '거래시간', required: false, synonyms: ['거래시간', '시간', '시각'] },
  // 입출금 구분을 금액 열보다 먼저 찾는다("입출금구분"이 출금 열로 잘못 잡히지 않게)
  {
    key: 'kind',
    label: '입출금 구분',
    required: false,
    synonyms: ['입출금구분', '입출구분', '구분'],
  },
  {
    key: 'deposit',
    label: '입금',
    required: false,
    synonyms: ['입금액', '입금', '입금금액', '맡기신금액'],
  },
  {
    key: 'withdrawal',
    label: '출금',
    required: false,
    synonyms: ['출금액', '출금', '출금금액', '찾으신금액', '지급', '지급액', '지급금액'],
  },
  {
    key: 'balance',
    label: '잔액',
    required: false,
    synonyms: ['거래후잔액', '잔액', '잔고'],
  },
  // 금액 한 열(부호 또는 구분으로 입출금 판단)은 입금·출금 열이 없을 때만 잡힌다
  { key: 'amount', label: '거래금액', required: false, synonyms: ['거래금액', '금액'] },
  {
    key: 'counterparty',
    label: '받는분·보낸분',
    required: false,
    synonyms: [
      '보낸분/받는분',
      '받는분/보낸분',
      '의뢰인/수취인',
      '보낸분',
      '받는분',
      '의뢰인',
      '수취인',
      '기재내용',
      '거래기록사항',
      '상대방',
      '입금자명',
      '상대계좌예금주명',
      '내용',
    ],
  },
  // 적요 열이 없으면 받는분·보낸분(내용) 열을 적요로 쓴다
  { key: 'description', label: '적요', required: true, synonyms: ['적요', '거래내용', '거래적요'] },
  { key: 'memo', label: '메모', required: false, synonyms: ['송금메모', '메모', '비고'] },
];

/** 은행별 양식(머리글 예시). 자동 인식이 기본이고, 목록은 화면 안내·테스트용이다 */
export const BANK_PRESETS: { code: string; name: string; headers: string[] }[] = [
  {
    code: '0004',
    name: 'KB국민은행',
    headers: [
      '거래일시',
      '적요',
      '보낸분/받는분',
      '송금메모',
      '출금액(원)',
      '입금액(원)',
      '잔액(원)',
      '거래점',
      '구분',
    ],
  },
  {
    code: '0088',
    name: '신한은행',
    headers: [
      '거래일자',
      '거래시간',
      '적요',
      '출금(원)',
      '입금(원)',
      '내용',
      '잔액(원)',
      '거래점명',
    ],
  },
  {
    code: '0020',
    name: '우리은행',
    headers: [
      '거래일시',
      '적요',
      '기재내용',
      '지급(원)',
      '입금(원)',
      '거래후 잔액(원)',
      '취급점',
      '메모',
    ],
  },
  {
    code: '0081',
    name: '하나은행',
    headers: ['거래일시', '적요', '의뢰인/수취인', '입금', '출금', '거래후잔액', '구분', '거래점'],
  },
  {
    code: '0003',
    name: 'IBK기업은행',
    headers: [
      '거래일시',
      '출금',
      '입금',
      '거래후 잔액',
      '거래내용',
      '상대계좌번호',
      '상대은행',
      '메모',
    ],
  },
  {
    code: '0011',
    name: 'NH농협은행',
    headers: [
      '거래일시',
      '출금금액',
      '입금금액',
      '거래후잔액',
      '거래내용',
      '거래기록사항',
      '거래점',
    ],
  },
];

const SUMMARY = /합\s*계|소\s*계|총\s*계|이월|누\s*계/;

/** 은행 거래내역 표 → 통장 거래. 매핑을 주지 않으면 머리글을 자동으로 찾는다 */
export function parseBankRows(
  rows: string[][],
  options: { mapping?: ColumnMapping<BankField>; headerRow?: number } = {},
): ParseResult<BankTransactionRecord, BankField> {
  const detected =
    options.mapping && options.headerRow !== undefined
      ? { headerRow: options.headerRow, mapping: options.mapping }
      : detectHeader(rows, BANK_FIELDS);
  if (!detected) {
    return {
      headerRow: -1,
      headers: [],
      mapping: {},
      records: [],
      issues: [
        {
          row: 0,
          message: '거래일·적요·입출금 머리글을 찾지 못했습니다. 열을 직접 지정해 주세요.',
        },
      ],
    };
  }
  const { headerRow, mapping } = detected;
  const headers = rows[headerRow] ?? [];
  const hasAmounts =
    mapping.deposit !== undefined ||
    mapping.withdrawal !== undefined ||
    mapping.amount !== undefined;
  const missing = missingFields(
    mapping,
    BANK_FIELDS,
    (key) =>
      mapping[key] !== undefined || (key === 'description' && mapping.counterparty !== undefined),
  );
  if (missing.length > 0 || !hasAmounts) {
    return {
      headerRow,
      headers,
      mapping,
      records: [],
      issues: [
        {
          row: headerRow + 1,
          message: `열을 지정해 주세요: ${[...missing.map((f) => f.label), ...(hasAmounts ? [] : ['입금·출금'])].join(', ')}`,
        },
      ],
    };
  }

  const cell = (row: string[], key: BankField) => {
    const i = mapping[key];
    return i === undefined ? undefined : (row[i] ?? '').trim();
  };
  const records: ParseResult<BankTransactionRecord, BankField>['records'] = [];
  const issues: ParseResult<BankTransactionRecord, BankField>['issues'] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const line = r + 1;
    if (row.every((c) => (c ?? '').trim() === '')) continue;
    const when = parseDateTime(cell(row, 'date'));
    if (!when) {
      if (!row.some((c) => SUMMARY.test(c ?? ''))) {
        issues.push({
          row: line,
          message: `거래일을 읽지 못했습니다(${cell(row, 'date') ?? ''}).`,
        });
      }
      continue;
    }
    let deposit = parseAmount(cell(row, 'deposit')) ?? NaN;
    let withdrawal = parseAmount(cell(row, 'withdrawal')) ?? NaN;
    if (mapping.deposit === undefined) deposit = 0;
    if (mapping.withdrawal === undefined) withdrawal = 0;
    if (mapping.amount !== undefined) {
      const amount = parseAmount(cell(row, 'amount'));
      const kind = cell(row, 'kind') ?? '';
      if (amount === null) {
        issues.push({ row: line, message: '금액을 읽지 못했습니다.' });
        continue;
      }
      const out = /출금|지급|인출/.test(kind) || amount < 0;
      deposit = out ? 0 : Math.abs(amount);
      withdrawal = out ? Math.abs(amount) : 0;
    }
    if (Number.isNaN(deposit) || Number.isNaN(withdrawal)) {
      issues.push({ row: line, message: '입금·출금 금액을 읽지 못했습니다.' });
      continue;
    }
    // 음수로 적힌 출금(-50,000)은 출금으로 본다
    if (deposit < 0) [deposit, withdrawal] = [0, withdrawal + Math.abs(deposit)];
    if (withdrawal < 0) [deposit, withdrawal] = [deposit + Math.abs(withdrawal), 0];
    if (deposit > 0 === withdrawal > 0) {
      issues.push({ row: line, message: '입금과 출금 중 하나만 있어야 합니다.' });
      continue;
    }
    const balance = mapping.balance === undefined ? null : parseAmount(cell(row, 'balance'));
    const description = cell(row, 'description') || cell(row, 'counterparty') || '(적요 없음)';
    records.push({
      row: line,
      record: {
        date: when.date,
        time: parseTime(cell(row, 'time')) ?? when.time,
        description,
        counterparty: cell(row, 'counterparty') || null,
        deposit,
        withdrawal,
        balance,
        memo: cell(row, 'memo') || null,
      },
    });
  }
  return { headerRow, headers, mapping, records, issues };
}
