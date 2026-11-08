import { describe, expect, it } from 'vitest';
import { isModuleEnabled } from './modules.js';

describe('모듈 사용 여부', () => {
  it('설정이 없으면 켜진 것으로 본다', () => {
    expect(isModuleEnabled('accounting', undefined)).toBe(true);
    expect(isModuleEnabled('accounting', {})).toBe(true);
  });

  it('회사 설정으로 끌 수 있다', () => {
    expect(isModuleEnabled('accounting', { accounting: false })).toBe(false);
  });

  it('필수 모듈(대시보드·설정)은 끌 수 없다', () => {
    expect(isModuleEnabled('settings', { settings: false })).toBe(true);
    expect(isModuleEnabled('dashboard', { dashboard: false })).toBe(true);
  });
});
