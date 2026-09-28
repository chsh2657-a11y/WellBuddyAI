/** 회사 구성원 역할. 권한 기본값은 permissions.ts 에서 역할별로 정의한다. */
export const ROLES = ['owner', 'admin', 'accountant', 'approver', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: '대표 관리자',
  admin: '관리자',
  accountant: '경리',
  approver: '결재자',
  employee: '일반 사원',
};

export const MEMBER_STATUSES = ['active', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
