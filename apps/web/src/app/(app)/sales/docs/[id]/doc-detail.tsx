'use client';

import { formatWon } from '@wellbuddy/accounting-core';
import {
  formatBizRegNo,
  FULL_CONVERSIONS,
  isOrderKind,
  nextTradeDocKinds,
  TRADE_DOC_KIND_LABELS,
  TRADE_DOC_STATUS_LABELS,
  type TradeDocKind,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Printer, XCircle } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { can, useSession } from '@/lib/session';
import { formatQty, STATUS_VARIANT, TRADE_DOCS_KEY, type TradeDoc } from '../../_lib/trade';

const JOURNAL_STATUS: Record<string, string> = {
  draft: '작성중',
  pending: '승인요청',
  posted: '전기',
  reversed: '역분개됨',
};

/** 이 문서에서 지금 만들 수 있는 다음 단계 */
function nextActions(doc: TradeDoc): TradeDocKind[] {
  if (doc.status === 'cancelled' || doc.status === 'closed') return [];
  return nextTradeDocKinds(doc.kind).filter((k) => {
    // 줄을 그대로 옮기는 전환은 한 번만
    if (FULL_CONVERSIONS[k] === doc.kind) {
      return !doc.children.some((c) => c.kind === k && c.status !== 'cancelled');
    }
    return doc.lines.some((l) => l.remainingQty > 0);
  });
}

export function DocDetail({ id }: { id: string }) {
  const { data: session } = useSession();
  const writable = can(session, 'sales', 'write');
  const queryClient = useQueryClient();
  const doc = useQuery({
    queryKey: [...TRADE_DOCS_KEY, 'detail', id],
    queryFn: () => apiFetch<TradeDoc>(`/trade-docs/${id}`),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      apiFetch<TradeDoc>(`/trade-docs/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: TRADE_DOCS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`${d.docNo}을(를) 취소했습니다.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '취소하지 못했습니다.'),
  });

  const d = doc.data;
  if (!d) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  const order = isOrderKind(d.kind);
  const showProgress = order || d.kind === 'purchase' || d.kind === 'sale';
  const actions = writable ? nextActions(d) : [];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start gap-3">
          <div className="grid gap-1">
            <CardTitle className="flex items-center gap-2">
              {d.kindLabel} {d.docNo}
              <Badge variant={STATUS_VARIANT[d.status]}>{TRADE_DOC_STATUS_LABELS[d.status]}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {d.docDate} · {d.partnerName ?? '거래처 없음'}
              {d.partnerBizRegNo ? ` (${formatBizRegNo(d.partnerBizRegNo)})` : ''} ·{' '}
              {d.warehouseName ?? '창고 없음'}
              {d.createdByName ? ` · 작성 ${d.createdByName}` : ''}
            </p>
            {d.cancelReason ? (
              <p className="text-sm text-danger">취소 사유: {d.cancelReason}</p>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {actions.map((k) => (
              <Button key={k} asChild size="sm">
                <Link href={`/sales/docs/new?kind=${k}&source=${d.id}`}>
                  <ArrowRight />
                  {TRADE_DOC_KIND_LABELS[k]} 만들기
                </Link>
              </Button>
            ))}
            <Button asChild size="sm" variant="outline">
              <Link href={`/sales/docs/${d.id}/print`}>
                <Printer />
                {d.kind === 'shipment' || d.kind === 'sale' ? '거래명세서 인쇄' : '인쇄'}
              </Link>
            </Button>
            {writable && d.status !== 'cancelled' ? (
              <Button
                size="sm"
                variant="outline"
                className="text-danger"
                disabled={cancel.isPending}
                onClick={() => {
                  const reason = prompt('취소 사유를 입력해 주세요.');
                  if (reason?.trim()) cancel.mutate(reason.trim());
                }}
              >
                <XCircle />
                취소
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">앞 문서</dt>
              <dd>
                {d.sourceDoc ? (
                  <Link className="underline" href={`/sales/docs/${d.sourceDoc.id}`}>
                    {TRADE_DOC_KIND_LABELS[d.sourceDoc.kind]} {d.sourceDoc.docNo}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">전표</dt>
              <dd className="flex flex-wrap gap-2">
                {[d.entry, d.costEntry].filter(Boolean).map((e) => (
                  <Link key={e!.id} className="underline" href={`/accounting/journals/${e!.id}`}>
                    {e!.number}({JOURNAL_STATUS[e!.status] ?? e!.status})
                  </Link>
                ))}
                {!d.entry && !d.costEntry ? '—' : null}
              </dd>
            </div>
            {d.dueDate ? (
              <div>
                <dt className="text-muted-foreground">{d.kind === 'quote' ? '유효기한' : '납기'}</dt>
                <dd>{d.dueDate}</dd>
              </div>
            ) : null}
            {d.memo ? (
              <div>
                <dt className="text-muted-foreground">메모</dt>
                <dd>{d.memo}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto px-0 py-2">
          <Table aria-label="문서 줄">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-5 text-center">#</TableHead>
                <TableHead className="w-24">코드</TableHead>
                <TableHead className="min-w-40">품목</TableHead>
                <TableHead className="w-24">규격</TableHead>
                <TableHead className="w-24 text-right">수량</TableHead>
                <TableHead className="w-28 text-right">단가</TableHead>
                <TableHead className="w-32 text-right">공급가액</TableHead>
                <TableHead className="w-28 text-right">부가세</TableHead>
                {showProgress ? (
                  <TableHead className="w-28 pr-5 text-right">{order ? '남은 수량' : '반품 가능'}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="pl-5 text-center tabular-nums">{l.lineNo}</TableCell>
                  <TableCell className="tabular-nums">{l.itemCode}</TableCell>
                  <TableCell className="font-medium">{l.itemName}</TableCell>
                  <TableCell>{l.spec ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(l.qty)} {l.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(l.unitPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(l.supply)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(l.vat)}</TableCell>
                  {showProgress ? (
                    <TableCell className="pr-5 text-right tabular-nums">{formatQty(l.remainingQty)}</TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6} className="pl-5 text-right font-medium">
                  합계 {formatWon(d.total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(d.supplyTotal)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(d.vatTotal)}</TableCell>
                {showProgress ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {d.children.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">다음 단계 문서</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {d.children.map((c) => (
              <Link key={c.id} href={`/sales/docs/${c.id}`} className="flex items-center gap-3 hover:underline">
                <span className="tabular-nums">{c.docDate}</span>
                <span>
                  {TRADE_DOC_KIND_LABELS[c.kind]} {c.docNo}
                </span>
                <span className="tabular-nums">{formatWon(c.total)}</span>
                <Badge variant={STATUS_VARIANT[c.status]}>{TRADE_DOC_STATUS_LABELS[c.status]}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
