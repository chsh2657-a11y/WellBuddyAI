/**
 * 사업자등록번호(10자리) 검증(화면 입력 검증은 shared 의 isValidBizRegNo 가 이 공식을 쓴다). 국세청 공식: 앞 9자리에 1,3,7,1,3,7,1,3,5 를 곱해 더하고
 * 9번째 자리×5 의 십의 자리를 더한 합으로 마지막 검증번호를 정한다.
 */
const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

/** 숫자만 남긴다(123-45-67890 → 1234567890). 10자리가 아니면 null */
export function normalizeBizNo(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 10 ? digits : null;
}

/** 앞 9자리로 검증번호(마지막 자리)를 구한다 */
export function bizNoCheckDigit(first9: string): number {
  if (!/^\d{9}$/.test(first9)) throw new Error('사업자번호 앞 9자리는 숫자여야 합니다.');
  const nums = [...first9].map(Number);
  const sum = WEIGHTS.reduce((s, w, i) => s + nums[i]! * w, 0) + Math.floor((nums[8]! * 5) / 10);
  return (10 - (sum % 10)) % 10;
}

/** 형식(숫자 10자리)과 검증번호가 맞는지 */
export function isValidBizNo(value: string | null | undefined): boolean {
  const n = normalizeBizNo(value);
  return n !== null && bizNoCheckDigit(n.slice(0, 9)) === Number(n[9]);
}
