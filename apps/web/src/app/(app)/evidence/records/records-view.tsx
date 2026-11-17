'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EVIDENCE_STATUSES, type EvidenceStatus, type UploadKind } from '@wellbuddy/shared';
import { EyeOff, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { ApiError, apiFetch } from '@/lib/api';
import { formatWon, wonOrBlank } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  DIRECTION_LABELS,
  EVIDENCE_STATUS_LABELS,
  INVOICE_KIND_LABELS,
  KIND_SHORT_LABELS,
  STATUS_VARIANTS,
  USAGE_LABELS,
} from '../_components/evidence-format';
import { BANK_ACCOUNTS_KEY, CARDS_KEY } from '../sources/sources-manager';

interface Common {
  id: string;
  source: string;
  status: EvidenceStatus;
  entryId: string | null;
  entryNumber: string | null;
}
interface BankTx extends Common {
  bankAccountId: string;
  accountAlias: string;
  txDate: string;
  txTime: string | null;
  description: string;
  counterparty: string | null;
  deposit: number;
  withdrawal: number;
  balance: number | null;
}
interface CardTx extends Common {
  cardAlias: string;
  approvedDate: string;
  approvedTime: string | null;
  merchantName: string;
  merchantBizNo: string | null;
  amount: number;
  approvalNo: string;
  installmentMonths: number | null;
  cancelled: boolean;
}
interface TaxInvoice extends Common {
  direction: 'sales' | 'purchase';
  kind: 'tax' | 'zero' | 'exempt';
  approvalNo: string;
  issueDate: string;
  supplierName: string;
  buyerName: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  partnerName: string | null;
}
interface CashReceipt extends Common {
  direction: 'sales' | 'purchase';
  txDate: string;
  approvalNo: string;
  name: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  usage: 'income_deduction' | 'expense_proof';
  cancelled: boolean;
}

const PATHS: Record<UploadKind, string> = {
  bank: '/evidence/bank-transactions',
  card: '/evidence/card-transactions',
  tax_invoice: '/evidence/tax-invoices',
  cash_receipt: '/evidence/cash-receipts',
};

interface Filters {
  status: '' | EvidenceStatus;
  from: string;
  to: string;
  sourceId: string;
  direction: '' | 'sales' | 'purchase';
}

const onError = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

/** 수집한 통장·카드·세금계산서·현금영수증 조회와 제외 처리 */
export function RecordsView({ initialKind }: { initialKind: UploadKind }) {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<UploadKind>(initialKind);
  const [filters, setFilters] = useState<Filters>({
    status: '',
    from: '',
    to: '',
    sourceId: '',
    direction: '',
  });
  const banks = useQuery({
    queryKey: BANK_ACCOUNTS_KEY,
    queryFn: () => apiFetch<{ id: string; alias: string }[]>('/bank-accounts'),
    enabled: kind === 'bank',
  });
  const cards = useQuery({
    queryKey: CARDS_KEY,
    queryFn: () => apiFetch<{ id: string; alias: string }[]>('/corporate-cards'),
    enabled: kind === 'card',
  });

  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.sourceId && (kind === 'bank' || kind === 'card'))
    params.set('sourceId', filters.sourceId);
  if (filters.direction && (kind === 'tax_invoice' || kind === 'cash_receipt'))
    params.set('direction', filters.direction);
  const qs = params.toString();

  const list = useQuery({
    queryKey: ['evidence', kind, qs],
    queryFn: () => apiFetch<Common[]>(`${PATHS[kind]}${qs ? `?${qs}` : ''}`),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'pending' | 'ignored' }) =>
      apiFetch(`/evidence/${kind}/${id}/status`, { method: 'PATCH', json: { status } }),
    onSuccess: (_, v) => {
      toast.success(v.status === 'ignored' ? '제외했습니다.' : '되살렸습니다.');
      void queryClient.invalidateQueries({ queryKey: ['evidence', kind] });
    },
    onError,
  });

  const sources = kind === 'bank' ? banks.data : kind === 'card' ? cards.data : null;
  const rows = list.data ?? [];

  const action = (r: Common) =>
    writable && (r.status === 'pending' || r.status === 'ignored') ? (
      <Button
        variant="ghost"
        size="sm"
        disabled={setStatus.isPending}
        onClick={() =>
          setStatus.mutate({ id: r.id, status: r.status === 'ignored' ? 'pending' : 'ignored' })
        }
      >
        {r.status === 'ignored' ? <RotateCcw /> : <EyeOff />}
        {r.status === 'ignored' ? '되살리기' : '제외'}
      </Button>
    ) : null;

  const status = (r: Common) => (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant={STATUS_VARIANTS[r.status]}>{EVIDENCE_STATUS_LABELS[r.status]}</Badge>
      {r.entryId && r.entryNumber ? (
        <Link href={`/accounting/journals/${r.entryId}`} className="text-xs underline">
          {r.entryNumber}
        </Link>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="증빙 종류">
          {(Object.keys(PATHS) as UploadKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setFilters((f) => ({ ...f, sourceId: '', direction: '' }));
              }}
              className={cn(
                'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                kind === k
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {KIND_SHORT_LABELS[k]}
            </button>
          ))}
        </div>
        <Select
          aria-label="처리 상태"
          className="w-32"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value as EvidenceStatus })}
        >
          <option value="">전체 상태</option>
          {EVIDENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EVIDENCE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        {sources ? (
          <Select
            aria-label={kind === 'bank' ? '계좌' : '카드'}
            className="w-40"
            value={filters.sourceId}
            onChange={(e) => setFilters({ ...filters, sourceId: e.target.value })}
          >
            <option value="">{kind === 'bank' ? '전체 계좌' : '전체 카드'}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.alias}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            aria-label="매출·매입"
            className="w-32"
            value={filters.direction}
            onChange={(e) => setFilters({ ...filters, direction: e.target.value as 'sales' })}
          >
            <option value="">매출·매입</option>
            <option value="sales">매출</option>
            <option value="purchase">매입</option>
          </Select>
        )}
        <Input
          type="date"
          aria-label="시작일"
          className="w-40"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
        />
        <span className="pb-2 text-muted-foreground">~</span>
        <Input
          type="date"
          aria-label="종료일"
          className="w-40"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
        />
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href="/evidence/upload">파일 올리기</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        {kind === 'bank' ? (
          <BankTable rows={rows as BankTx[]} status={status} action={action} />
        ) : kind === 'card' ? (
          <CardTable rows={rows as CardTx[]} status={status} action={action} />
        ) : kind === 'tax_invoice' ? (
          <InvoiceTable rows={rows as TaxInvoice[]} status={status} action={action} />
        ) : (
          <CashReceiptTable rows={rows as CashReceipt[]} status={status} action={action} />
        )}
        {list.isSuccess && rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            수집한 {KIND_SHORT_LABELS[kind]} 자료가 없습니다.
          </p>
        ) : null}
        {rows.length >= 1000 ? (
          <p className="p-3 text-xs text-muted-foreground">
            최근 1,000건만 보여 줍니다. 기간을 좁혀 주세요.
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Render<T> = (r: T) => React.ReactNode;
interface TableProps<T> {
  rows: T[];
  status: Render<Common>;
  action: Render<Common>;
}

const dim = (r: Common) => cn(r.status === 'ignored' && 'text-muted-foreground line-through');
const time = (t: string | null) => (t ? t.slice(0, 5) : '');

function BankTable({ rows, status, action }: TableProps<BankTx>) {
  const sum = (key: 'deposit' | 'withdrawal') =>
    rows.filter((r) => r.status !== 'ignored').reduce((s, r) => s + r[key], 0);
  return (
    <Table aria-label="통장 거래">
      <TableHeader>
        <TableRow>
          <TableHead>거래일시</TableHead>
          <TableHead>계좌</TableHead>
          <TableHead>적요</TableHead>
          <TableHead>받는분·보낸분</TableHead>
          <TableHead className="text-right">입금</TableHead>
          <TableHead className="text-right">출금</TableHead>
          <TableHead className="text-right">잔액</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap tabular-nums">
              {r.txDate} {time(r.txTime)}
            </TableCell>
            <TableCell>{r.accountAlias}</TableCell>
            <TableCell className={dim(r)}>{r.description}</TableCell>
            <TableCell className={dim(r)}>{r.counterparty ?? ''}</TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {wonOrBlank(r.deposit)}
            </TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {wonOrBlank(r.withdrawal)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.balance === null ? '' : formatWon(r.balance)}
            </TableCell>
            <TableCell>{status(r)}</TableCell>
            <TableCell>{action(r)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      {rows.length ? (
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>합계(제외 건 빼고) {rows.length}건</TableCell>
            <TableCell className="text-right tabular-nums">{formatWon(sum('deposit'))}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatWon(sum('withdrawal'))}
            </TableCell>
            <TableCell colSpan={3} />
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
}

function CardTable({ rows, status, action }: TableProps<CardTx>) {
  return (
    <Table aria-label="카드 승인">
      <TableHeader>
        <TableRow>
          <TableHead>승인일시</TableHead>
          <TableHead>카드</TableHead>
          <TableHead>가맹점</TableHead>
          <TableHead>사업자번호</TableHead>
          <TableHead className="text-right">금액</TableHead>
          <TableHead>승인번호</TableHead>
          <TableHead>할부</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap tabular-nums">
              {r.approvedDate} {time(r.approvedTime)}
            </TableCell>
            <TableCell>{r.cardAlias}</TableCell>
            <TableCell className={dim(r)}>
              {r.merchantName}
              {r.cancelled ? (
                <Badge variant="danger" className="ml-2">
                  취소
                </Badge>
              ) : null}
            </TableCell>
            <TableCell className="tabular-nums">{r.merchantBizNo ?? ''}</TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {r.cancelled ? '-' : ''}
              {formatWon(r.amount)}
            </TableCell>
            <TableCell className="tabular-nums">{r.approvalNo}</TableCell>
            <TableCell>{r.installmentMonths ? `${r.installmentMonths}개월` : '일시불'}</TableCell>
            <TableCell>{status(r)}</TableCell>
            <TableCell>{action(r)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function InvoiceTable({ rows, status, action }: TableProps<TaxInvoice>) {
  return (
    <Table aria-label="세금계산서">
      <TableHeader>
        <TableRow>
          <TableHead>작성일</TableHead>
          <TableHead>구분</TableHead>
          <TableHead>거래처</TableHead>
          <TableHead>공급자</TableHead>
          <TableHead>공급받는자</TableHead>
          <TableHead className="text-right">공급가액</TableHead>
          <TableHead className="text-right">세액</TableHead>
          <TableHead className="text-right">합계</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap tabular-nums">{r.issueDate}</TableCell>
            <TableCell className="whitespace-nowrap">
              {DIRECTION_LABELS[r.direction]}
              {r.kind !== 'tax' ? (
                <span className="text-xs text-muted-foreground">
                  {' '}
                  ({INVOICE_KIND_LABELS[r.kind]})
                </span>
              ) : null}
            </TableCell>
            <TableCell>
              {r.partnerName ?? <span className="text-xs text-warning">미등록</span>}
            </TableCell>
            <TableCell className={dim(r)}>{r.supplierName}</TableCell>
            <TableCell className={dim(r)}>{r.buyerName}</TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {formatWon(r.supplyAmount)}
            </TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {formatWon(r.vatAmount)}
            </TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {formatWon(r.totalAmount)}
            </TableCell>
            <TableCell>{status(r)}</TableCell>
            <TableCell>{action(r)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CashReceiptTable({ rows, status, action }: TableProps<CashReceipt>) {
  return (
    <Table aria-label="현금영수증">
      <TableHeader>
        <TableRow>
          <TableHead>거래일</TableHead>
          <TableHead>구분</TableHead>
          <TableHead>가맹점·상대</TableHead>
          <TableHead>승인번호</TableHead>
          <TableHead className="text-right">공급가액</TableHead>
          <TableHead className="text-right">부가세</TableHead>
          <TableHead className="text-right">합계</TableHead>
          <TableHead>용도</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap tabular-nums">{r.txDate}</TableCell>
            <TableCell>{DIRECTION_LABELS[r.direction]}</TableCell>
            <TableCell className={dim(r)}>
              {r.name}
              {r.cancelled ? (
                <Badge variant="danger" className="ml-2">
                  취소
                </Badge>
              ) : null}
            </TableCell>
            <TableCell className="tabular-nums">{r.approvalNo}</TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {formatWon(r.supplyAmount)}
            </TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {formatWon(r.vatAmount)}
            </TableCell>
            <TableCell className={cn('text-right tabular-nums', dim(r))}>
              {formatWon(r.totalAmount)}
            </TableCell>
            <TableCell>{USAGE_LABELS[r.usage]}</TableCell>
            <TableCell>{status(r)}</TableCell>
            <TableCell>{action(r)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
