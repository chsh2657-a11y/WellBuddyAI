/** 연간 금액을 12개월에 나눈다(나머지는 마지막 달) */
export function spreadAnnual(total: number): number[] {
  const each = Math.floor(total / 12);
  return Array.from({ length: 12 }, (_, i) => (i === 11 ? total - each * 11 : each));
}
