'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';

interface FiscalYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

/** 오늘이 속한 회계연도(없으면 올해 1~12월) */
export function useCurrentFiscalYear() {
  const today = todayIso();
  const years = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: () => apiFetch<FiscalYear[]>('/fiscal-years'),
  });
  const year = years.data?.find((y) => y.startDate <= today && today <= y.endDate);
  return {
    ready: years.isSuccess || years.isError,
    startDate: year?.startDate ?? `${today.slice(0, 4)}-01-01`,
    endDate: year?.endDate ?? `${today.slice(0, 4)}-12-31`,
    today,
  };
}

/** 이번 달 1일 ~ 말일 */
export function currentMonthRange(today = todayIso()) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = today.slice(0, 7);
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** 보고서 부제: 회사명 · 기간 */
export function useSubtitle(period: string) {
  const { data: session } = useSession();
  return [session?.company?.name, period].filter(Boolean).join(' · ');
}

/** GET /reports/... (조건이 준비되지 않았으면 호출하지 않는다) */
export function useReport<T>(
  path: string,
  params: Record<string, string | undefined>,
  enabled = true,
) {
  const search = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (v ? [[k, v]] : [])),
  ).toString();
  return useQuery({
    queryKey: ['reports', path, search],
    queryFn: () => apiFetch<T>(`/reports/${path}?${search}`),
    enabled,
    retry: false,
    // 전표를 전기한 뒤 바로 다시 열어도 최신 금액을 보여 준다
    staleTime: 0,
  });
}
