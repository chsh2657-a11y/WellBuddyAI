'use client';

import { useQuery } from '@tanstack/react-query';
import {
  EVIDENCE_STATUSES,
  type EvidenceStatus,
  UPLOAD_KINDS,
  type UploadKind,
} from '@wellbuddy/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
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
import { apiFetch } from '@/lib/api';
import { formatWon } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  EVIDENCE_STATUS_LABELS,
  KIND_SHORT_LABELS,
  STATUS_VARIANTS,
} from '../_components/evidence-format';

interface CenterItem {
  evidenceKind: UploadKind;
  id: string;
  date: string;
  kindLabel: string;
  description: string;
  counterparty: string | null;
  sourceLabel: string | null;
  flow: 'in' | 'out';
  amount: number;
  status: EvidenceStatus;
  account: string | null;
  entryId: string | null;
  entryNumber: string | null;
}

interface CenterData {
  total: number;
  counts: Record<EvidenceStatus, number>;
  items: CenterItem[];
  truncated: boolean;
}

/** 증빙센터(P2-28): 모든 증빙을 한 목록으로, 처리 상태와 전표 연결을 함께 */
export function CenterView() {
  const [status, setStatus] = useState<'' | EvidenceStatus>('');
  const [kind, setKind] = useState<'' | UploadKind>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (kind) params.set('kind', kind);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (q.trim()) params.set('q', q.trim());
  const qs = params.toString();
  const data = useQuery({
    queryKey: ['evidence', 'center', qs],
    queryFn: () => apiFetch<CenterData>(`/evidence/center${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const counts = data.data?.counts;

  const chip = (value: '' | EvidenceStatus, label: string, count: number | undefined) => (
    <button
      key={value || 'all'}
      type="button"
      aria-pressed={status === value}
      onClick={() => setStatus(value)}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        status === value
          ? 'border-primary bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label} <span className="tabular-nums">{count ?? 0}</span>
    </button>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="처리 상태">
        {chip('', '전체', data.data?.total)}
        {EVIDENCE_STATUSES.map((s) => chip(s, EVIDENCE_STATUS_LABELS[s], counts?.[s]))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          aria-label="증빙 종류"
          className="w-36"
          value={kind}
          onChange={(e) => setKind(e.target.value as UploadKind)}
        >
          <option value="">전체 종류</option>
          {UPLOAD_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_SHORT_LABELS[k]}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          aria-label="시작일"
          className="w-40"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="pb-2 text-muted-foreground">~</span>
        <Input
          type="date"
          aria-label="종료일"
          className="w-40"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Input
          type="search"
          aria-label="검색"
          placeholder="거래처·적요·가맹점"
          className="w-56"
          value={q}
          maxLength={50}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="증빙센터">
          <TableHeader>
            <TableRow>
              <TableHead>일자</TableHead>
              <TableHead>종류</TableHead>
              <TableHead>내용</TableHead>
              <TableHead className="text-right">금액</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>분개 계정</TableHead>
              <TableHead>전표</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data?.items.map((i) => (
              <TableRow key={`${i.evidenceKind}:${i.id}`}>
                <TableCell className="whitespace-nowrap tabular-nums">{i.date}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {i.kindLabel}
                  {i.sourceLabel ? (
                    <div className="text-xs text-muted-foreground">{i.sourceLabel}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{i.counterparty ?? ''}</div>
                  {i.description && i.description !== i.counterparty ? (
                    <div className="text-xs text-muted-foreground">{i.description}</div>
                  ) : null}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    i.flow === 'in' ? 'text-success' : 'text-foreground',
                  )}
                >
                  {i.flow === 'in' ? '+' : '−'}
                  {formatWon(i.amount)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANTS[i.status]}>
                    {EVIDENCE_STATUS_LABELS[i.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{i.account ?? ''}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {i.entryId && i.entryNumber ? (
                    <Link href={`/accounting/journals/${i.entryId}`} className="underline">
                      {i.entryNumber}
                    </Link>
                  ) : i.status === 'review' || i.status === 'pending' ? (
                    <Link href="/evidence/review" className="text-primary underline">
                      검토함에서 처리
                    </Link>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.isSuccess && data.data.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">조건에 맞는 증빙이 없습니다.</p>
        ) : null}
        {data.data?.truncated ? (
          <p className="p-3 text-xs text-muted-foreground">
            최근 1,000건만 보여 줍니다. 기간이나 조건을 좁혀 주세요.
          </p>
        ) : null}
      </div>
    </div>
  );
}
