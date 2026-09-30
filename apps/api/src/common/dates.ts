/** 한국 시간 기준 오늘(YYYY-MM-DD). 전표 날짜 기본값 등에 쓴다. */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
