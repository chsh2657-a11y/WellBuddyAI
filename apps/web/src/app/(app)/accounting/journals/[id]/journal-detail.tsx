'use client';

import { EVIDENCE_TYPE_LABELS, formatForeign, VAT_TYPE_LABELS } from '@wellbuddy/accounting-core';
import { JOURNAL_TYPE_LABELS } from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Trash2, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { formatWon, todayIso, wonOrBlank } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { AttachmentsField } from '../_components/attachments-field';
import { trimRate } from '../_components/foreign-calc';
import { JOURNALS_KEY, JournalEditor } from '../_components/journal-editor';
import { JournalStatusBadge } from '../_components/status-badge';
import type { JournalEntry } from '../_components/types';

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

export function JournalDetail({ id }: { id: string }) {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const approver =
    session?.role === 'owner' || session?.role === 'admin' || session?.role === 'approver';
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = [...JOURNALS_KEY, 'detail', id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<JournalEntry>(`/journals/${id}`),
  });
  const [rejecting, setRejecting] = useState(false);
  const [reversing, setReversing] = useState(false);

  const done = (message: string) => (entry?: JournalEntry) => {
    if (entry) queryClient.setQueryData(key, entry);
    void queryClient.invalidateQueries({ queryKey: JOURNALS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
    toast.success(message);
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');
  const transition = (path: 'withdraw' | 'approve') => () =>
    apiFetch<JournalEntry>(`/journals/${id}/${path}`, { method: 'POST' });
  const withdraw = useMutation({
    mutationFn: transition('withdraw'),
    onSuccess: done('승인요청을 회수했습니다.'),
    onError,
  });
  const approve = useMutation({
    mutationFn: transition('approve'),
    onSuccess: done('승인해 전기했습니다.'),
    onError,
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/journals/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: JOURNALS_KEY });
      toast.success('전표를 삭제했습니다.');
      router.push('/accounting/journals');
    },
    onError,
  });
  const attach = useMutation({
    mutationFn: (fileIds: string[]) =>
      apiFetch<JournalEntry>(`/journals/${id}/attachments`, {
        method: 'POST',
        json: { fileIds },
      }),
    onSuccess: done('증빙을 첨부했습니다.'),
    onError,
  });
  const detach = useMutation({
    mutationFn: (fileId: string) =>
      apiFetch(`/journals/${id}/attachments/${fileId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      toast.success('첨부를 뺐습니다.');
    },
    onError,
  });

  const e = query.data;
  if (!e) return null;
  const editable = e.status === 'draft' && writable && e.type !== 'opening';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/accounting/journals">
            <ArrowLeft />
            전표조회
          </Link>
        </Button>
        <h2 className="text-lg font-semibold tabular-nums">{e.number}</h2>
        <JournalStatusBadge status={e.status} />
        <span className="text-sm text-muted-foreground">{JOURNAL_TYPE_LABELS[e.type]}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable ? (
            <Button
              variant="ghost"
              className="text-danger"
              disabled={remove.isPending}
              onClick={() => confirm('이 전표를 삭제할까요?') && remove.mutate()}
            >
              <Trash2 />
              삭제
            </Button>
          ) : null}
          {e.status === 'pending' && writable ? (
            <Button
              variant="outline"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              <Undo2 />
              회수
            </Button>
          ) : null}
          {e.status === 'pending' && approver ? (
            <>
              <Button variant="outline" onClick={() => setRejecting(true)}>
                <X />
                반려
              </Button>
              <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                <Check />
                승인
              </Button>
            </>
          ) : null}
          {e.status === 'posted' && writable && e.type !== 'opening' && e.type !== 'closing' ? (
            <Button variant="outline" onClick={() => setReversing(true)}>
              <Undo2 />
              역분개
            </Button>
          ) : null}
        </div>
      </div>

      {e.rejectionReason && e.status === 'draft' ? (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          반려됨: {e.rejectionReason}
        </p>
      ) : null}
      {e.reversedById ? (
        <p className="rounded-md border bg-surface-muted px-4 py-3 text-sm">
          이 전표는 역분개되었습니다.{' '}
          <Link
            className="text-primary hover:underline"
            href={`/accounting/journals/${e.reversedById}`}
          >
            역분개 전표 보기
          </Link>
        </p>
      ) : null}
      {e.reversalOfId ? (
        <p className="rounded-md border bg-surface-muted px-4 py-3 text-sm">
          다른 전표를 취소한 역분개 전표입니다.{' '}
          <Link
            className="text-primary hover:underline"
            href={`/accounting/journals/${e.reversalOfId}`}
          >
            원래 전표 보기
          </Link>
        </p>
      ) : null}

      {editable ? (
        <Card>
          <CardContent className="pt-5">
            <JournalEditor
              key={e.updatedAt}
              entry={e}
              onSaved={(saved) => queryClient.setQueryData(key, saved)}
            />
          </CardContent>
        </Card>
      ) : (
        <ReadOnlyEntry
          entry={e}
          canAttach={writable}
          onAttach={(fileIds) => attach.mutateAsync(fileIds).then(() => undefined)}
          onDetach={(fileId) => detach.mutateAsync(fileId).then(() => undefined)}
        />
      )}

      <p className="text-xs text-muted-foreground">
        작성 {e.createdByName ?? '—'} {dateTime.format(new Date(e.createdAt))}
        {e.submittedAt
          ? ` · 승인요청 ${e.submittedByName ?? ''} ${dateTime.format(new Date(e.submittedAt))}`
          : ''}
        {e.postedAt
          ? ` · 전기 ${e.postedByName ?? ''} ${dateTime.format(new Date(e.postedAt))}`
          : ''}
      </p>

      <RejectDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        onReject={(reason) =>
          apiFetch<JournalEntry>(`/journals/${id}/reject`, { method: 'POST', json: { reason } })
            .then((entry) => {
              done('반려했습니다.')(entry);
              setRejecting(false);
            })
            .catch((err: unknown) => {
              onError(err);
            })
        }
      />
      <ReverseDialog
        open={reversing}
        entryDate={e.entryDate}
        onClose={() => setReversing(false)}
        onReverse={(body) =>
          apiFetch<JournalEntry>(`/journals/${id}/reverse`, { method: 'POST', json: body })
            .then((reversal) => {
              done(`${reversal.number} 역분개 전표를 만들었습니다.`)();
              setReversing(false);
              router.push(`/accounting/journals/${reversal.id}`);
            })
            .catch((err: unknown) => {
              onError(err);
            })
        }
      />
    </div>
  );
}

function ReadOnlyEntry({
  entry: e,
  canAttach,
  onAttach,
  onDetach,
}: {
  entry: JournalEntry;
  canAttach: boolean;
  onAttach: (fileIds: string[]) => Promise<void>;
  onDetach: (fileId: string) => Promise<void>;
}) {
  const debit = e.lines.reduce((s, l) => s + l.debit, 0);
  const credit = e.lines.reduce((s, l) => s + l.credit, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {e.entryDate} {e.description ? `· ${e.description}` : ''}
        </CardTitle>
        {e.vat ? (
          <p className="text-sm text-muted-foreground">
            {VAT_TYPE_LABELS[e.vat.vatType]} · {EVIDENCE_TYPE_LABELS[e.vat.evidenceType]}
            {e.vat.partnerName ? ` · ${e.vat.partnerName}` : ''} · 공급가액{' '}
            {formatWon(e.vat.supplyAmount)} · 부가세 {formatWon(e.vat.vatAmount)}
            {e.vat.deductible ? '' : ' · 불공제'}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4 px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-5">#</TableHead>
              <TableHead>계정과목</TableHead>
              <TableHead>거래처</TableHead>
              <TableHead className="w-36 text-right">차변</TableHead>
              <TableHead className="w-36 text-right">대변</TableHead>
              <TableHead className="pr-5">적요</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {e.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="pl-5 text-xs text-muted-foreground">{l.lineNo}</TableCell>
                <TableCell>
                  <span className="mr-2 tabular-nums text-muted-foreground">{l.accountCode}</span>
                  {l.accountName}
                </TableCell>
                <TableCell>
                  {[l.partnerName, l.departmentName, l.projectName].filter(Boolean).join(' · ')}
                </TableCell>
                <TableCell className="text-right tabular-nums">{wonOrBlank(l.debit)}</TableCell>
                <TableCell className="text-right tabular-nums">{wonOrBlank(l.credit)}</TableCell>
                <TableCell className="pr-5">
                  {l.memo ?? ''}
                  {l.currency ? (
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {l.currency} {formatForeign(l.foreignAmount ?? '0')}
                      {l.exchangeRate ? ` @ ${trimRate(l.exchangeRate)}` : ''}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-surface-muted font-semibold">
              <TableCell className="pl-5" colSpan={3}>
                합계
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatWon(debit)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWon(credit)}</TableCell>
              <TableCell className="pr-5" />
            </TableRow>
          </TableBody>
        </Table>
        <div className="px-5">
          <AttachmentsField
            files={e.attachments}
            canAdd={canAttach}
            canRemove={canAttach && e.status === 'pending'}
            onAdd={(files) => onAttach(files.map((f) => f.id))}
            onRemove={(f) => onDetach(f.id)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function RejectDialog({
  open,
  onClose,
  onReject,
}: {
  open: boolean;
  onClose: () => void;
  onReject: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>전표 반려</DialogTitle>
          <DialogDescription>
            반려하면 작성중으로 돌아가고 사유가 작성자에게 보입니다.
          </DialogDescription>
        </DialogHeader>
        <FormField id="reject-reason" label="반려 사유">
          <Input
            id="reject-reason"
            maxLength={200}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button disabled={!reason.trim()} onClick={() => void onReject(reason.trim())}>
            반려
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({
  open,
  entryDate,
  onClose,
  onReverse,
}: {
  open: boolean;
  entryDate: string;
  onClose: () => void;
  onReverse: (body: { entryDate: string; description: string | null }) => Promise<void>;
}) {
  const today = todayIso();
  const [date, setDate] = useState(today < entryDate ? entryDate : today);
  const [description, setDescription] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>역분개</DialogTitle>
          <DialogDescription>
            차변과 대변을 바꾼 전표를 새로 만들어 이 전표를 취소합니다. 원래 전표는 그대로 남습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="reverse-date" label="역분개 일자">
            <Input
              id="reverse-date"
              type="date"
              min={entryDate}
              value={date}
              onChange={(ev) => setDate(ev.target.value)}
            />
          </FormField>
          <FormField id="reverse-description" label="적요(비우면 자동)">
            <Input
              id="reverse-description"
              maxLength={200}
              value={description}
              onChange={(ev) => setDescription(ev.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            onClick={() => void onReverse({ entryDate: date, description: description || null })}
          >
            역분개 전표 만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
