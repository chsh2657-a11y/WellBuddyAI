'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatForeign } from '@wellbuddy/accounting-core';
import { Calculator, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { cn } from '@/lib/utils';
import { trimRate } from '../journals/_components/foreign-calc';

interface Preview {
  date: string;
  fiscalYear: string;
  rows: {
    accountId: string;
    accountCode: string;
    accountName: string;
    partnerId: string | null;
    partnerName: string | null;
    currency: string;
    side: 'asset' | 'liability';
    foreignBalance: string;
    bookKrw: number;
    rate: string | null;
    rateDate: string | null;
    targetKrw: number | null;
    adjustment: number | null;
    profit: number | null;
  }[];
  gain: number;
  loss: number;
  missingCurrencies: string[];
}

interface Revaluation {
  id: string;
  date: string;
  gain: number;
  loss: number;
  entryId: string | null;
  entryNumber: string | null;
  rows: number;
  createdAt: string;
}

const HISTORY_KEY = ['fx-revaluations'];

/** 이달 말일 */
function monthEndOf(date: string) {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

const signed = (v: number) => (v > 0 ? `+${formatWon(v)}` : v < 0 ? `-${formatWon(-v)}` : '0');

/** 기말 외화평가: 평가일 환율로 외화 자산·부채를 다시 환산해 외화환산이익·손실을 전기한다 */
export function RevaluationCard() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => monthEndOf(todayIso()));
  const preview = useQuery({
    queryKey: ['fx-preview', date],
    queryFn: () => apiFetch<Preview>(`/fx-revaluations/preview?date=${date}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 0,
  });
  const history = useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => apiFetch<Revaluation[]>('/fx-revaluations'),
  });
  const latest = history.data?.[0];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['fx-preview'] });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

  const run = useMutation({
    mutationFn: () =>
      apiFetch<{ gain: number; loss: number; entryId: string | null }>('/fx-revaluations', {
        method: 'POST',
        json: { date },
      }),
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.entryId
          ? `${date} 외화평가를 전기했습니다(이익 ${formatWon(r.gain)}원 · 손실 ${formatWon(r.loss)}원).`
          : `${date}에는 평가할 차액이 없어 전표 없이 기록했습니다.`,
      );
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (d: string) => apiFetch(`/fx-revaluations/${d}`, { method: 'DELETE' }),
    onSuccess: (_r, d) => {
      refresh();
      toast.success(`${d} 외화평가를 취소했습니다(역분개).`);
    },
    onError,
  });

  const data = preview.data;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <div className="grid gap-1">
          <CardTitle>기말 외화평가</CardTitle>
          <CardDescription>
            외화예금·외화채권·외화채무를 평가일 환율로 다시 환산해 차액을
            외화환산이익(910)·손실(955)로 전기합니다. 평가일마다 한 번, 날짜 순서대로 실행하고
            취소는 마지막 평가만 할 수 있습니다.
          </CardDescription>
        </div>
        {writable ? (
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            <Input
              type="date"
              aria-label="평가일"
              className="w-40"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
            <Button
              type="submit"
              size="sm"
              disabled={run.isPending || !data || data.missingCurrencies.length > 0}
            >
              <Calculator />
              외화평가 실행
            </Button>
          </form>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4 px-0 pb-2">
        {data?.missingCurrencies.length ? (
          <p
            role="alert"
            className="mx-5 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
          >
            {data.missingCurrencies.join(', ')} 환율이 없습니다. {date} 이전 환율을 먼저 등록해
            주세요.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">계정</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead className="text-right">외화 잔액</TableHead>
                <TableHead className="text-right">장부 원화</TableHead>
                <TableHead className="text-right">평가 환율</TableHead>
                <TableHead className="text-right">평가 원화</TableHead>
                <TableHead className="pr-5 text-right">평가손익</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((r) => (
                <TableRow key={`${r.accountId}:${r.partnerId ?? ''}:${r.currency}`}>
                  <TableCell className="pl-5">
                    {r.accountCode} {r.accountName}
                  </TableCell>
                  <TableCell className="text-xs">{r.partnerName ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.currency} {formatForeign(r.foreignBalance)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(r.bookKrw)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.rate ? (
                      <>
                        {trimRate(r.rate)}
                        <span className="block text-xs text-muted-foreground">{r.rateDate}</span>
                      </>
                    ) : (
                      <span className="text-warning">환율 없음</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.targetKrw === null ? '' : formatWon(r.targetKrw)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'pr-5 text-right tabular-nums',
                      (r.profit ?? 0) > 0 && 'text-success',
                      (r.profit ?? 0) < 0 && 'text-danger',
                    )}
                  >
                    {r.profit === null ? '' : signed(r.profit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {data && data.rows.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-5" colSpan={6}>
                    외화환산이익 {formatWon(data.gain)}원 · 외화환산손실 {formatWon(data.loss)}원
                  </TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">
                    {signed(data.gain - data.loss)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
          {data?.rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              {date} 현재 외화 잔액이 있는 자산·부채가 없습니다. 전표를 입력할 때 외화 입력을 켜고
              통화·외화금액·환율을 넣어 주세요.
            </p>
          ) : null}
        </div>

        <div className="border-t pt-2">
          <p className="px-5 pb-2 text-sm font-medium">평가 이력</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32 pl-5">평가일</TableHead>
                <TableHead className="text-right">이익</TableHead>
                <TableHead className="text-right">손실</TableHead>
                <TableHead>전표</TableHead>
                <TableHead className="w-28 pr-5 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data?.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="pl-5 tabular-nums">{h.date}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(h.gain)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(h.loss)}</TableCell>
                  <TableCell>
                    {h.entryId ? (
                      <Link
                        href={`/accounting/journals/${h.entryId}`}
                        className="text-primary tabular-nums hover:underline"
                      >
                        {h.entryNumber}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">차액 없음</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {writable && h.id === latest?.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${h.date} 외화평가 취소`}
                        disabled={cancel.isPending}
                        onClick={() =>
                          confirm(`${h.date} 외화평가를 취소할까요? 전표는 역분개합니다.`) &&
                          cancel.mutate(h.date)
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
          {history.data?.length === 0 ? (
            <p className="px-5 py-3 text-sm text-muted-foreground">
              아직 외화평가를 하지 않았습니다.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
