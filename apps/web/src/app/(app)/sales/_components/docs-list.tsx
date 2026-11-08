'use client';

import { formatWon } from '@wellbuddy/accounting-core';
import {
  ENABLED_TRADE_DOC_KINDS,
  TRADE_DOC_KIND_LABELS,
  TRADE_DOC_STATUS_LABELS,
  type TradeDocKind,
} from '@wellbuddy/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { STATUS_VARIANT, TRADE_DOCS_KEY, type TradeDocSummary } from '../_lib/trade';

/** 거래 문서 목록(판매·구매 공용): 종류 칩·기간·검색, 새 문서 버튼 */
export function DocsList({
  kinds,
  label,
}: {
  /** 이 목록에 보일 문서 종류(순서대로 칩·새 문서 버튼) */
  kinds: readonly TradeDocKind[];
  label: string;
}) {
  const { data: session } = useSession();
  const writable = can(session, 'sales', 'write');
  const [kind, setKind] = useState<TradeDocKind | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const params = new URLSearchParams({ kinds: (kind ? [kind] : kinds).join(','), limit: '200' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (q.trim()) params.set('q', q.trim());
  const docs = useQuery({
    queryKey: [...TRADE_DOCS_KEY, kinds.join(','), kind, from, to, q.trim()],
    queryFn: () => apiFetch<{ items: TradeDocSummary[]; total: number }>(`/trade-docs?${params}`),
  });
  const creatable = kinds.filter((k) => ENABLED_TRADE_DOC_KINDS.includes(k));

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="문서 종류">
            {(['', ...kinds] as const).map((k) => (
              <Button
                key={k || 'all'}
                size="sm"
                variant={kind === k ? 'default' : 'outline'}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k ? TRADE_DOC_KIND_LABELS[k] : '전체'}
              </Button>
            ))}
          </div>
          {writable ? (
            <div className="ml-auto flex flex-wrap gap-2">
              {creatable.map((k) => (
                <Button
                  key={k}
                  asChild
                  size="sm"
                  variant={k === creatable[0] ? 'default' : 'outline'}
                >
                  <Link href={`/sales/docs/new?kind=${k}`}>
                    <Plus />새 {TRADE_DOC_KIND_LABELS[k]}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="시작일"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="text-muted-foreground">~</span>
          <Input
            type="date"
            aria-label="종료일"
            className="w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={`${label} 검색`}
              placeholder="문서번호·거래처·메모"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-2">
        <Table aria-label={`${label} 문서`}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 pl-5">일자</TableHead>
              <TableHead className="w-24">종류</TableHead>
              <TableHead className="min-w-40">문서번호</TableHead>
              <TableHead className="min-w-36">거래처</TableHead>
              <TableHead className="w-32 text-right">공급가액</TableHead>
              <TableHead className="w-28 text-right">부가세</TableHead>
              <TableHead className="w-32 text-right">합계</TableHead>
              <TableHead className="min-w-28">앞 문서</TableHead>
              <TableHead className="w-24 pr-5">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.data?.items.map((d) => (
              <TableRow
                key={d.id}
                className={cn(d.status === 'cancelled' && 'text-muted-foreground')}
              >
                <TableCell className="whitespace-nowrap pl-5 tabular-nums">{d.docDate}</TableCell>
                <TableCell>{d.kindLabel}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={`/sales/docs/${d.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {d.docNo}
                  </Link>
                </TableCell>
                <TableCell>{d.partnerName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatWon(d.supplyTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(d.vatTotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatWon(d.total)}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {d.sourceDocNo ?? '—'}
                </TableCell>
                <TableCell className="pr-5">
                  <Badge variant={STATUS_VARIANT[d.status]}>
                    {TRADE_DOC_STATUS_LABELS[d.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {docs.data?.items.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">문서가 없습니다.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
