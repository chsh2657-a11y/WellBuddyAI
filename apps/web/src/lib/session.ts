'use client';

import type { ModuleKey, PermissionLevel, Session } from '@wellbuddy/shared';
import { isModuleEnabled } from '@wellbuddy/shared';
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

const LEVEL_ORDER: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2 };

/** 세션 권한에서 메뉴·기능 접근 가능 여부를 판단한다(API 도 같은 규칙으로 검사). */
export function can(session: Session | undefined, key: string, level: PermissionLevel = 'read') {
  const granted = session?.permissions[key] ?? 'none';
  return LEVEL_ORDER[granted] >= LEVEL_ORDER[level];
}

export function moduleVisible(session: Session | undefined, key: ModuleKey) {
  return isModuleEnabled(key, session?.enabledModules) && can(session, key, 'read');
}
