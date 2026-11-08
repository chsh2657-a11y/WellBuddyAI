import { currencyUnit, parseForeign, parseRate, toKrw } from '@wellbuddy/accounting-core';
import type { GridLine } from './types';

/** 환율 표시: "1385.2000" → "1385.2" */
export function trimRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate;
}

/** 외화 × 환율로 원화 금액(원 미만 반올림)을 구한다. 입력이 덜 됐으면 null */
export function foreignKrw(line: Pick<GridLine, 'currency' | 'foreignAmount' | 'exchangeRate'>) {
  if (!line.currency) return null;
  const amount = parseForeign(line.foreignAmount);
  const rate = parseRate(line.exchangeRate);
  if (amount === null || rate === null || Number(amount) <= 0) return null;
  return toKrw(amount, rate, currencyUnit(line.currency));
}

/** 외화 줄이면 원화 금액을 외화 × 환율로 맞춘다(대변에 금액이 있으면 대변, 아니면 차변) */
export function applyForeign(line: GridLine): GridLine {
  const krw = foreignKrw(line);
  if (krw === null) return line;
  return line.credit > 0 ? { ...line, credit: krw, debit: 0 } : { ...line, debit: krw, credit: 0 };
}
