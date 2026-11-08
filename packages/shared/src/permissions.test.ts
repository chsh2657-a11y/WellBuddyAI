import { describe, expect, it } from 'vitest';
import { hasPermission, resolvePermissions } from './permissions.js';

describe('권한 계산', () => {
  it('역할 기본값을 쓴다', () => {
    const p = resolvePermissions('employee');
    expect(p.approval).toBe('write');
    expect(p.accounting).toBe('none');
    expect(p['settings.users']).toBe('none');
  });

  it('회사별 재정의를 덮어쓰고, 알 수 없는 키나 값은 무시한다', () => {
    const p = resolvePermissions('employee', {
      accounting: 'read',
      unknown: 'write',
      payroll: 'admin' as never,
    });
    expect(p.accounting).toBe('read');
    expect(p.payroll).toBe('none');
    expect('unknown' in p).toBe(false);
  });

  it('대표 관리자 권한은 재정의로 줄일 수 없다', () => {
    const p = resolvePermissions('owner', { 'settings.users': 'none' });
    expect(p['settings.users']).toBe('write');
  });

  it('write 는 read 를 포함한다', () => {
    const p = resolvePermissions('accountant');
    expect(hasPermission(p, 'accounting', 'read')).toBe(true);
    expect(hasPermission(p, 'accounting', 'write')).toBe(true);
    expect(hasPermission(p, 'settings.company', 'write')).toBe(false);
    expect(hasPermission(p, 'settings.users', 'read')).toBe(false);
  });
});
