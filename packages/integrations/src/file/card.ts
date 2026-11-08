import type { CardApprovalRecord } from '../records.js';
import { normalizeBizNo, parseAmount, parseDateTime, parseTime } from './cells.js';
import {
  type ColumnMapping,
  detectHeader,
  type FieldSpec,
  missingFields,
  type ParseResult,
} from './columns.js';

export type CardField =
  | 'date'
  | 'time'
  | 'merchantName'
  | 'merchantBizNo'
  | 'amount'
  | 'vatAmount'
  | 'approvalNo'
  | 'installment'
  | 'status'
  | 'category';

/** 카드 승인내역 머리글(국민·신한·삼성·현대·롯데·BC·하나·우리·NH 이용내역 양식) */
export const CARD_FIELDS: FieldSpec<CardField>[] = [
  {
    key: 'date',
    label: '승인일(시)',
    required: true,
    synonyms: [
      '승인일자',
      '승인일시',
      '이용일자',
      '이용일시',
      '이용일',
      '승인일',
      '거래일자',
      '거래일시',
      '매출일자',
    ],
  },
  {
    key: 'time',
    label: '승인시간',
    required: false,
    synonyms: ['승인시간', '승인시각', '이용시간'],
  },
  {
    key: 'merchantBizNo',
    label: '가맹점 사업자번호',
    required: false,
    synonyms: ['가맹점사업자번호', '가맹점사업자등록번호', '사업자번호', '사업자등록번호'],
  },
  {
    key: 'merchantName',
    label: '가맹점',
    required: true,
    synonyms: ['가맹점명', '이용가맹점', '이용하신곳', '가맹점', '이용처', '상호'],
  },
  {
    key: 'amount',
    label: '승인금액',
    required: true,
    synonyms: ['승인금액', '이용금액', '결제금액', '매출금액', '금액'],
  },
  {
    key: 'vatAmount',
    label: '부가세',
    required: false,
    synonyms: ['부가세', '부가가치세', '세액'],
  },
  { key: 'approvalNo', label: '승인번호', required: true, synonyms: ['승인번호'] },
  {
    key: 'installment',
    label: '할부',
    required: false,
    synonyms: ['할부개월', '할부기간', '할부', '이용구분'],
  },
  {
    key: 'status',
    label: '승인·취소 구분',
    required: false,
    synonyms: ['승인구분', '취소여부', '매출구분', '거래구분', '상태'],
  },
  { key: 'category', label: '업종', required: false, synonyms: ['가맹점업종', '업종명', '업종'] },
];

/** 카드 승인내역 표 → 카드 승인. 취소는 "취소" 표시나 음수 금액으로 판단한다 */
export function parseCardRows(
  rows: string[][],
  options: { mapping?: ColumnMapping<CardField>; headerRow?: number } = {},
): ParseResult<CardApprovalRecord, CardField> {
  const detected =
    options.mapping && options.headerRow !== undefined
      ? { headerRow: options.headerRow, mapping: options.mapping }
      : detectHeader(rows, CARD_FIELDS);
  if (!detected) {
    return {
      headerRow: -1,
      headers: [],
      mapping: {},
      records: [],
      issues: [
        {
          row: 0,
          message: '승인일·가맹점·금액·승인번호 머리글을 찾지 못했습니다. 열을 직접 지정해 주세요.',
        },
      ],
    };
  }
  const { headerRow, mapping } = detected;
  const headers = rows[headerRow] ?? [];
  const missing = missingFields(mapping, CARD_FIELDS);
  if (missing.length > 0) {
    return {
      headerRow,
      headers,
      mapping,
      records: [],
      issues: [
        {
          row: headerRow + 1,
          message: `열을 지정해 주세요: ${missing.map((f) => f.label).join(', ')}`,
        },
      ],
    };
  }
  const cell = (row: string[], key: CardField) => {
    const i = mapping[key];
    return i === undefined ? undefined : (row[i] ?? '').trim();
  };
  const records: ParseResult<CardApprovalRecord, CardField>['records'] = [];
  const issues: ParseResult<CardApprovalRecord, CardField>['issues'] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const line = r + 1;
    if (row.every((c) => (c ?? '').trim() === '')) continue;
    const when = parseDateTime(cell(row, 'date'));
    if (!when) {
      if (!row.some((c) => /합\s*계|소\s*계|총\s*계/.test(c ?? ''))) {
        issues.push({
          row: line,
          message: `승인일을 읽지 못했습니다(${cell(row, 'date') ?? ''}).`,
        });
      }
      continue;
    }
    const amount = parseAmount(cell(row, 'amount'));
    const approvalNo = cell(row, 'approvalNo') ?? '';
    if (amount === null || amount === 0) {
      issues.push({ row: line, message: '승인금액을 읽지 못했습니다.' });
      continue;
    }
    if (!approvalNo) {
      issues.push({ row: line, message: '승인번호가 없습니다.' });
      continue;
    }
    const status = cell(row, 'status') ?? '';
    const installmentText = cell(row, 'installment') ?? '';
    const months =
      /(\d+)\s*개월/.exec(installmentText)?.[1] ??
      (/^\d+$/.test(installmentText) ? installmentText : null);
    const vat = mapping.vatAmount === undefined ? null : parseAmount(cell(row, 'vatAmount'));
    records.push({
      row: line,
      record: {
        date: when.date,
        time: parseTime(cell(row, 'time')) ?? when.time,
        merchantName: cell(row, 'merchantName') || '(가맹점 없음)',
        merchantBizNo: normalizeBizNo(cell(row, 'merchantBizNo')),
        amount: Math.abs(amount),
        vatAmount: vat === null ? null : Math.abs(vat),
        approvalNo,
        installmentMonths: months ? Number(months) : null,
        cancelled: /취소/.test(status) || amount < 0,
        category: cell(row, 'category') || null,
      },
    });
  }
  return { headerRow, headers, mapping, records, issues };
}
