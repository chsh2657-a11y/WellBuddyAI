import type { CashReceiptRecord, InvoiceDirection, TaxInvoiceRecord } from '../records.js';
import { normalizeBizNo, parseAmount, parseDateTime } from './cells.js';
import {
  type ColumnMapping,
  detectHeader,
  type FieldSpec,
  missingFields,
  type ParseResult,
} from './columns.js';

export type TaxInvoiceField =
  | 'issueDate'
  | 'approvalNo'
  | 'supplierBizNo'
  | 'supplierName'
  | 'buyerBizNo'
  | 'buyerName'
  | 'totalAmount'
  | 'supplyAmount'
  | 'vatAmount'
  | 'kind'
  | 'itemSummary';

/**
 * 홈택스 "전자(세금)계산서 목록조회" 엑셀. 상호 열이 공급자·공급받는자에 한 번씩 나오므로
 * 사업자번호 다음에 오는 상호를 순서대로 짝짓는다(필드 순서가 곧 짝짓는 순서).
 */
export const TAX_INVOICE_FIELDS: FieldSpec<TaxInvoiceField>[] = [
  { key: 'issueDate', label: '작성일자', required: true, synonyms: ['작성일자', '작성일'] },
  { key: 'approvalNo', label: '승인번호', required: true, synonyms: ['승인번호'] },
  {
    key: 'supplierBizNo',
    label: '공급자 사업자번호',
    required: true,
    synonyms: ['공급자사업자등록번호', '공급자사업자번호', '공급자등록번호'],
  },
  { key: 'supplierName', label: '공급자 상호', required: true, synonyms: ['공급자상호', '상호'] },
  {
    key: 'buyerBizNo',
    label: '공급받는자 사업자번호',
    required: true,
    synonyms: ['공급받는자사업자등록번호', '공급받는자사업자번호', '공급받는자등록번호'],
  },
  {
    key: 'buyerName',
    label: '공급받는자 상호',
    required: true,
    synonyms: ['공급받는자상호', '상호'],
  },
  { key: 'totalAmount', label: '합계금액', required: false, synonyms: ['합계금액', '합계'] },
  { key: 'supplyAmount', label: '공급가액', required: true, synonyms: ['공급가액'] },
  { key: 'vatAmount', label: '세액', required: false, synonyms: ['세액', '부가세'] },
  {
    key: 'kind',
    label: '종류',
    required: false,
    synonyms: ['전자세금계산서종류', '전자계산서종류', '종류'],
  },
  { key: 'itemSummary', label: '품목명', required: false, synonyms: ['품목명'] },
];

/**
 * 세금계산서·계산서 표 → 세금계산서.
 * - 방향: direction 을 주면 그대로, 아니면 우리 사업자번호가 공급자면 매출, 공급받는자면 매입
 * - exempt: 계산서(면세) 파일이면 true. 세금계산서는 "영세율" 종류를 영세로 본다
 */
export function parseTaxInvoiceRows(
  rows: string[][],
  options: {
    companyBizNo?: string | null;
    direction?: InvoiceDirection;
    exempt?: boolean;
    mapping?: ColumnMapping<TaxInvoiceField>;
    headerRow?: number;
  } = {},
): ParseResult<TaxInvoiceRecord, TaxInvoiceField> {
  const detected =
    options.mapping && options.headerRow !== undefined
      ? { headerRow: options.headerRow, mapping: options.mapping }
      : detectHeader(rows, TAX_INVOICE_FIELDS);
  if (!detected) {
    return {
      headerRow: -1,
      headers: [],
      mapping: {},
      records: [],
      issues: [
        {
          row: 0,
          message: '홈택스 세금계산서 목록 머리글(작성일자·승인번호 등)을 찾지 못했습니다.',
        },
      ],
    };
  }
  const { headerRow, mapping } = detected;
  const headers = rows[headerRow] ?? [];
  const missing = missingFields(mapping, TAX_INVOICE_FIELDS);
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
  const cell = (row: string[], key: TaxInvoiceField) => {
    const i = mapping[key];
    return i === undefined ? undefined : (row[i] ?? '').trim();
  };
  const own = normalizeBizNo(options.companyBizNo ?? undefined);
  const records: ParseResult<TaxInvoiceRecord, TaxInvoiceField>['records'] = [];
  const issues: ParseResult<TaxInvoiceRecord, TaxInvoiceField>['issues'] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const line = r + 1;
    if (row.every((c) => (c ?? '').trim() === '')) continue;
    const when = parseDateTime(cell(row, 'issueDate'));
    const approvalNo = (cell(row, 'approvalNo') ?? '').replace(/\s/g, '');
    if (!when || !approvalNo) {
      if (!row.some((c) => /합\s*계|소\s*계/.test(c ?? ''))) {
        issues.push({ row: line, message: '작성일자·승인번호를 읽지 못했습니다.' });
      }
      continue;
    }
    const supplierBizNo = normalizeBizNo(cell(row, 'supplierBizNo'));
    const buyerBizNo = normalizeBizNo(cell(row, 'buyerBizNo'));
    if (!supplierBizNo || !buyerBizNo) {
      issues.push({ row: line, message: '사업자등록번호가 10자리가 아닙니다.' });
      continue;
    }
    const supply = parseAmount(cell(row, 'supplyAmount'));
    const vat = mapping.vatAmount === undefined ? 0 : parseAmount(cell(row, 'vatAmount'));
    if (supply === null || vat === null) {
      issues.push({ row: line, message: '공급가액·세액을 읽지 못했습니다.' });
      continue;
    }
    const total =
      mapping.totalAmount === undefined ? supply + vat : parseAmount(cell(row, 'totalAmount'));
    if (total !== supply + vat) {
      issues.push({ row: line, message: '합계금액이 공급가액 + 세액과 다릅니다.' });
      continue;
    }
    const direction: InvoiceDirection | null =
      options.direction ??
      (own === supplierBizNo ? 'sales' : own === buyerBizNo ? 'purchase' : null);
    if (!direction) {
      issues.push({
        row: line,
        message:
          '우리 회사 사업자번호가 공급자·공급받는자 어디에도 없습니다(매출·매입을 골라 주세요).',
      });
      continue;
    }
    const kindText = cell(row, 'kind') ?? '';
    records.push({
      row: line,
      record: {
        direction,
        kind: options.exempt ? 'exempt' : /영세/.test(kindText) ? 'zero' : 'tax',
        approvalNo,
        issueDate: when.date,
        supplierBizNo,
        supplierName: cell(row, 'supplierName') || supplierBizNo,
        buyerBizNo,
        buyerName: cell(row, 'buyerName') || buyerBizNo,
        supplyAmount: supply,
        vatAmount: vat,
        totalAmount: total,
        itemSummary: cell(row, 'itemSummary') || null,
      },
    });
  }
  return { headerRow, headers, mapping, records, issues };
}

export type CashReceiptField =
  | 'date'
  | 'bizNo'
  | 'name'
  | 'supplyAmount'
  | 'vatAmount'
  | 'serviceCharge'
  | 'totalAmount'
  | 'approvalNo'
  | 'status'
  | 'usage';

/** 홈택스 현금영수증 매입·매출 내역 */
export const CASH_RECEIPT_FIELDS: FieldSpec<CashReceiptField>[] = [
  {
    key: 'date',
    label: '거래일(시)',
    required: true,
    synonyms: ['매입일시', '매출일시', '거래일시', '거래일자', '승인일시', '일시'],
  },
  {
    key: 'bizNo',
    label: '가맹점 사업자번호',
    required: false,
    synonyms: ['가맹점사업자등록번호', '가맹점사업자번호', '사업자등록번호', '사업자번호'],
  },
  { key: 'name', label: '가맹점', required: false, synonyms: ['가맹점명', '가맹점상호', '상호'] },
  { key: 'supplyAmount', label: '공급가액', required: false, synonyms: ['공급가액'] },
  { key: 'vatAmount', label: '부가세', required: false, synonyms: ['부가세', '세액'] },
  { key: 'serviceCharge', label: '봉사료', required: false, synonyms: ['봉사료'] },
  {
    key: 'totalAmount',
    label: '총금액',
    required: true,
    synonyms: ['총금액', '합계금액', '거래금액', '금액'],
  },
  { key: 'approvalNo', label: '승인번호', required: true, synonyms: ['승인번호'] },
  { key: 'status', label: '승인구분', required: false, synonyms: ['승인구분', '거래유형', '구분'] },
  {
    key: 'usage',
    label: '용도',
    required: false,
    synonyms: ['거래구분', '발급용도', '용도', '공제여부'],
  },
];

export function parseCashReceiptRows(
  rows: string[][],
  options: {
    direction: InvoiceDirection;
    mapping?: ColumnMapping<CashReceiptField>;
    headerRow?: number;
  },
): ParseResult<CashReceiptRecord, CashReceiptField> {
  const detected =
    options.mapping && options.headerRow !== undefined
      ? { headerRow: options.headerRow, mapping: options.mapping }
      : detectHeader(rows, CASH_RECEIPT_FIELDS);
  if (!detected) {
    return {
      headerRow: -1,
      headers: [],
      mapping: {},
      records: [],
      issues: [
        { row: 0, message: '현금영수증 내역 머리글(일시·총금액·승인번호)을 찾지 못했습니다.' },
      ],
    };
  }
  const { headerRow, mapping } = detected;
  const headers = rows[headerRow] ?? [];
  const missing = missingFields(mapping, CASH_RECEIPT_FIELDS);
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
  const cell = (row: string[], key: CashReceiptField) => {
    const i = mapping[key];
    return i === undefined ? undefined : (row[i] ?? '').trim();
  };
  const records: ParseResult<CashReceiptRecord, CashReceiptField>['records'] = [];
  const issues: ParseResult<CashReceiptRecord, CashReceiptField>['issues'] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const line = r + 1;
    if (row.every((c) => (c ?? '').trim() === '')) continue;
    const when = parseDateTime(cell(row, 'date'));
    const approvalNo = cell(row, 'approvalNo') ?? '';
    if (!when || !approvalNo) {
      if (!row.some((c) => /합\s*계|소\s*계/.test(c ?? ''))) {
        issues.push({ row: line, message: '거래일시·승인번호를 읽지 못했습니다.' });
      }
      continue;
    }
    const total = parseAmount(cell(row, 'totalAmount'));
    const vat = mapping.vatAmount === undefined ? 0 : parseAmount(cell(row, 'vatAmount'));
    const service =
      mapping.serviceCharge === undefined ? 0 : (parseAmount(cell(row, 'serviceCharge')) ?? 0);
    if (total === null || vat === null) {
      issues.push({ row: line, message: '금액을 읽지 못했습니다.' });
      continue;
    }
    const supplyText =
      mapping.supplyAmount === undefined ? null : parseAmount(cell(row, 'supplyAmount'));
    const supply = supplyText ?? Math.abs(total) - Math.abs(vat) - Math.abs(service);
    const status = cell(row, 'status') ?? '';
    const usage = cell(row, 'usage') ?? '';
    records.push({
      row: line,
      record: {
        direction: options.direction,
        date: when.date,
        approvalNo,
        bizNo: normalizeBizNo(cell(row, 'bizNo')),
        name: cell(row, 'name') || '(상호 없음)',
        supplyAmount: Math.abs(supply),
        vatAmount: Math.abs(vat),
        totalAmount: Math.abs(total),
        usage: /지출|사업자/.test(usage) ? 'expense_proof' : 'income_deduction',
        cancelled: /취소/.test(status) || total < 0,
      },
    });
  }
  return { headerRow, headers, mapping, records, issues };
}
