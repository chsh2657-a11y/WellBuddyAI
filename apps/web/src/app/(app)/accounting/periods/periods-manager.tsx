'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate, formatWon, todayIso } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { OpeningBalancesEditor } from './opening-balances-editor';

export interface Period {
  id: string;
  periodNo: number;
  startDate: string;
  endDate: string;
  isLocked: boolean;
  lockedAt: string | null;
  lockedByName: string | null;
  counts: { draft: number; pending: number; posted: number };
}

export interface FiscalYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  carriedForwardAt: string | null;
  opening: { entryId: string; totalAmount: number } | null;
  periods: Period[];
}

export const FISCAL_YEARS_KEY = ['fiscal-years'];

export function PeriodsManager() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const canUnlock = session?.role === 'owner' || session?.role === 'admin';
  const queryClient = useQueryClient();
  const years = useQuery({
    queryKey: FISCAL_YEARS_KEY,
    queryFn: () => apiFetch<FiscalYear[]>('/fiscal-years'),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = todayIso();
  const year =
    years.data?.find((y) => y.id === selectedId) ??
    years.data?.find((y) => y.startDate <= today && today <= y.endDate) ??
    years.data?.[0];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: FISCAL_YEARS_KEY });
    // 첫 달 마감 여부가 기초잔액 편집 가능 여부를 정한다
    void queryClient.invalidateQueries({ queryKey: ['opening-balances'] });
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

  const lock = useMutation({
    mutationFn: (p: Period) =>
      apiFetch<{ locked: number }>(`/accounting-periods/${p.id}/lock`, { method: 'POST' }),
    onSuccess: (r, p) => {
      refresh();
      toast.success(`${p.endDate.slice(0, 7)}까지 마감했습니다(${r.locked}개 기간).`);
    },
    onError,
  });
  const unlock = useMutation({
    mutationFn: (p: Period) =>
      apiFetch<{ unlocked: number }>(`/accounting-periods/${p.id}/unlock`, { method: 'POST' }),
    onSuccess: (r, p) => {
      refresh();
      toast.success(`${p.startDate.slice(0, 7)}부터 마감을 해제했습니다(${r.unlocked}개 기간).`);
    },
    onError,
  });
  const carry = useMutation({
    mutationFn: (y: FiscalYear) =>
      apiFetch<{ nextFiscalYearId: string; lines: number; netIncome: number }>(
        `/fiscal-years/${y.id}/carry-forward`,
        { method: 'POST' },
      ),
    onSuccess: (r) => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['opening-balances', r.nextFiscalYearId] });
      toast.success(
        `다음 연도 기초잔액으로 이월했습니다(당기순이익 ${formatWon(r.netIncome)}원 포함).`,
      );
    },
    onError,
  });

  if (!year) return null;
  // 마감은 앞에서부터 이어지므로 "여기까지 마감"은 열린 기간에, "여기부터 해제"는 마감된 기간에 둔다
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start gap-3">
          <div className="grid gap-1">
            <CardTitle>회계기간·마감</CardTitle>
            <CardDescription>
              마감한 달에는 전표를 입력·수정·삭제할 수 없습니다. 해제는 대표·관리자만 할 수
              있습니다.
            </CardDescription>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              aria-label="회계연도"
              className="w-40"
              value={year.id}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {years.data?.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label} 회계연도
                </option>
              ))}
            </Select>
            {writable ? (
              <Button
                variant="outline"
                size="sm"
                disabled={carry.isPending}
                onClick={() =>
                  confirm(
                    `${year.label} 회계연도 말 잔액을 다음 연도 기초잔액으로 이월할까요?\n이미 이월했다면 새 잔액으로 덮어씁니다.`,
                  ) && carry.mutate(year)
                }
              >
                <ArrowRightLeft />
                다음 연도로 전기이월
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <p className="px-5 pb-3 text-xs text-muted-foreground">
            {year.startDate} ~ {year.endDate}
            {year.carriedForwardAt
              ? ` · 전기이월 ${formatDate(year.carriedForwardAt)}`
              : ' · 아직 전기이월하지 않음'}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 pl-5">기간</TableHead>
                <TableHead>날짜</TableHead>
                <TableHead className="w-20 text-right">작성중</TableHead>
                <TableHead className="w-20 text-right">승인요청</TableHead>
                <TableHead className="w-20 text-right">전기</TableHead>
                <TableHead className="w-44">상태</TableHead>
                <TableHead className="w-36 pr-5 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {year.periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-5 font-medium">{p.startDate.slice(0, 7)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.startDate} ~ {p.endDate}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.counts.draft || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.counts.pending || ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.counts.posted || ''}</TableCell>
                  <TableCell>
                    {p.isLocked ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant="muted" className="gap-1">
                          <Lock className="size-3" />
                          마감
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {p.lockedByName ?? ''}
                        </span>
                      </span>
                    ) : (
                      <Badge variant="success">열림</Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {!p.isLocked && writable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${p.startDate.slice(0, 7)}까지 마감`}
                        disabled={lock.isPending}
                        onClick={() =>
                          confirm(
                            `${p.endDate.slice(0, 7)}까지(이전의 열린 달 포함) 마감할까요?`,
                          ) && lock.mutate(p)
                        }
                      >
                        <Lock />
                        여기까지 마감
                      </Button>
                    ) : null}
                    {p.isLocked && canUnlock ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${p.startDate.slice(0, 7)}부터 마감 해제`}
                        disabled={unlock.isPending}
                        onClick={() =>
                          confirm(
                            `${p.startDate.slice(0, 7)}부터(이후의 마감된 달 포함) 마감을 해제할까요?`,
                          ) && unlock.mutate(p)
                        }
                      >
                        <LockOpen />
                        여기부터 해제
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <OpeningBalancesEditor year={year} writable={writable} onSaved={refresh} />
    </div>
  );
}
