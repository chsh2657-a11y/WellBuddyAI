'use client';

import {
  hasPermission,
  isModuleEnabled,
  type ModuleKey,
  type PermissionKey,
  type PermissionLevel,
  type Session,
} from '@wellbuddy/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

export const SESSION_KEY = ['session'] as const;

export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: () => apiFetch<Session>('/auth/me') });
}

export function useRefreshSession() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: SESSION_KEY });
}

/** 세션 권한에서 메뉴·기능 접근 가능 여부를 판단한다(API 의 PermissionGuard 와 같은 규칙). */
export function can(
  session: Session | undefined,
  key: PermissionKey,
  level: PermissionLevel = 'read',
): boolean {
  return hasPermission(session?.permissions, key, level);
}

export function moduleVisible(session: Session | undefined, key: ModuleKey): boolean {
  return isModuleEnabled(key, session?.enabledModules) && can(session, key, 'read');
}
