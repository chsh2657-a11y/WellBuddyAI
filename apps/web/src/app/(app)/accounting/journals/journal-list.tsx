'use client';

import {
  JOURNAL_STATUS_LABELS,
  JOURNAL_STATUSES,
  JOURNAL_TYPE_LABELS,
  JOURNAL_TYPES,
  type JournalStatus,
  type JournalType,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { formatWon, todayIso } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { JOURNALS_KEY } from './_components/journal-editor';
import { JournalStatusBadge } from './_components/status-badge';
import type { JournalEntry } from './_components/types';

const PAGE = 50;

function monthRange(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** 첫 차변 계정(외 n건) */
function accountSummary(e: JournalEntry) {
  const first = e.lines.find((l) => l.debit > 0) ?? e.lines[0];
  if (!first) return '';
  const others = e.lines.length - 1;
  return others > 0 ? `${first.accountName} 외 ${others}` : first.accountName;
}

export function JournalList() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const manager = session?.role === 'owner' || session?.role === 'admin';
  const canPost = writable && (!session?.company?.journalApprovalRequired || manager);
  const canApprove = manager || session?.role === 'approver';
  const queryClient = useQueryClient();

  const [range, setRange] = useState(() => monthRange(todayIso()));
  const [status, setStatus] = useState<JournalStatus | ''>('');
  const [type, setType] = useState<JournalType | ''>('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    limit: String(PAGE),
    offset: String(offset),
  });
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  if (q.trim()) params.set('q', q.trim());
  const list = useQuery({
    queryKey: [...JOURNALS_KEY, params.toString()],
    queryFn: () => apiFetch<{ items: JournalEntry[]; total: number }>(`/journals?${params}`),
  });
  const items = list.data?.items ?? [];
  const chosen = items.filter((e) => selected.has(e.id));
  const drafts = chosen.filter((e) => e.status === 'draft');
  const pendings = chosen.filter((e) => e.status === 'pending');

  const bulk = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: 'post' | 'approve' }) => {
      let ok = 0;
      const errors: string[] = [];
      for (const id of ids) {
        try {
          await apiFetch(`/journals/${id}/${action}`, { method: 'POST' });
          ok++;
        } catch (e) {
          errors.push(e instanceof ApiError ? e.message : '처리하지 못했습니다.');
        }
      }
      return { ok, errors };
    },
    onSuccess: ({ ok, errors }, { action }) => {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: JOURNALS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
      const label = action === 'post' ? '전기' : '승인';
      if (ok) toast.success(`${ok}건을 ${label}했습니다.`);
      if (errors.length) toast.error(`${errors.length}건 실패: ${errors[0]}`);
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const reset = () => {
    setOffset(0);
    setSelected(new Set());
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Input
            type="date"
            aria-label="시작일"
            className="w-40"
            value={range.from}
            onChange={(e) => {
              setRange({ ...range, from: e.target.value });
              reset();
            }}
          />
          <span className="text-muted-foreground">~</span>
          <Input
            type="date"
            aria-label="종료일"
            className="w-40"
            value={range.to}
            onChange={(e) => {
              setRange({ ...range, to: e.target.value });
              reset();
            }}
          />
        </div>
        <Select
          aria-label="상태"
          className="w-32"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as JournalStatus | '');
            reset();
          }}
        >
          <option value="">전체 상태</option>
          {JOURNAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {JOURNAL_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="구분"
          className="w-28"
          value={type}
          onChange={(e) => {
            setType(e.target.value as JournalType | '');
            reset();
          }}
        >
          <option value="">전체 구분</option>
          {JOURNAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {JOURNAL_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <div className="relative w-full max-w-56">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="적요 검색"
            placeholder="적요 검색"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
          />
        </div>
        {writable ? (
          <Button asChild size="sm" className="ml-auto">
            <Link href="/accounting/journals/new">
              <Plus />
              전표입력
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {chosen.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-y bg-primary-soft px-5 py-2 text-sm">
            <span>{chosen.length}건 선택</span>
            {canPost && drafts.length > 0 ? (
              <Button
                size="sm"
                disabled={bulk.isPending}
                onClick={() => bulk.mutate({ ids: drafts.map((e) => e.id), action: 'post' })}
              >
                작성중 {drafts.length}건 전기
              </Button>
            ) : null}
            {canApprove && pendings.length > 0 ? (
              <Button
                size="sm"
                disabled={bulk.isPending}
                onClick={() => bulk.mutate({ ids: pendings.map((e) => e.id), action: 'approve' })}
              >
                승인요청 {pendings.length}건 승인
              </Button>
            ) : null}
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-5">
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  className="size-4"
                  checked={items.length > 0 && chosen.length === items.length}
                  onChange={(e) =>
                    setSelected(new Set(e.target.checked ? items.map((i) => i.id) : []))
                  }
                />
              </TableHead>
              <TableHead className="w-36">전표번호</TableHead>
              <TableHead className="w-16">구분</TableHead>
              <TableHead>적요</TableHead>
              <TableHead className="w-44">계정</TableHead>
              <TableHead className="w-36">거래처</TableHead>
              <TableHead className="w-32 text-right">금액</TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-24 pr-5">작성자</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="pl-5">
                  <input
                    type="checkbox"
                    aria-label={`${e.number} 선택`}
                    className="size-4"
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                </TableCell>
                <TableCell className="tabular-nums">
                  <Link
                    href={`/accounting/journals/${e.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {e.number}
                  </Link>
                </TableCell>
                <TableCell>{JOURNAL_TYPE_LABELS[e.type]}</TableCell>
                <TableCell className="max-w-72 truncate">
                  {e.description ?? e.lines[0]?.memo ?? ''}
                </TableCell>
                <TableCell className="truncate">{accountSummary(e)}</TableCell>
                <TableCell className="truncate">
                  {e.vat?.partnerName ?? e.lines.find((l) => l.partnerName)?.partnerName ?? ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatWon(e.totalAmount)}
                </TableCell>
                <TableCell>
                  <JournalStatusBadge status={e.status} />
                </TableCell>
                <TableCell className="pr-5 text-xs text-muted-foreground">
                  {e.createdByName ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.data && items.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">이 기간에 전표가 없습니다.</p>
        ) : null}
        {list.data && list.data.total > PAGE ? (
          <div className="flex items-center justify-end gap-2 px-5 pt-3 text-sm">
            <span className="text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE, list.data.total)} / {list.data.total}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="이전 페이지"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="다음 페이지"
              disabled={offset + PAGE >= list.data.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              <ChevronRight />
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
