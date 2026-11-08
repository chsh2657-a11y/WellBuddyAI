import { SYSTEM_ACCOUNTS } from './chart-of-accounts.js';
import { assertWon, MoneyError } from './money.js';
import { type VatType, vatFromSupply } from './vat.js';

/** 계정 코드로 표현한 분개 줄(API 가 코드를 회사 계정 ID 로 바꿔 저장한다) */
export interface TemplateLine {
  accountCode: string;
  debit: number;
  credit: number;
  /** 거래처를 붙일 줄(채권·채무 줄) */
  withPartner?: boolean;
}

export interface SalesInput {
  supply: number;
  /** 생략하면 과세유형으로 계산(과세 10%, 원 미만 절사) */
  vat?: number;
  vatType: VatType;
  /** 매출 계정(기본 401 상품매출) */
  revenueCode?: string;
  /** 받을 돈 계정(기본 108 외상매출금, 현금매출이면 101·103) */
  receivableCode?: string;
}

/** 매출: (차) 외상매출금 합계 / (대) 매출 공급가액, 부가세예수금 부가세 */
export function salesLines(input: SalesInput): TemplateLine[] {
  const { supply, vat } = resolveAmounts(input.supply, input.vat, input.vatType);
  const receivable = input.receivableCode ?? SYSTEM_ACCOUNTS.accountsReceivable;
  const lines: TemplateLine[] = [
    { accountCode: receivable, debit: supply + vat, credit: 0, withPartner: true },
    {
      accountCode: input.revenueCode ?? SYSTEM_ACCOUNTS.merchandiseSales,
      debit: 0,
      credit: supply,
    },
  ];
  if (vat > 0) lines.push({ accountCode: SYSTEM_ACCOUNTS.vatReceived, debit: 0, credit: vat });
  return lines;
}

export interface PurchaseInput {
  supply: number;
  vat?: number;
  vatType: VatType;
  /** 비용·자산 계정(예: 146 상품, 830 소모품비) */
  expenseCode: string;
  /** 줄 돈 계정(기본 251 외상매입금; 카드 결제는 253 미지급금, 즉시 지급은 101·103) */
  payableCode?: string;
  /**
   * 매입세액 공제 여부. 기업업무추진비·비영업용 소형승용차·면세사업 관련 매입 등은 불공제이며,
   * 불공제 부가세는 부가세대급금이 아니라 비용·자산 원가에 포함한다.
   */
  deductible?: boolean;
}

/** 매입: (차) 비용·자산 공급가액, 부가세대급금 부가세 / (대) 외상매입금 합계 */
export function purchaseLines(input: PurchaseInput): TemplateLine[] {
  const { supply, vat } = resolveAmounts(input.supply, input.vat, input.vatType);
  const deductible = input.deductible ?? true;
  const lines: TemplateLine[] = [
    { accountCode: input.expenseCode, debit: deductible ? supply : supply + vat, credit: 0 },
  ];
  if (deductible && vat > 0) {
    lines.push({ accountCode: SYSTEM_ACCOUNTS.vatPaid, debit: vat, credit: 0 });
  }
  lines.push({
    accountCode: input.payableCode ?? SYSTEM_ACCOUNTS.accountsPayable,
    debit: 0,
    credit: supply + vat,
    withPartner: true,
  });
  return lines;
}

/** 입금: (차) 현금·예금 / (대) 상대 계정 */
export function receiptLines(
  amount: number,
  counterCode: string,
  cashCode: string = SYSTEM_ACCOUNTS.cash,
) {
  assertPositive(amount);
  return [
    { accountCode: cashCode, debit: amount, credit: 0 },
    { accountCode: counterCode, debit: 0, credit: amount, withPartner: true },
  ] satisfies TemplateLine[];
}

/** 출금: (차) 상대 계정 / (대) 현금·예금 */
export function paymentLines(
  amount: number,
  counterCode: string,
  cashCode: string = SYSTEM_ACCOUNTS.cash,
) {
  assertPositive(amount);
  return [
    { accountCode: counterCode, debit: amount, credit: 0, withPartner: true },
    { accountCode: cashCode, debit: 0, credit: amount },
  ] satisfies TemplateLine[];
}

function assertPositive(amount: number) {
  assertWon(amount);
  if (amount <= 0) throw new MoneyError('금액은 0보다 커야 합니다.');
}

function resolveAmounts(supply: number, vat: number | undefined, vatType: VatType) {
  assertPositive(supply);
  if (vat === undefined) return vatFromSupply(supply, vatType);
  assertWon(vat, '부가세');
  if (vat < 0) throw new MoneyError('부가세는 0 이상이어야 합니다.');
  if (vatType !== 'taxable' && vat !== 0) {
    throw new MoneyError('영세·면세 거래에는 부가세가 없습니다.');
  }
  return { supply, vat, total: supply + vat };
}
