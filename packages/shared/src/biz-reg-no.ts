import { isValidBizNo } from '@wellbuddy/accounting-core';

/** 하이픈·공백을 제거한 사업자등록번호 숫자열. */
export function normalizeBizRegNo(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/** 하이픈·공백 외의 문자가 없는 10자리이고 국세청 검증 공식(accounting-core)을 통과하는지 검증한다. */
export function isValidBizRegNo(value: string): boolean {
  return /^\d{10}$/.test(normalizeBizRegNo(value)) && isValidBizNo(value);
}

/** 123-45-67890 형태로 표시한다. 형식이 맞지 않으면 입력값을 그대로 돌려준다. */
export function formatBizRegNo(value: string): string {
  const digits = normalizeBizRegNo(value);
  if (!/^\d{10}$/.test(digits)) return value;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
