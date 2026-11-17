/**
 * 원화 금액은 원 단위 정수로만 다룬다(부동소수점 오차 방지).
 * JavaScript 의 안전한 정수 범위(약 9,007조 원)를 넘으면 오류로 본다.
 */
export class MoneyError extends Error {}

export function isWon(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertWon(value: unknown, label = '금액'): number {
  if (!isWon(value)) throw new MoneyError(`${label}은(는) 원 단위 정수여야 합니다.`);
  return value;
}

export function sumWon(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    total += assertWon(v);
    if (!Number.isSafeInteger(total)) throw new MoneyError('합계가 처리 가능한 범위를 넘었습니다.');
  }
  return total;
}

const formatter = new Intl.NumberFormat('ko-KR');

/** 1234567 → "1,234,567" (음수는 "-1,234") */
export function formatWon(value: number): string {
  return formatter.format(value);
}

/** "1,234,567원", " 1 234 " 같은 입력을 정수로 바꾼다. 숫자가 없으면 null. */
export function parseWon(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const negative = /^[-(−]/.test(trimmed);
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits === '') return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}
