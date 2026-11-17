'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vatFromSupply } from '@wellbuddy/accounting-core';
import {
  EVIDENCE_STATUS_LABELS,
  type EvidenceStatus,
  formatBizRegNo,
  getProvider,
  ISSUE_STATUS_LABELS,
  type IssueStatus,
  TAX_INVOICE_KIND_LABELS,
  TAX_INVOICE_KINDS,
  type TaxInvoiceKind,
} from '@wellbuddy/shared';
import { RefreshCw, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
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
import { parseWonInput } from '../_components/evidence-format';

interface Issue {
  id: string;
  mgtKey: string;
  provider: string;
  status: IssueStatus;
  kind: TaxInvoiceKind;
  issueDate: string;
  buyerBizNo: string;
  buyerName: string;
  itemName: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  approvalNo: string | null;
  message: string | null;
  evidenceStatus: EvidenceStatus | null;
}

const KEY = ['tax-invoice-issues'];
const STATUS_VARIANTS: Record<IssueStatus, 'default' | 'success' | 'danger' | 'muted'> = {
  issued: 'default',
  sent: 'success',
  cancelled: 'muted',
  failed: 'danger',
};
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** 전자세금계산서 발행(P2-14): 연동관리에서 고른 공급자(모의·팝빌)로 발행하고 매출 증빙으로 등록한다 */
export function IssueView() {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const queryClient = useQueryClient();
  const issues = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<Issue[]>('/tax-invoice-issues'),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: KEY });
    void queryClient.invalidateQueries({ queryKey: ['evidence'] });
  };

  const check = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Issue>(`/tax-invoice-issues/${id}/refresh`, { method: 'POST' }),
    onSuccess: (r) => {
      refresh();
      toast.success(`상태: ${ISSUE_STATUS_LABELS[r.status]}`);
    },
    onError: (e) => toast.error(errorText(e, '상태를 확인하지 못했습니다.')),
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch<Issue & { notice: string | null }>(`/tax-invoice-issues/${id}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (r) => {
      refresh();
      toast.success('발행을 취소했습니다.');
      if (r.notice) toast.info(r.notice);
    },
    onError: (e) => toast.error(errorText(e, '취소하지 못했습니다.')),
  });

  return (
    <div className="grid gap-6">
      {writable ? <IssueForm onIssued={refresh} /> : null}
      <div className="min-w-0 overflow-x-auto rounded-md border">
        <Table aria-label="발행한 세금계산서">
          <TableHeader>
            <TableRow>
              <TableHead>작성일</TableHead>
              <TableHead>공급받는자</TableHead>
              <TableHead>품목</TableHead>
              <TableHead className="text-right">공급가액</TableHead>
              <TableHead className="text-right">세액</TableHead>
              <TableHead className="text-right">합계</TableHead>
              <TableHead>승인번호</TableHead>
              <TableHead>상태</TableHead>
              {writable ? <TableHead className="sr-only">작업</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(issues.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  {issues.isLoading ? '불러오는 중…' : '발행한 세금계산서가 없습니다.'}
                </TableCell>
              </TableRow>
            ) : (
              issues.data!.map((r) => (
                <TableRow key={r.id} aria-label={`${r.buyerName} ${r.itemName}`}>
                  <TableCell className="whitespace-nowrap tabular-nums">{r.issueDate}</TableCell>
                  <TableCell className="min-w-40">
                    {r.buyerName}
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {formatBizRegNo(r.buyerBizNo)}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-32">
                    {r.itemName}
                    {r.kind !== 'tax' ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {TAX_INVOICE_KIND_LABELS[r.kind]}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatWon(r.supplyAmount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatWon(r.vatAmount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatWon(r.totalAmount)}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">{r.approvalNo ?? '—'}</TableCell>
                  <TableCell className="min-w-32">
                    <Badge variant={STATUS_VARIANTS[r.status]} title={r.message ?? undefined}>
                      {ISSUE_STATUS_LABELS[r.status]}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">
                      {getProvider('taxinvoice', r.provider)?.label ?? r.provider}
                      {r.evidenceStatus ? (
                        <Link
                          href="/evidence/records?kind=tax_invoice"
                          className="ml-1 text-primary underline-offset-2 hover:underline"
                        >
                          증빙 {EVIDENCE_STATUS_LABELS[r.evidenceStatus]}
                        </Link>
                      ) : null}
                    </span>
                  </TableCell>
                  {writable ? (
                    <TableCell className="whitespace-nowrap pr-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${r.buyerName} 상태 확인`}
                        disabled={r.status === 'cancelled' || check.isPending}
                        onClick={() => check.mutate(r.id)}
                      >
                        <RefreshCw />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${r.buyerName} 발행 취소`}
                        disabled={r.status === 'cancelled' || cancel.isPending}
                        onClick={() => {
                          const reason = prompt(
                            `'${r.buyerName}' 세금계산서를 취소합니다. 사유를 입력해 주세요.`,
                          );
                          if (reason?.trim()) cancel.mutate({ id: r.id, reason: reason.trim() });
                        }}
                      >
                        <XCircle />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function IssueForm({ onIssued }: { onIssued: () => void }) {
  const [issueDate, setIssueDate] = useState(todayIso());
  const [kind, setKind] = useState<TaxInvoiceKind>('tax');
  const [buyerBizNo, setBuyerBizNo] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerCeoName, setBuyerCeoName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [itemName, setItemName] = useState('');
  const [supply, setSupply] = useState('');
  const [error, setError] = useState<string | null>(null);

  const supplyAmount = parseWonInput(supply);
  const valid = supplyAmount !== null && !Number.isNaN(supplyAmount) && supplyAmount > 0;
  const vat = valid && kind === 'tax' ? vatFromSupply(supplyAmount).vat : 0;

  const issue = useMutation({
    mutationFn: () =>
      apiFetch<Issue>('/tax-invoice-issues', {
        method: 'POST',
        json: {
          issueDate,
          kind,
          buyerBizNo,
          buyerName,
          buyerCeoName: buyerCeoName || undefined,
          buyerEmail: buyerEmail || undefined,
          itemName,
          supplyAmount,
        },
      }),
    onSuccess: (r) => {
      onIssued();
      toast.success(
        `${r.buyerName}에 세금계산서를 발행했습니다${r.approvalNo ? ` (승인번호 ${r.approvalNo})` : ''}.`,
      );
      setBuyerBizNo('');
      setBuyerName('');
      setBuyerCeoName('');
      setBuyerEmail('');
      setItemName('');
      setSupply('');
    },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.details)) {
        setError((e.details as { message: string }[])[0]?.message ?? e.message);
      } else {
        setError(errorText(e, '발행하지 못했습니다.'));
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError('공급가액을 숫자로 입력해 주세요.');
      return;
    }
    setError(null);
    issue.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>전자세금계산서 발행</CardTitle>
        <CardDescription>
          설정 &gt; 연동관리의 &apos;전자세금계산서 발행&apos;에서 고른 방식(모의·팝빌)으로
          발행합니다. 발행한 계산서는 매출 세금계산서로 등록되어 자동분개로 이어집니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit} noValidate aria-label="세금계산서 발행">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="issue-date" label="작성일">
              <Input
                id="issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </FormField>
            <FormField id="issue-kind" label="종류">
              <Select
                id="issue-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as TaxInvoiceKind)}
              >
                {TAX_INVOICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {TAX_INVOICE_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="issue-bizno" label="공급받는자 사업자번호">
              <Input
                id="issue-bizno"
                inputMode="numeric"
                placeholder="123-45-67890"
                value={buyerBizNo}
                onChange={(e) => setBuyerBizNo(e.target.value)}
              />
            </FormField>
            <FormField id="issue-buyer" label="상호">
              <Input
                id="issue-buyer"
                maxLength={100}
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
              />
            </FormField>
            <FormField id="issue-ceo" label="대표자(선택)">
              <Input
                id="issue-ceo"
                maxLength={50}
                value={buyerCeoName}
                onChange={(e) => setBuyerCeoName(e.target.value)}
              />
            </FormField>
            <FormField id="issue-email" label="받는 이메일(선택)">
              <Input
                id="issue-email"
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
              />
            </FormField>
            <FormField id="issue-item" label="품목">
              <Input
                id="issue-item"
                maxLength={100}
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
            </FormField>
            <FormField id="issue-supply" label="공급가액">
              <Input
                id="issue-supply"
                inputMode="numeric"
                value={supply}
                onChange={(e) => setSupply(e.target.value)}
              />
            </FormField>
            <div className="grid content-end gap-1 text-sm" aria-live="polite">
              <span className="text-muted-foreground">세액·합계</span>
              <span className="tabular-nums" data-testid="issue-total">
                세액 {formatWon(vat)} · 합계 {formatWon(valid ? supplyAmount + vat : 0)}
              </span>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={issue.isPending}>
              <Send /> {issue.isPending ? '발행 중…' : '발행'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
