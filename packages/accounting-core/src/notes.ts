import { assertWon, MoneyError } from './money.js';
import { daysBetween, type IsoDate } from './periods.js';

/**
 * 어음(받을어음·지급어음) 계산.
 * 할인료 = 액면 × 연 할인율 × 할인일수 ÷ 365 (원 미만 절사)
 * 할인일수는 할인일 다음 날부터 만기일까지(한편넣기)로 센다.
 */

export const NOTE_KINDS = ['receivable', 'payable'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const NOTE_STATUSES = [
  'holding', // 보유(받을어음) · 발행(지급어음)
  'settled', // 만기 결제
  'discounted', // 할인
  'endorsed', // 배서양도
  'dishonored', // 부도
] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  holding: '보유',
  settled: '결제',
  discounted: '할인',
  endorsed: '배서',
  dishonored: '부도',
};

export const NOTE_ACCOUNTS = {
  receivable: '110',
  payable: '252',
  /** 어음 할인료(매각거래) */
  discountLoss: '956',
  /** 부도어음과수표 */
  dishonored: '246',
} as const;

export function discountCharge(input: {
  faceAmount: number;
  annualRatePercent: number;
  discountDate: IsoDate;
  maturityDate: IsoDate;
}): { days: number; charge: number; proceeds: number } {
  assertWon(input.faceAmount, '액면금액');
  if (input.faceAmount <= 0) throw new MoneyError('액면금액은 0보다 커야 합니다.');
  if (!(input.annualRatePercent >= 0 && input.annualRatePercent <= 100)) {
    throw new MoneyError('할인율은 0~100% 입니다.');
  }
  const days = daysBetween(input.discountDate, input.maturityDate);
  if (days < 0) throw new MoneyError('만기일이 지난 어음은 할인할 수 없습니다.');
  // 정수 연산으로 계산(할인율은 소수 둘째 자리까지 → 10,000 배)
  const rateBp = Math.round(input.annualRatePercent * 100);
  const charge = Number(
    (BigInt(input.faceAmount) * BigInt(rateBp) * BigInt(days)) / (10_000n * 365n),
  );
  return { days, charge, proceeds: input.faceAmount - charge };
}
