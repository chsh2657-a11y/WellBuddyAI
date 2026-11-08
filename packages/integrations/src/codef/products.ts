/**
 * CODEF 상품 경로(개발가이드 상품 안내 https://developer.codef.io/products).
 * 경로·응답 필드는 상품 버전에 따라 조금씩 달라서 한곳에 모으고, 응답은 여러 필드 이름을 받아 읽는다.
 * 계약 후 샌드박스·데모 서버에서 [연결 테스트]와 수집으로 확인한다.
 */
export const CODEF_PRODUCTS = {
  /** 계정 등록(Connected ID 발급)·추가 */
  accountCreate: '/v1/account/create',
  accountAdd: '/v1/account/add',
  /** 은행 기업 수시입출 거래내역 */
  bankTransactions: '/v1/kr/bank/b/account/transaction-list',
  /** 카드 법인 승인내역 */
  cardApprovals: '/v1/kr/card/b/account/approval-list',
  /** 홈택스 전자세금계산서 매출·매입 목록 */
  taxInvoices: '/v1/kr/public/nt/tax-invoice/sales-purchase-list',
  /** 홈택스 현금영수증 매출·매입 내역 */
  cashReceiptSales: '/v1/kr/public/nt/cash-receipt/sales-details',
  cashReceiptPurchases: '/v1/kr/public/nt/cash-receipt/purchase-details',
  /** 홈택스 사업용 신용카드 매입 내역 */
  businessCardPurchases: '/v1/kr/public/nt/business-card/purchase-details',
} as const;

/** 계정 등록 업무 구분 */
export const CODEF_BUSINESS_TYPES = { bank: 'BK', card: 'CD', hometax: 'NT' } as const;
/** 국세청(홈택스) 기관 코드 */
export const CODEF_HOMETAX_ORG = '0001';
