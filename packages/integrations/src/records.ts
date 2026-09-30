/**
 * 공급자(파일·모의·실연동)가 돌려주는 공통 형식. 금액은 원 단위 정수, 날짜는 YYYY-MM-DD, 시각은 HH:MM:SS.
 * 수집한 원천 기록은 이 형식으로 바꾼 뒤 중복 제거 해시를 붙여 저장한다.
 */

/** 통장 거래 한 건 */
export interface BankTransactionRecord {
  date: string;
  time?: string | null;
  /** 적요(거래 내용) */
  description: string;
  /** 받는 분·보낸 분 */
  counterparty?: string | null;
  deposit: number;
  withdrawal: number;
  /** 거래 후 잔액(은행이 주면) */
  balance?: number | null;
  memo?: string | null;
  /** 공급자가 주는 거래 고유번호(있으면 중복 판단에 쓴다) */
  externalId?: string | null;
}

/** 카드 승인 한 건(취소는 cancelled=true, 금액은 양수) */
export interface CardApprovalRecord {
  date: string;
  time?: string | null;
  merchantName: string;
  merchantBizNo?: string | null;
  amount: number;
  vatAmount?: number | null;
  approvalNo: string;
  installmentMonths?: number | null;
  cancelled: boolean;
  /** 가맹점 업종 */
  category?: string | null;
}

export type InvoiceDirection = 'sales' | 'purchase';

/** 전자세금계산서·계산서 한 장 */
export interface TaxInvoiceRecord {
  direction: InvoiceDirection;
  /** tax: 세금계산서(과세), zero: 영세율, exempt: 계산서(면세) */
  kind: 'tax' | 'zero' | 'exempt';
  /** 국세청 승인번호 */
  approvalNo: string;
  issueDate: string;
  supplierBizNo: string;
  supplierName: string;
  buyerBizNo: string;
  buyerName: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  itemSummary?: string | null;
}

/** 현금영수증 한 건 */
export interface CashReceiptRecord {
  direction: InvoiceDirection;
  date: string;
  approvalNo: string;
  /** 상대방(가맹점 또는 구매자) 사업자번호·이름 */
  bizNo?: string | null;
  name: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  /** income_deduction: 소득공제, expense_proof: 지출증빙 */
  usage: 'income_deduction' | 'expense_proof';
  cancelled: boolean;
}

/** 영수증 인식 결과 */
export interface ReceiptFields {
  date: string | null;
  merchantName: string | null;
  bizNo: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  /** 0~1 */
  confidence: number;
  items?: { name: string; amount: number }[];
}
