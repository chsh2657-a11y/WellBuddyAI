'use client';

import { useQuery } from '@tanstack/react-query';
import {
  daysBetween,
  NOTE_STATUS_LABELS,
  NOTE_STATUSES,
  type NoteKind,
  type NoteStatus,
} from '@wellbuddy/accounting-core';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { formatWon, todayIso } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { NoteDetailDialog } from './note-detail-dialog';
import { NoteFormDialog } from './note-form-dialog';
import { KIND_TEXT, type Note, NOTES_KEY } from './types';

const STATUS_VARIANT: Record<NoteStatus, 'default' | 'muted' | 'success' | 'warning' | 'danger'> = {
  holding: 'default',
  settled: 'success',
  discounted: 'muted',
  endorsed: 'muted',
  dishonored: 'danger',
};

/** 만기까지 남은 날: D-3, D-day, D+2(지남) */
function dueLabel(dueDate: string, today: string) {
  const d = daysBetween(today, dueDate);
  return d === 0 ? 'D-day' : d > 0 ? `D-${d}` : `D+${-d}`;
}

/** 받을어음·지급어음 대장: 만기 도래 표시, 등록, 상태 처리 */
export function NotesManager() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const [kind, setKind] = useState<NoteKind>('receivable');
  const [status, setStatus] = useState<NoteStatus | ''>('holding');
  const [openId, setOpenId] = useState<string | null>(null);
  const notes = useQuery({
    queryKey: [...NOTES_KEY, kind, status],
    queryFn: () => apiFetch<Note[]>(`/notes?kind=${kind}${status ? `&status=${status}` : ''}`),
  });
  const today = todayIso();
  const text = KIND_TEXT[kind];
  const holding = (notes.data ?? []).filter((n) => n.status === 'holding');
  const dueSoon = holding.filter((n) => daysBetween(today, n.dueDate) <= 7);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <div className="grid gap-1">
          <CardTitle>어음관리</CardTitle>
          <CardDescription>
            받을어음은 수취 → 만기 결제·할인·배서·부도, 지급어음은 발행 → 만기 결제까지 처리하면
            전표를 자동으로 전기합니다. 잘못 처리했으면 마지막 처리를 취소(역분개)합니다.
          </CardDescription>
        </div>
        {writable ? (
          <div className="ml-auto">
            <NoteFormDialog kind={kind} />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4 px-0 pb-2">
        <div className="flex flex-wrap items-center gap-3 px-5">
          <div className="flex rounded-md border p-0.5" role="tablist" aria-label="어음 종류">
            {(['receivable', 'payable'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={cn(
                  'rounded px-4 py-1.5 text-sm font-medium',
                  kind === k
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setKind(k)}
              >
                {KIND_TEXT[k].label}
              </button>
            ))}
          </div>
          <Select
            aria-label="상태"
            className="w-36"
            value={status}
            onChange={(e) => setStatus(e.target.value as NoteStatus | '')}
          >
            <option value="">전체 상태</option>
            {NOTE_STATUSES.filter(
              (s) => kind === 'receivable' || s === 'holding' || s === 'settled',
            ).map((s) => (
              <option key={s} value={s}>
                {kind === 'payable' && s === 'holding' ? '발행(미결제)' : NOTE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          {dueSoon.length > 0 ? (
            <Badge variant="warning">만기 7일 이내 {dueSoon.length}건</Badge>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">어음번호</TableHead>
                <TableHead>{text.partner}</TableHead>
                <TableHead>발행일</TableHead>
                <TableHead>만기일</TableHead>
                <TableHead className="text-right">금액</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="w-24 pr-5 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.data?.map((n) => {
                const left = daysBetween(today, n.dueDate);
                return (
                  <TableRow key={n.id}>
                    <TableCell className="pl-5 font-medium tabular-nums">{n.noteNo}</TableCell>
                    <TableCell>{n.partnerName}</TableCell>
                    <TableCell className="text-xs tabular-nums">{n.issueDate}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      <span className="flex items-center gap-2">
                        {n.dueDate}
                        {n.status === 'holding' ? (
                          <Badge variant={left < 0 ? 'danger' : left <= 7 ? 'warning' : 'muted'}>
                            {dueLabel(n.dueDate, today)}
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatWon(n.amount)}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant={STATUS_VARIANT[n.status]}>
                          {n.kind === 'payable' && n.status === 'holding'
                            ? '발행'
                            : NOTE_STATUS_LABELS[n.status]}
                        </Badge>
                        {n.endorsedToName ? (
                          <span className="text-xs text-muted-foreground">
                            → {n.endorsedToName}
                          </span>
                        ) : null}
                        {n.statusDate ? (
                          <span className="text-xs text-muted-foreground">{n.statusDate}</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${n.noteNo} 처리`}
                        onClick={() => setOpenId(n.id)}
                      >
                        {writable && n.status === 'holding' ? '처리' : '이력'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {notes.data && notes.data.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-5" colSpan={4}>
                    {notes.data.length}건
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatWon(notes.data.reduce((s, n) => s + n.amount, 0))}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
          {notes.data?.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              해당하는 {text.label}이 없습니다.
            </p>
          ) : null}
        </div>
      </CardContent>
      {openId ? (
        <NoteDetailDialog id={openId} writable={writable} onClose={() => setOpenId(null)} />
      ) : null}
    </Card>
  );
}
