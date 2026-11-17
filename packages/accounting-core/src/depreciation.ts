import { MoneyError } from './money.js';
import { addMonthsToMonthStart, fiscalYearOf, type IsoDate } from './periods.js';

/**
 * 유형·무형자산 감가상각(월할).
 *  정액법  (취득가 − 잔존가치) ÷ 내용연수
 *  정률법  기초 장부가 × 상각률(법인세법 상각률표)
 * 취득한 달부터 월할로 상각하고, 내용연수의 마지막 달에 남은 금액을 모두 상각해
 * 장부가를 하한(잔존가치와 비망가액 중 큰 값)에 맞춘다.
 */

export const DEPRECIATION_METHODS = ['straight_line', 'declining_balance'] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line: '정액법',
  declining_balance: '정률법',
};

/** 상각이 끝나도 장부에 남겨 두는 금액(비망가액) */
export const MEMO_VALUE = 1_000;

export interface DepreciationInput {
  method: DepreciationMethod;
  cost: number;
  residualValue?: number;
  usefulLifeYears: number;
  acquisitionDate: IsoDate;
  /** 회계연도 시작월(정률법의 연 단위 계산 기준, 기본 1월) */
  fiscalYearStartMonth?: number;
  memoValue?: number;
}

export interface DepreciationMonth {
  /** YYYY-MM */
  month: string;
  amount: number;
  accumulated: number;
  bookValue: number;
}

/**
 * 정률법 상각률: 1 − 0.05^(1/내용연수) 를 소수 셋째 자리까지 올림한 값
 * (법인세법 시행규칙 상각률표와 같다: 4년 0.528, 5년 0.451, 10년 0.259)
 */
export function decliningBalanceRate(usefulLifeYears: number): number {
  const raw = (1 - 0.05 ** (1 / usefulLifeYears)) * 1000;
  // 부동소수 오차로 정수가 살짝 넘치는 경우를 올림하지 않도록 아주 작은 값을 뺀다
  return Math.ceil(raw - 1e-9) / 1000;
}

function validate(input: DepreciationInput) {
  const { cost, usefulLifeYears } = input;
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    throw new MoneyError('취득가액은 0보다 큰 원 단위 정수여야 합니다.');
  }
  const residual = input.residualValue ?? 0;
  if (!Number.isSafeInteger(residual) || residual < 0 || residual >= cost) {
    throw new MoneyError('잔존가치는 0 이상, 취득가액 미만이어야 합니다.');
  }
  if (!Number.isInteger(usefulLifeYears) || usefulLifeYears < 1 || usefulLifeYears > 60) {
    throw new MoneyError('내용연수는 1~60년입니다.');
  }
}

/** 장부가 하한: 잔존가치와 비망가액(취득가를 넘지 않게) 중 큰 값 */
export function bookValueFloor(input: DepreciationInput): number {
  return Math.max(input.residualValue ?? 0, Math.min(input.memoValue ?? MEMO_VALUE, input.cost));
}

/** 월별 감가상각 일정(내용연수 전체) */
export function depreciationSchedule(input: DepreciationInput): DepreciationMonth[] {
  validate(input);
  const lifeMonths = input.usefulLifeYears * 12;
  const floor = bookValueFloor(input);
  const start = addMonthsToMonthStart(input.acquisitionDate, 0);
  const months = Array.from({ length: lifeMonths }, (_, i) =>
    addMonthsToMonthStart(start, i).slice(0, 7),
  );

  // 달마다 "그때까지의 누계"를 정하고 그 차이를 당월 상각액으로 한다(반올림 오차가 쌓이지 않는다)
  const accumulatedAt: number[] = new Array(lifeMonths).fill(0);
  if (input.method === 'straight_line') {
    const depreciable = input.cost - floor;
    for (let i = 0; i < lifeMonths; i++) {
      accumulatedAt[i] = Math.floor((depreciable * (i + 1)) / lifeMonths);
    }
  } else {
    const rate = decliningBalanceRate(input.usefulLifeYears);
    const startMonth = input.fiscalYearStartMonth ?? 1;
    let accumulated = 0;
    let i = 0;
    while (i < lifeMonths) {
      // 이 회계연도 안에 들어가는 달들
      const year = fiscalYearOf(`${months[i]}-01`, startMonth);
      const inYear: number[] = [];
      while (i < lifeMonths && `${months[i]}-01` <= year.endDate) inYear.push(i++);
      const opening = input.cost - accumulated;
      const annual = Math.floor(opening * rate);
      const yearAmount = Math.floor((annual * inYear.length) / 12);
      inYear.forEach((m, k) => {
        accumulatedAt[m] = accumulated + Math.floor((yearAmount * (k + 1)) / inYear.length);
      });
      accumulated += yearAmount;
    }
  }
  // 마지막 달에 하한까지 모두 상각하고, 어떤 달도 하한 아래로 내려가지 않게 한다
  const maxAccumulated = input.cost - floor;
  accumulatedAt[lifeMonths - 1] = maxAccumulated;
  let previous = 0;
  return months.map((month, i) => {
    const accumulated = Math.min(accumulatedAt[i]!, maxAccumulated);
    const amount = accumulated - previous;
    previous = accumulated;
    return { month, amount, accumulated, bookValue: input.cost - accumulated };
  });
}

/** 그 달(YYYY-MM)까지의 상각누계액(취득 전이면 0, 내용연수가 지나면 최종 누계) */
export function accumulatedDepreciation(input: DepreciationInput, month: string): number {
  const schedule = depreciationSchedule(input);
  let accumulated = 0;
  for (const m of schedule) {
    if (m.month > month) break;
    accumulated = m.accumulated;
  }
  return accumulated;
}

/**
 * 처분손익: 처분가액 − 처분 시 장부가(취득가 − 누계액).
 * + 면 유형자산처분이익, − 면 유형자산처분손실.
 */
export function disposalProfit(cost: number, accumulated: number, proceeds: number): number {
  return proceeds - (cost - accumulated);
}
