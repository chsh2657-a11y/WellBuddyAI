import { describe, expect, it } from 'vitest';
import { koreanNumber, wonInWords } from './korean-number';

describe('금액 한글 표기', () => {
  it('서식 문서 관례(일십·일백·일천)로 쓴다', () => {
    expect(koreanNumber(0)).toBe('영');
    expect(koreanNumber(7)).toBe('칠');
    expect(koreanNumber(10)).toBe('일십');
    expect(koreanNumber(184_800)).toBe('일십팔만사천팔백');
    expect(koreanNumber(1_000_000)).toBe('일백만');
    expect(koreanNumber(100_000_001)).toBe('일억일');
    expect(koreanNumber(1_234_567_890)).toBe('일십이억삼천사백오십육만칠천팔백구십');
    expect(wonInWords(55_000)).toBe('일금 오만오천원정');
  });

  it('음수·소수는 거부한다', () => {
    expect(() => koreanNumber(-1)).toThrow();
    expect(() => koreanNumber(1.5)).toThrow();
  });
});
