import type { PermissionLevel } from './auth.js';
import type { Role } from './roles.js';

/**
 * 권한 키(메뉴·기능 단위). 각 키는 none(접근 불가) / read(조회) / write(조회+변경) 중 하나를 가진다.
 * API 는 @RequirePermission(key, level) 로, 웹은 can(session, key, level) 로 같은 규칙을 적용한다.
 */
export const PERMISSIONS = [
  { key: 'dashboard', label: '대시보드', group: '공통' },
  { key: 'accounting', label: '회계', group: '업무' },
  { key: 'evidence', label: '증빙·자동분개', group: '업무' },
  { key: 'sales', label: '영업·구매·재고', group: '업무' },
  { key: 'production', label: '생산', group: '업무' },
  { key: 'approval', label: '전자결재', group: '업무' },
  { key: 'hr', label: '인사·그룹웨어', group: '업무' },
  { key: 'attendance', label: '근태', group: '업무' },
  { key: 'payroll', label: '급여', group: '업무' },
  { key: 'tax', label: '부가세·결산', group: '업무' },
  { key: 'settings', label: '설정 메뉴', group: '설정' },
  { key: 'settings.company', label: '회사정보·사업장', group: '설정' },
  { key: 'settings.users', label: '사용자·권한', group: '설정' },
  { key: 'settings.menus', label: '메뉴 사용 여부', group: '설정' },
  { key: 'settings.integrations', label: '연동관리', group: '설정' },
  { key: 'settings.audit', label: '감사로그', group: '설정' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as PermissionKey[];
export type PermissionMap = Record<PermissionKey, PermissionLevel>;

const all = (level: PermissionLevel): PermissionMap =>
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, level])) as PermissionMap;

/** 역할별 기본 권한. 회사는 설정 > 사용자·권한에서 역할별로 바꿀 수 있다(대표 관리자 제외). */
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, PermissionMap> = {
  owner: all('write'),
  admin: all('write'),
  accountant: {
    ...all('none'),
    dashboard: 'read',
    accounting: 'write',
    evidence: 'write',
    sales: 'write',
    production: 'read',
    approval: 'write',
    hr: 'read',
    attendance: 'write',
    payroll: 'write',
    tax: 'write',
    settings: 'read',
    'settings.company': 'read',
    'settings.integrations': 'write',
  },
  approver: {
    ...all('none'),
    dashboard: 'read',
    accounting: 'read',
    evidence: 'read',
    approval: 'write',
    hr: 'read',
    attendance: 'write',
  },
  employee: {
    ...all('none'),
    dashboard: 'read',
    approval: 'write',
    hr: 'read',
    attendance: 'write',
  },
};

/** 역할이 바꿀 수 없는 권한(잠금 방지): 대표 관리자는 항상 모든 권한을 가진다. */
export function isRoleEditable(role: Role): boolean {
  return role !== 'owner';
}

/** 역할 기본값 위에 회사별 재정의를 덮어써 최종 권한을 만든다. 알 수 없는 키는 무시한다. */
export function resolvePermissions(
  role: Role,
  overrides?: Partial<Record<string, PermissionLevel>> | null,
): PermissionMap {
  const base = { ...ROLE_DEFAULT_PERMISSIONS[role] };
  if (!overrides || !isRoleEditable(role)) return base;
  for (const key of PERMISSION_KEYS) {
    const level = overrides[key];
    if (level === 'none' || level === 'read' || level === 'write') base[key] = level;
  }
  return base;
}

const ORDER: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2 };

export function hasPermission(
  permissions: Partial<Record<string, PermissionLevel>> | null | undefined,
  key: PermissionKey,
  level: PermissionLevel = 'read',
): boolean {
  return ORDER[permissions?.[key] ?? 'none'] >= ORDER[level];
}
