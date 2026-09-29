import { Decimal } from 'decimal.js';
import { SYSTEM_ACCOUNTS } from './chart-of-accounts.js';
import { assertWon, MoneyError } from './money.js';
import type { TemplateLine } from './templates.js';

/**
 * 외화·환율 계산. 외화 금액은 문자열 소수(최대 소수 둘째 자리)로 다루고 float 를 쓰지 않는다.
 * 원화 환산은 원 미만 반올림(사사오입)한다.
 */

export const BASE_CURRENCY = 'KRW';

/** 자주 쓰는 통화(환율 고시 단위: 엔화는 100엔당 원) */
export const CURRENCIES = [
  { code: 'USD', name: '미국 달러', unit: 1 },
  { code: 'EUR', name: '유로', unit: 1 },
  { code: 'JPY', name: '일본 엔', unit: 100 },
  { code: 'CNY', name: '중국 위안', unit: 1 },
  { code: 'GBP', name: '영국 파운드', unit: 1 },
  { code: 'HKD', name: '홍콩 달러', unit: 1 },
  { code: 'VND', name: '베트남 동', unit: 100 },
] as const;

export const FX_ACCOUNTS = {
  /** 외화환산이익·손실(기말 평가) */
  revaluationGain: '910',
  revaluationLoss: '955',
  /** 외환차익·차손(결제) */
  exchangeGain: '907',
  exchangeLoss: '952',
} as const;

const FOREIGN = /^-?\d+(\.\d{1,2})?$/;

/** "1,234.5" → "1234.50" (소수 둘째 자리까지). 형식이 틀리면 null */
export function parseForeign(input: string): string | null {
  const s = input.replace(/[,\s]/g, '');
  if (!FOREIGN.test(s)) return null;
  return new Decimal(s).toFixed(2);
}

function decimal(value: string | number, label: string): Decimal {
  try {
    const d = new Decimal(value);
    if (!d.isFinite()) throw new Error();
    return d;
  } catch {
    throw new MoneyError(`${label}이(가) 숫자가 아닙니다.`);
  }
}

/** 외화 × 환율(÷ 고시 단위) → 원화(원 미만 반올림) */
export function toKrw(foreignAmount: string | number, rate: string | number, unit = 1): number {
  const krw = decimal(foreignAmount, '외화 금액')
    .times(decimal(rate, '환율'))
    .dividedBy(unit)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
  return assertWon(krw, '원화 환산액');
}

/** 외화 합계(소수 둘째 자리 문자열) */
export function sumForeign(values: readonly (string | number)[]): string {
  return values
    .reduce<Decimal>((s, v) => s.plus(decimal(v, '외화 금액')), new Decimal(0))
    .toFixed(2);
}

export type FxSide = 'asset' | 'liability';

export interface RevaluationResult {
  /** 기말 환율로 환산한 원화 잔액 */
  targetKrw: number;
  /** 장부 원화 잔액을 얼마나 바꿔야 하는지(+ 늘림, − 줄임) */
  adjustment: number;
  /** 평가이익(+) 또는 평가손실(−) */
  profit: number;
}

/**
 * 기말 외화평가: 외화 잔액을 기말 환율로 다시 환산해 장부 원화 잔액과의 차이를 구한다.
 * 자산(외화예금·외화채권)은 원화가 늘면 이익, 부채(외화채무)는 원화가 늘면 손실이다.
 * bookKrw 는 정상잔액 방향의 원화 잔액(자산은 차변, 부채는 대변 잔액)이다.
 */
export function revaluation(input: {
  foreignBalance: string | number;
  bookKrw: number;
  closingRate: string | number;
  unit?: number;
  side: FxSide;
}): RevaluationResult {
  assertWon(input.bookKrw, '장부 원화 잔액');
  const targetKrw = toKrw(input.foreignBalance, input.closingRate, input.unit ?? 1);
  const adjustment = targetKrw - input.bookKrw;
  return { targetKrw, adjustment, profit: input.side === 'asset' ? adjustment : -adjustment };
}

/** 외화평가 분개: 평가 대상 계정을 조정하고 차액을 외화환산이익·손실로 */
export function revaluationLines(
  accountCode: string,
  side: FxSide,
  adjustment: number,
): TemplateLine[] {
  assertWon(adjustment, '조정액');
  if (adjustment === 0) return [];
  const amount = Math.abs(adjustment);
  // 계정의 원화 잔액을 늘릴 때: 자산은 차변, 부채는 대변
  const increaseDebit = side === 'asset';
  const accountDebit = adjustment > 0 ? increaseDebit : !increaseDebit;
  const profit = side === 'asset' ? adjustment > 0 : adjustment < 0;
  const plCode = profit ? FX_ACCOUNTS.revaluationGain : FX_ACCOUNTS.revaluationLoss;
  return [
    {
      accountCode,
      debit: accountDebit ? amount : 0,
      credit: accountDebit ? 0 : amount,
      withPartner: true,
    },
    { accountCode: plCode, debit: accountDebit ? 0 : amount, credit: accountDebit ? amount : 0 },
  ];
}

/**
 * 결제 시 외환차손익: 장부 원화(발생 때 환율) vs 실제 결제 원화(결제일 환율).
 * 채권을 받을 때 더 많이 받으면 이익, 채무를 갚을 때 더 많이 내면 손실.
 */
export function settlementProfit(bookKrw: number, settledKrw: number, side: FxSide): number {
  assertWon(bookKrw, '장부 원화');
  assertWon(settledKrw, '결제 원화');
  return side === 'asset' ? settledKrw - bookKrw : bookKrw - settledKrw;
}

/** 외화 채권 회수 분개: (차) 예금 결제액 / (대) 외화채권 장부액, 차액은 외환차익·차손 */
export function settlementLines(input: {
  side: FxSide;
  accountCode: string;
  bookKrw: number;
  settledKrw: number;
  cashCode?: string;
}): TemplateLine[] {
  const cash = input.cashCode ?? SYSTEM_ACCOUNTS.bankDeposit;
  const profit = settlementProfit(input.bookKrw, input.settledKrw, input.side);
  const lines: TemplateLine[] =
    input.side === 'asset'
      ? [
          { accountCode: cash, debit: input.settledKrw, credit: 0 },
          { accountCode: input.accountCode, debit: 0, credit: input.bookKrw, withPartner: true },
        ]
      : [
          { accountCode: input.accountCode, debit: input.bookKrw, credit: 0, withPartner: true },
          { accountCode: cash, debit: 0, credit: input.settledKrw },
        ];
  if (profit > 0) lines.push({ accountCode: FX_ACCOUNTS.exchangeGain, debit: 0, credit: profit });
  if (profit < 0) lines.push({ accountCode: FX_ACCOUNTS.exchangeLoss, debit: -profit, credit: 0 });
  return lines;
}
