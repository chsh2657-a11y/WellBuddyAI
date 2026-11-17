'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addMonthsToMonthStart, DEPRECIATION_METHOD_LABELS } from '@wellbuddy/accounting-core';
import { CalendarClock, Play, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { formatWon, todayIso } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { DisposeDialog, ScheduleDialog } from './asset-dialogs';
import { AssetFormDialog } from './asset-form-dialog';
import { ASSETS_KEY, type DepreciationRun, type FixedAsset, RUNS_KEY } from './types';

export function FixedAssetsManager() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const queryClient = useQueryClient();
  const assets = useQuery({
    queryKey: ASSETS_KEY,
    queryFn: () => apiFetch<FixedAsset[]>('/fixed-assets'),
  });
  const runs = useQuery({
    queryKey: RUNS_KEY,
    queryFn: () => apiFetch<DepreciationRun[]>('/depreciation-runs'),
  });
  const [scheduleOf, setScheduleOf] = useState<FixedAsset | null>(null);
  const [disposeOf, setDisposeOf] = useState<FixedAsset | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  const latest = runs.data?.[0];
  // 기본값: 마지막 실행 다음 달, 처음이면 이번 달
  const nextMonth = latest
    ? addMonthsToMonthStart(`${latest.month}-01`, 1).slice(0, 7)
    : todayIso().slice(0, 7);
  const selectedMonth = month ?? nextMonth;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ASSETS_KEY });
    void queryClient.invalidateQueries({ queryKey: RUNS_KEY });
    // 원장·보고서·전표 목록도 바뀐다
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

  const run = useMutation({
    mutationFn: (m: string) =>
      apiFetch<{ month: string; totalAmount: number; assets: number }>('/depreciation-runs', {
        method: 'POST',
        json: { month: m },
      }),
    onSuccess: (r) => {
      setMonth(null);
      refresh();
      toast.success(
        r.totalAmount > 0
          ? `${r.month} 감가상각 ${formatWon(r.totalAmount)}원(${r.assets}건)을 전기했습니다.`
          : `${r.month}에는 상각할 자산이 없어 전표 없이 실행만 기록했습니다.`,
      );
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (m: string) => apiFetch(`/depreciation-runs/${m}`, { method: 'DELETE' }),
    onSuccess: (_r, m) => {
      refresh();
      toast.success(`${m} 감가상각을 취소했습니다(역분개).`);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/fixed-assets/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  const active = assets.data?.filter((a) => !a.disposedOn) ?? [];
  const totals = {
    cost: active.reduce((s, a) => s + a.cost, 0),
    accumulated: active.reduce((s, a) => s + a.accumulated, 0),
    bookValue: active.reduce((s, a) => s + a.bookValue, 0),
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start gap-3">
          <div className="grid gap-1">
            <CardTitle>월 감가상각</CardTitle>
            <CardDescription>
              달마다 한 번 실행하면 자산별 상각액을 계산해 전표 한 장으로 전기합니다. 건너뛴 달은
              다음 실행에서 함께 반영하고, 취소는 마지막 실행만 할 수 있습니다.
            </CardDescription>
          </div>
          {writable ? (
            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run.mutate(selectedMonth);
              }}
            >
              <Input
                type="month"
                aria-label="상각할 달"
                className="w-40"
                value={selectedMonth}
                onChange={(e) => setMonth(e.target.value)}
                required
              />
              <Button type="submit" size="sm" disabled={run.isPending}>
                <Play />
                상각 실행
              </Button>
            </form>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 pl-5">월</TableHead>
                <TableHead className="text-right">상각액</TableHead>
                <TableHead>전표</TableHead>
                <TableHead className="w-32 pr-5 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-5 font-medium tabular-nums">{r.month}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatWon(r.totalAmount)}
                  </TableCell>
                  <TableCell>
                    {r.entryId ? (
                      <Link
                        href={`/accounting/journals/${r.entryId}`}
                        className="text-primary tabular-nums hover:underline"
                      >
                        {r.entryNumber}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">상각할 자산 없음</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {writable && r.id === latest?.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${r.month} 상각 취소`}
                        disabled={cancel.isPending}
                        onClick={() =>
                          confirm(`${r.month} 감가상각을 취소할까요? 전표는 역분개합니다.`) &&
                          cancel.mutate(r.month)
                        }
                      >
                        <Undo2 />
                        취소
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {runs.data?.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">아직 실행한 달이 없습니다.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start gap-3">
          <div className="grid gap-1">
            <CardTitle>고정자산 대장</CardTitle>
            <CardDescription>
              정액법·정률법, 취득한 달부터 월할 상각합니다. 내용연수가 끝나면 비망가액 1,000원(또는
              잔존가치)을 남깁니다.
            </CardDescription>
          </div>
          {writable ? (
            <div className="ml-auto">
              <AssetFormDialog onSaved={refresh} />
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24 pl-5">코드</TableHead>
                  <TableHead>자산명</TableHead>
                  <TableHead>계정</TableHead>
                  <TableHead>취득일</TableHead>
                  <TableHead>상각</TableHead>
                  <TableHead className="text-right">취득가액</TableHead>
                  <TableHead className="text-right">상각누계액</TableHead>
                  <TableHead className="text-right">장부가액</TableHead>
                  <TableHead className="w-48 pr-5 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.data?.map((a) => (
                  <TableRow key={a.id} className={a.disposedOn ? 'text-muted-foreground' : ''}>
                    <TableCell className="pl-5 tabular-nums">{a.code}</TableCell>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        {a.name}
                        {a.departmentName ? (
                          <Badge variant="muted">{a.departmentName}</Badge>
                        ) : null}
                        {a.disposedOn ? <Badge variant="warning">처분 {a.disposedOn}</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{a.assetAccountName}</TableCell>
                    <TableCell className="text-xs tabular-nums">{a.acquisitionDate}</TableCell>
                    <TableCell className="text-xs">
                      {DEPRECIATION_METHOD_LABELS[a.method]} {a.usefulLifeYears}년
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatWon(a.cost)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatWon(a.accumulated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.disposedOn ? '' : formatWon(a.bookValue)}
                    </TableCell>
                    <TableCell className="pr-5 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${a.name} 상각 일정`}
                        onClick={() => setScheduleOf(a)}
                      >
                        <CalendarClock />
                        일정
                      </Button>
                      {writable && !a.disposedOn ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${a.name} 처분`}
                          onClick={() => setDisposeOf(a)}
                        >
                          처분
                        </Button>
                      ) : null}
                      {writable && !a.locked ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${a.name} 삭제`}
                          onClick={() =>
                            confirm(`'${a.name}'을(를) 삭제할까요?`) && remove.mutate(a.id)
                          }
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {active.length > 0 ? (
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-5" colSpan={5}>
                      보유 자산 합계 {active.length}건
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatWon(totals.cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatWon(totals.accumulated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatWon(totals.bookValue)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
          {assets.data?.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">등록된 고정자산이 없습니다.</p>
          ) : null}
        </CardContent>
      </Card>

      {scheduleOf ? (
        <ScheduleDialog asset={scheduleOf} onOpenChange={(o) => !o && setScheduleOf(null)} />
      ) : null}
      {disposeOf ? (
        <DisposeDialog
          asset={disposeOf}
          onOpenChange={(o) => !o && setDisposeOf(null)}
          onDone={refresh}
        />
      ) : null}
    </div>
  );
}
