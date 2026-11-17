'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BizNoStatus,
  EVIDENCE_STATUSES,
  type EvidenceStatus,
  formatBizRegNo,
  getProvider,
} from '@wellbuddy/shared';
import { FileImage, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { type DragEvent, type FormEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { formatWon } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  BIZ_NO_STATUS_LABELS,
  BIZ_NO_STATUS_VARIANTS,
  EVIDENCE_STATUS_LABELS,
  parseWonInput,
  receiptUploadSummary,
  STATUS_VARIANTS,
} from '../_components/evidence-format';

interface Receipt {
  id: string;
  fileId: string | null;
  filename: string | null;
  txDate: string | null;
  merchantName: string | null;
  bizNo: string | null;
  bizNoStatus: BizNoStatus | null;
  totalAmount: number | null;
  vatAmount: number | null;
  ocrProvider: string | null;
  ocrError: string | null;
  confidence: number | null;
  card: { id: string; merchantName: string; approvalNo: string; approvedDate: string } | null;
  status: EvidenceStatus;
  entryId: string | null;
  entryNumber: string | null;
}

type ReceiptResult = Receipt & { message: string | null };
type UploadResult = ReceiptResult & { duplicate: boolean };

const KEY = ['evidence', 'receipts'];
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff,application/pdf';

const UPLOAD_HELP =
  '사진(JPG·PNG·HEIC)이나 PDF 를 올리면 설정 > 연동관리에서 고른 OCR 로 날짜·가맹점·금액·사업자번호를 읽습니다. ' +
  '카드로 결제한 영수증은 자동분개를 실행할 때 카드 승인과 짝지어집니다.';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const receiptName = (r: Receipt) => r.merchantName ?? r.filename ?? '영수증';

/** 영수증(P2-18): 사진·PDF 를 올리면 OCR 로 읽어 증빙으로 등록하고, 사업자번호를 확인한다 */
export function ReceiptsView() {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'' | EvidenceStatus>('');
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const all = useQuery({ queryKey: KEY, queryFn: () => apiFetch<Receipt[]>('/evidence/receipts') });
  const rows = (all.data ?? []).filter((r) => !status || r.status === status);
  const count = (s: EvidenceStatus) => all.data?.filter((r) => r.status === s).length ?? 0;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['evidence'] });

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || progress) return;
    const results: UploadResult[] = [];
    let failed = 0;
    for (const [i, file] of files.entries()) {
      setProgress(`${files.length}장 중 ${i + 1}장째 읽는 중…`);
      const form = new FormData();
      form.append('file', file);
      try {
        results.push(
          await apiFetch<UploadResult>('/evidence/receipts', { method: 'POST', body: form }),
        );
      } catch (e) {
        failed += 1;
        toast.error(`${file.name}: ${errorText(e, '올리지 못했습니다.')}`);
      }
    }
    setProgress(null);
    refresh();
    if (results.length > 0) toast.success(receiptUploadSummary(results, failed));
    const only = results.length === 1 ? results[0] : undefined;
    if (only?.message && !only.duplicate) toast.info(only.message);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (writable) void uploadFiles([...e.dataTransfer.files]);
  };

  const verify = useMutation({
    mutationFn: (id: string) =>
      apiFetch<ReceiptResult>(`/evidence/receipts/${id}/verify-biz-no`, { method: 'POST' }),
    onSuccess: (r) => {
      refresh();
      toast.success(
        `사업자번호: ${r.bizNoStatus ? BIZ_NO_STATUS_LABELS[r.bizNoStatus] : '확인 못함'}`,
      );
      if (r.message) toast.info(r.message);
    },
    onError: (e) => toast.error(errorText(e, '확인하지 못했습니다.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/evidence/receipts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success('영수증을 지웠습니다.');
    },
    onError: (e) => toast.error(errorText(e, '지우지 못했습니다.')),
  });

  const chip = (value: '' | EvidenceStatus, label: string, n: number) => (
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
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );

  return (
    <div className="grid gap-6">
      {writable ? (
        <Card>
          <CardHeader>
            <CardTitle>영수증 올리기</CardTitle>
            <CardDescription>{UPLOAD_HELP}</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-6 text-center text-sm text-muted-foreground',
                dragging && 'border-primary bg-primary-soft',
              )}
            >
              <FileImage className="size-8" aria-hidden />
              <p>
                영수증 파일을 여기에 끌어 놓거나 골라 주세요. 여러 장을 한 번에 올릴 수 있습니다.
              </p>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                aria-label="영수증 파일"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  void uploadFiles(files);
                }}
              />
              <Button
                type="button"
                disabled={progress !== null}
                onClick={() => fileInput.current?.click()}
              >
                <Upload /> 파일 고르기
              </Button>
              {progress ? (
                <p role="status" className="text-foreground">
                  {progress}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="처리 상태">
          {chip('', '전체', all.data?.length ?? 0)}
          {EVIDENCE_STATUSES.map((s) => chip(s, EVIDENCE_STATUS_LABELS[s], count(s)))}
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="영수증">
            <TableHeader>
              <TableRow>
                <TableHead>거래일</TableHead>
                <TableHead>가맹점</TableHead>
                <TableHead>사업자번호</TableHead>
                <TableHead className="text-right">합계</TableHead>
                <TableHead className="text-right">부가세</TableHead>
                <TableHead>인식</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>원본</TableHead>
                {writable ? <TableHead className="sr-only">작업</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {all.isLoading ? '불러오는 중…' : '올린 영수증이 없습니다.'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const locked = r.status === 'matched' || r.status === 'posted';
                  return (
                    <TableRow key={r.id} aria-label={receiptName(r)}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {r.txDate ?? '—'}
                      </TableCell>
                      <TableCell>{r.merchantName ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.bizNo ? (
                          <span className="tabular-nums">{formatBizRegNo(r.bizNo)}</span>
                        ) : (
                          '—'
                        )}
                        {r.bizNoStatus ? (
                          <Badge variant={BIZ_NO_STATUS_VARIANTS[r.bizNoStatus]} className="ml-1">
                            {BIZ_NO_STATUS_LABELS[r.bizNoStatus]}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.totalAmount === null ? '—' : formatWon(r.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.vatAmount === null ? '—' : formatWon(r.vatAmount)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.ocrError ? (
                          <span className="text-danger" title={r.ocrError}>
                            읽지 못함
                          </span>
                        ) : r.ocrProvider ? (
                          <span>
                            {getProvider('ocr', r.ocrProvider)?.label ?? r.ocrProvider}
                            {r.confidence !== null ? (
                              <span className="ml-1 tabular-nums text-muted-foreground">
                                {Math.round(r.confidence * 100)}%
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">직접 입력</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={STATUS_VARIANTS[r.status]}>
                          {r.status === 'matched'
                            ? '카드와 짝지음'
                            : EVIDENCE_STATUS_LABELS[r.status]}
                        </Badge>
                        {r.card ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            승인 {r.card.approvalNo}
                          </span>
                        ) : null}
                        {r.entryId && r.entryNumber ? (
                          <Link
                            href={`/accounting/journals/${r.entryId}`}
                            className="ml-1 text-xs text-primary underline-offset-2 hover:underline"
                          >
                            {r.entryNumber}
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {r.fileId ? (
                          <a
                            href={`/api/files/${r.fileId}/download`}
                            className="text-sm text-primary underline-offset-2 hover:underline"
                            aria-label={`${receiptName(r)} 원본 내려받기`}
                          >
                            원본
                          </a>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      {writable ? (
                        <TableCell className="whitespace-nowrap pr-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${receiptName(r)} 수정`}
                            disabled={locked}
                            onClick={() => setEditing(r)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${receiptName(r)} 사업자번호 다시 확인`}
                            disabled={!r.bizNo || verify.isPending}
                            onClick={() => verify.mutate(r.id)}
                          >
                            <RefreshCw />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${receiptName(r)} 삭제`}
                            disabled={locked || remove.isPending}
                            onClick={() => {
                              if (confirm(`'${receiptName(r)}' 영수증을 지울까요?`)) {
                                remove.mutate(r.id);
                              }
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <ReceiptDialog receipt={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}

function ReceiptDialog({
  receipt,
  onClose,
  onSaved,
}: {
  receipt: Receipt | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={receipt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>영수증 수정</DialogTitle>
          <DialogDescription>
            영수증에 적힌 값과 다르면 고쳐 주세요. 사업자번호를 바꾸면 다시 확인합니다.
          </DialogDescription>
        </DialogHeader>
        {receipt ? (
          <ReceiptForm key={receipt.id} receipt={receipt} onClose={onClose} onSaved={onSaved} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReceiptForm({
  receipt,
  onClose,
  onSaved,
}: {
  receipt: Receipt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [txDate, setTxDate] = useState(receipt.txDate ?? '');
  const [merchantName, setMerchantName] = useState(receipt.merchantName ?? '');
  const [bizNo, setBizNo] = useState(receipt.bizNo ? formatBizRegNo(receipt.bizNo) : '');
  const [total, setTotal] = useState(receipt.totalAmount?.toString() ?? '');
  const [vat, setVat] = useState(receipt.vatAmount?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: object) =>
      apiFetch<ReceiptResult>(`/evidence/receipts/${receipt.id}`, { method: 'PATCH', json: body }),
    onSuccess: (r) => {
      onSaved();
      toast.success('영수증을 고쳤습니다.');
      if (r.message) toast.info(r.message);
      onClose();
    },
    onError: (e) => setError(errorText(e, '저장하지 못했습니다.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const totalAmount = parseWonInput(total);
    const vatAmount = parseWonInput(vat);
    if (Number.isNaN(totalAmount) || Number.isNaN(vatAmount)) {
      setError('금액은 숫자로 입력해 주세요.');
      return;
    }
    setError(null);
    save.mutate({
      txDate: txDate || null,
      merchantName: merchantName.trim() || null,
      bizNo: bizNo.trim() || null,
      totalAmount,
      vatAmount,
    });
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="receipt-date" label="거래일">
          <Input
            id="receipt-date"
            type="date"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
          />
        </FormField>
        <FormField id="receipt-bizno" label="사업자번호">
          <Input
            id="receipt-bizno"
            inputMode="numeric"
            placeholder="123-45-67890"
            value={bizNo}
            onChange={(e) => setBizNo(e.target.value)}
          />
        </FormField>
      </div>
      <FormField id="receipt-merchant" label="가맹점">
        <Input
          id="receipt-merchant"
          maxLength={100}
          value={merchantName}
          onChange={(e) => setMerchantName(e.target.value)}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="receipt-total" label="합계(부가세 포함)">
          <Input
            id="receipt-total"
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </FormField>
        <FormField id="receipt-vat" label="부가세">
          <Input
            id="receipt-vat"
            inputMode="numeric"
            value={vat}
            onChange={(e) => setVat(e.target.value)}
          />
        </FormField>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? '저장 중…' : '저장'}
        </Button>
      </DialogFooter>
    </form>
  );
}
