import { formatWon } from '@wellbuddy/accounting-core';

export { formatWon };

/** 0 은 빈칸으로 보여 주는 장부 표기 */
export function wonOrBlank(value: number): string {
  return value === 0 ? '' : formatWon(value);
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' });

export function formatDate(value: string | Date): string {
  return dateFormat.format(typeof value === 'string' ? new Date(value) : value);
}

/** 오늘 날짜(YYYY-MM-DD, 한국 시간) */
export function todayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}
