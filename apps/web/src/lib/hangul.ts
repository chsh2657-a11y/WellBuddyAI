// prettier-ignore
const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** "현금" → "ㅎㄱ" (한글이 아닌 글자는 그대로) */
export function chosungOf(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out +=
      code >= HANGUL_START && code <= HANGUL_END
        ? CHOSUNG[Math.floor((code - HANGUL_START) / 588)]
        : ch;
  }
  return out;
}

const ONLY_CHOSUNG = /^[ㄱ-ㅎ]+$/;

/**
 * 검색어가 이름에 맞는지: 그대로 포함하거나, 초성만 친 경우 초성이 포함되면 맞다.
 * 대소문자·공백은 무시한다.
 */
export function matchesKorean(name: string, query: string): boolean {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return true;
  const n = name.replace(/\s+/g, '').toLowerCase();
  if (n.includes(q)) return true;
  return ONLY_CHOSUNG.test(q) && chosungOf(n).includes(q);
}
