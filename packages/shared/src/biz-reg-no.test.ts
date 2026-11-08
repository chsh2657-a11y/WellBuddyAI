import { describe, expect, it } from 'vitest';
import { formatBizRegNo, isValidBizRegNo, normalizeBizRegNo } from './biz-reg-no.js';

describe('사업자등록번호', () => {
  it('체크디지트가 맞는 번호를 통과시킨다', () => {
    expect(isValidBizRegNo('124-81-00998')).toBe(true);
    expect(isValidBizRegNo('1248100998')).toBe(true);
  });

  it('체크디지트가 틀린 번호를 거부한다', () => {
    expect(isValidBizRegNo('124-81-00997')).toBe(false);
    expect(isValidBizRegNo('123-45-67890')).toBe(false);
  });

  it('10자리 숫자가 아니면 거부한다', () => {
    expect(isValidBizRegNo('')).toBe(false);
    expect(isValidBizRegNo('124-81-0099')).toBe(false);
    expect(isValidBizRegNo('124-81-0099a')).toBe(false);
  });

  it('하이픈을 정규화하고 표시 형식으로 바꾼다', () => {
    expect(normalizeBizRegNo('124-81-00998')).toBe('1248100998');
    expect(formatBizRegNo('1248100998')).toBe('124-81-00998');
    expect(formatBizRegNo('abc')).toBe('abc');
  });
});
