import { describe, expect, it } from 'vitest';
import { chosungOf, matchesKorean } from './hangul';

describe('한글 검색', () => {
  it('초성을 뽑는다', () => {
    expect(chosungOf('현금')).toBe('ㅎㄱ');
    expect(chosungOf('외상매출금(A)')).toBe('ㅇㅅㅁㅊㄱ(A)');
  });

  it('이름 포함 또는 초성으로 찾는다', () => {
    expect(matchesKorean('외상매출금', '매출')).toBe(true);
    expect(matchesKorean('외상매출금', 'ㅇㅅㅁ')).toBe(true);
    expect(matchesKorean('보통예금', 'ㅎㄱ')).toBe(false);
    expect(matchesKorean('(주)한빛 상사', '한빛상사')).toBe(true);
    expect(matchesKorean('ABC Corp', 'abc')).toBe(true);
    // 초성과 완성형이 섞이면 초성 검색을 하지 않는다
    expect(matchesKorean('현금', 'ㅎ금')).toBe(false);
  });
});
