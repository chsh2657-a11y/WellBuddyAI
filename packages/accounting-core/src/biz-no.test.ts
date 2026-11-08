import { describe, expect, it } from 'vitest';
import { bizNoCheckDigit, isValidBizNo, normalizeBizNo } from './biz-no.js';

describe('사업자등록번호', () => {
  it('검증번호를 국세청 공식으로 구한다', () => {
    expect(bizNoCheckDigit('124810099')).toBe(8);
    // 9번째 자리×5 의 십의 자리까지 더한다
    expect(bizNoCheckDigit('220811234')).toBe(1);
    expect(bizNoCheckDigit('000000000')).toBe(0);
    expect(() => bizNoCheckDigit('12345678')).toThrow();
  });

  it('형식과 검증번호가 맞아야 올바른 번호다', () => {
    expect(isValidBizNo('1248100998')).toBe(true);
    expect(isValidBizNo('124-81-00998')).toBe(true);
    expect(isValidBizNo('1248100997')).toBe(false);
    expect(isValidBizNo('124810099')).toBe(false);
    expect(isValidBizNo(null)).toBe(false);
    expect(isValidBizNo('')).toBe(false);
  });

  it('OCR 이 읽은 표기에서 숫자 10자리만 남긴다', () => {
    expect(normalizeBizNo(' 124-81-00998 ')).toBe('1248100998');
    expect(normalizeBizNo('사업자 124 81 00998')).toBe('1248100998');
    expect(normalizeBizNo('12481009')).toBeNull();
  });
});
