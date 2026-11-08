const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const LARGE = ['', '만', '억', '조', '경'];

/**
 * 금액을 한글로(견적서·거래명세서의 "일금 …원정").
 * 서식 문서 관례대로 십·백·천 앞의 일도 쓴다: 184,800 → 일십팔만사천팔백
 */
export function koreanNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('0 이상의 정수만 바꿀 수 있습니다.');
  if (value === 0) return '영';
  const groups: string[] = [];
  let rest = value;
  for (let g = 0; rest > 0; g++) {
    const chunk = rest % 10_000;
    rest = Math.floor(rest / 10_000);
    if (chunk === 0) continue;
    let words = '';
    const digits = String(chunk).padStart(4, '0');
    for (let i = 0; i < 4; i++) {
      const d = Number(digits[i]);
      if (d) words += `${DIGITS[d]}${SMALL[3 - i]}`;
    }
    groups.unshift(words + LARGE[g]);
  }
  return groups.join('');
}

/** 일금 일십팔만사천팔백원정 */
export const wonInWords = (value: number) => `일금 ${koreanNumber(value)}원정`;
