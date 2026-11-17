'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { discountCharge, NOTE_STATUS_LABELS } from '@wellbuddy/accounting-core';
import { Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { formatWon, todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMasterData } from '../journals/_components/use-master-data';
import { ACTION_LABELS, KIND_TEXT, type NoteDetail, NOTES_KEY } from './types';

type Action = 'settle' | 'discount' | 'endorse' | 'dishonor';

/** 할인료 미리보기(할인일이 만기 뒤면 null) */
function previewCharge(amount: number, rate: string, date: string, dueDate: string) {
  const r = Number(rate);
  if (!date || !Number.isFinite(r) || r < 0 || r > 100) return null;
  try {
    return discountCharge({
      faceAmount: amount,
      annualRatePercent: r,
      discountDate: date,
      maturityDate: dueDate,
    });
  } catch {
    return null;
  }
}

/** 어음 상세: 처리 이력(전표 연결), 보유 중이면 결제·할인·배서·부도, 마지막 처리 취소 */
export function NoteDetailDialog({
  id,
  writable,
  onClose,
}: {
  id: string;
  writable: boolean;
  onClose: () => void;
}) {
  const master = useMasterData();
  const queryClient = useQueryClient();
  const key = [...NOTES_KEY, 'detail', id];
  const note = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<NoteDetail>(`/notes/${id}`),
    staleTime: 0,
  });
  const [action, setAction] = useState<Action>('settle');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(
    () => master.accountByCode.get('103')?.id ?? null,
  );
  const [rate, setRate] = useState('');
  const [toPartnerId, setToPartnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: NOTES_KEY });
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  const act = useMutation({
    mutationFn: () => {
      const body =
        action === 'settle'
          ? { date, accountId }
          : action === 'discount'
            ? { date, annualRate: Number(rate), accountId }
            : action === 'endorse'
              ? { date, toPartnerId }
              : { date };
      return apiFetch<NoteDetail>(`/notes/${id}/${action}`, { method: 'POST', json: body });
    },
    onSuccess: (n) => {
      toast.success(`${n.noteNo} ${ACTION_LABELS[action]} 전표를 전기했습니다.`);
      queryClient.setQueryData(key, n);
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : '처리하지 못했습니다.'),
  });
  const undo = useMutation({
    mutationFn: () =>
      apiFetch<{ note: NoteDetail | null }>(`/notes/${id}/undo`, { method: 'POST' }),
    onSuccess: (r) => {
      refresh();
      if (r.note) {
        queryClient.setQueryData(key, r.note);
        toast.success('마지막 처리를 취소했습니다(역분개).');
      } else {
        toast.success('어음 등록을 취소했습니다(역분개).');
        onClose();
      }
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '취소하지 못했습니다.'),
  });

  const n = note.data;
  const actions: Action[] =
    n?.kind === 'receivable' ? ['settle', 'discount', 'endorse', 'dishonor'] : ['settle'];
  const charge = n && action === 'discount' ? previewCharge(n.amount, rate, date, n.dueDate) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{n ? `${KIND_TEXT[n.kind].label} ${n.noteNo}` : '어음'}</DialogTitle>
          {n ? (
            <DialogDescription>
              {n.partnerName} · {formatWon(n.amount)}원 · 만기 {n.dueDate} ·{' '}
              {n.kind === 'payable' && n.status === 'holding'
                ? '발행'
                : NOTE_STATUS_LABELS[n.status]}
              {n.endorsedToName ? ` → ${n.endorsedToName}` : ''}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {n && writable && n.status === 'holding' ? (
          <form
            className="grid gap-3 rounded-md border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              act.mutate();
            }}
          >
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="처리">
              {actions.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={action === a}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm font-medium',
                    action === a
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => {
                    setAction(a);
                    setError(null);
                  }}
                >
                  {ACTION_LABELS[a]}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="note-action-date" label="처리일">
                <Input
                  id="note-action-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </FormField>
              {action === 'settle' || action === 'discount' ? (
                <FormField
                  id="note-action-account"
                  label={n.kind === 'payable' ? '지급 계정' : '입금 계정'}
                >
                  <Combobox
                    aria-label={n.kind === 'payable' ? '지급 계정' : '입금 계정'}
                    items={master.accountItems}
                    value={accountId}
                    onChange={(v) => setAccountId(v)}
                  />
                </FormField>
              ) : null}
              {action === 'discount' ? (
                <FormField
                  id="note-action-rate"
                  label="연 할인율(%)"
                  hint={
                    charge
                      ? `${charge.days}일 · 할인료 ${formatWon(charge.charge)}원 · 입금 ${formatWon(charge.proceeds)}원`
                      : '할인료 = 액면 × 연율 × 일수 ÷ 365'
                  }
                >
                  <Input
                    id="note-action-rate"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    required
                  />
                </FormField>
              ) : null}
              {action === 'endorse' ? (
                <FormField
                  id="note-action-partner"
                  label="배서할 거래처"
                  hint="외상매입금을 갚습니다"
                >
                  <Combobox
                    aria-label="배서할 거래처"
                    items={master.partnerItems}
                    value={toPartnerId}
                    onChange={(v) => setToPartnerId(v)}
                  />
                </FormField>
              ) : null}
            </div>
            {action === 'dishonor' ? (
              <p className="text-sm text-muted-foreground">
                받을어음을 부도어음과수표(246)로 옮깁니다.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={act.isPending}>
                {ACTION_LABELS[action]} 전표 전기
              </Button>
            </div>
          </form>
        ) : null}

        <div className="grid gap-2">
          <p className="text-sm font-medium">처리 이력</p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>처리</TableHead>
                  <TableHead>일자</TableHead>
                  <TableHead>전표</TableHead>
                  <TableHead>내용</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {n?.events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{ACTION_LABELS[e.action]}</TableCell>
                    <TableCell className="tabular-nums">{e.eventDate}</TableCell>
                    <TableCell>
                      {e.entryId ? (
                        <Link
                          href={`/accounting/journals/${e.entryId}`}
                          className="text-primary tabular-nums hover:underline"
                        >
                          {e.entryNumber}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">전표 없음</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.action === 'discount'
                        ? `${String(e.detail.days)}일 · 할인료 ${formatWon(Number(e.detail.charge))}원`
                        : e.action === 'endorse'
                          ? `${String(e.detail.toPartnerName)}에 배서`
                          : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {writable && n ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={undo.isPending}
                onClick={() =>
                  confirm(
                    n.events.length > 1
                      ? `마지막 처리(${ACTION_LABELS[n.events.at(-1)!.action]})를 취소할까요? 전표는 역분개합니다.`
                      : '어음 등록을 취소하고 대장에서 지울까요? 전표는 역분개합니다.',
                  ) && undo.mutate()
                }
              >
                <Undo2 />
                마지막 처리 취소
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
