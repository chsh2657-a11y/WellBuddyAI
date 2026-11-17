'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ComboItem } from '@/components/combobox';
import { apiFetch } from '@/lib/api';
import type { Account } from '../../accounts/accounts-manager';
import type { Partner } from '../../partners/partners-manager';

export interface Dimension {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** 전표 입력에 쓰는 기초정보(사용 중인 것만) */
export function useMasterData() {
  const accounts = useQuery({
    queryKey: ['accounts', { includeInactive: false }],
    queryFn: () => apiFetch<Account[]>('/accounts?includeInactive=false'),
  });
  const partners = useQuery({
    queryKey: ['partners', 'active'],
    queryFn: () => apiFetch<Partner[]>('/partners'),
  });
  const departments = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => apiFetch<Dimension[]>('/departments'),
  });
  const projects = useQuery({
    queryKey: ['projects', 'active'],
    queryFn: () => apiFetch<Dimension[]>('/projects'),
  });

  return useMemo(() => {
    const accountList = accounts.data ?? [];
    const partnerList = partners.data ?? [];
    return {
      ready: accounts.isSuccess && partners.isSuccess,
      accounts: accountList,
      accountById: new Map(accountList.map((a) => [a.id, a])),
      accountByCode: new Map(accountList.map((a) => [a.code, a])),
      accountItems: accountList.map<ComboItem>((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        hint: a.requiresPartner ? '거래처' : undefined,
      })),
      partnerItems: partnerList.map<ComboItem>((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        hint: p.bizRegNo ?? undefined,
      })),
      departmentItems: (departments.data ?? []).map<ComboItem>((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
      })),
      projectItems: (projects.data ?? []).map<ComboItem>((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
      })),
    };
  }, [
    accounts.data,
    accounts.isSuccess,
    partners.data,
    partners.isSuccess,
    departments.data,
    projects.data,
  ]);
}

export type MasterData = ReturnType<typeof useMasterData>;
