const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;

/** 하이픈·공백을 제거한 사업자등록번호 숫자열. */
export function normalizeBizRegNo(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/** 국세청 사업자등록번호 검증 공식(가중치 합 + 체크디지트)으로 형식을 검증한다. */
export function isValidBizRegNo(value: string): boolean {
  const digits = normalizeBizRegNo(value);
  if (!/^\d{10}$/.test(digits)) return false;

  const nums = [...digits].map(Number);
  let sum = 0;
  WEIGHTS.forEach((weight, i) => {
    sum += nums[i]! * weight;
  });
  sum += Math.floor((nums[8]! * 5) / 10);
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === nums[9];
}

/** 123-45-67890 형태로 표시한다. 형식이 맞지 않으면 입력값을 그대로 돌려준다. */
export function formatBizRegNo(value: string): string {
  const digits = normalizeBizRegNo(value);
  if (!/^\d{10}$/.test(digits)) return value;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
