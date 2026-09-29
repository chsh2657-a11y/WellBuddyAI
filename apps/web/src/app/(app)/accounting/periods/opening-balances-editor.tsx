'use client';

import { STATEMENT_GROUPS } from '@wellbuddy/accounting-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { WonInput } from '@/components/won-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { formatWon } from '@/lib/format';
import type { Account } from '../accounts/accounts-manager';
import type { Partner } from '../partners/partners-manager';
import type { FiscalYear } from './periods-manager';

interface OpeningBalances {
  fiscalYearId: string;
  entryId: string | null;
  source: 'manual' | 'carry_forward' | null;
  locked: boolean;
  lines: {
    accountId: string;
    partnerId: string | null;
    debit: number;
    credit: number;
  }[];
}

interface Row {
  key: number;
  accountId: string;
  partnerId: string;
  debit: number;
  credit: number;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, accountId: '', partnerId: '', debit: 0, credit: 0 });

/** 회계연도 첫날의 재무상태표 계정 잔액(기초잔액). 차변 합계와 대변 합계가 같아야 저장된다. */
export function OpeningBalancesEditor({
  year,
  writable,
  onSaved,
}: {
  year: FiscalYear;
  writable: boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ['opening-balances', year.id];
  const opening = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<OpeningBalances>(`/fiscal-years/${year.id}/opening-balances`),
  });
  const accounts = useQuery({
    queryKey: ['accounts', { includeInactive: false }],
    queryFn: () => apiFetch<Account[]>('/accounts?includeInactive=false'),
  });
  const partners = useQuery({
    queryKey: ['partners', 'active'],
    queryFn: () => apiFetch<Partner[]>('/partners'),
  });
  const bsAccounts = useMemo(
    () => (accounts.data ?? []).filter((a) => STATEMENT_GROUPS[a.group].statement === 'BS'),
    [accounts.data],
  );

  if (!opening.data) return null;
  return (
    <OpeningForm
      // 서버 값이 바뀌면(저장·전기이월) 입력 상태를 새로 만든다
      key={`${year.id}:${opening.dataUpdatedAt}`}
      year={year}
      data={opening.data}
      accounts={bsAccounts}
      partners={partners.data ?? []}
      writable={writable}
      onSaved={(data) => {
        queryClient.setQueryData(key, data);
        onSaved();
      }}
    />
  );
}

function OpeningForm({
  year,
  data,
  accounts,
  partners,
  writable,
  onSaved,
}: {
  year: FiscalYear;
  data: OpeningBalances;
  accounts: Account[];
  partners: Partner[];
  writable: boolean;
  onSaved: (data: OpeningBalances) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    data.lines.length > 0
      ? data.lines.map((l) => ({
          key: nextKey++,
          accountId: l.accountId,
          partnerId: l.partnerId ?? '',
          debit: l.debit,
          credit: l.credit,
        }))
      : [emptyRow(), emptyRow()],
  );
  const filled = rows.filter((r) => r.accountId && (r.debit > 0 || r.credit > 0));
  const debit = filled.reduce((s, r) => s + r.debit, 0);
  const credit = filled.reduce((s, r) => s + r.credit, 0);
  const locked = data.locked;
  const editable = writable && !locked;

  const save = useMutation({
    mutationFn: () =>
      apiFetch<OpeningBalances>(`/fiscal-years/${year.id}/opening-balances`, {
        method: 'PUT',
        json: {
          lines: filled.map((r) => ({
            accountId: r.accountId,
            partnerId: r.partnerId || null,
            debit: r.debit,
            credit: r.credit,
          })),
        },
      }),
    onSuccess: (saved) => {
      onSaved(saved);
      toast.success('기초잔액을 저장했습니다.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  const update = (k: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <div className="grid gap-1">
          <CardTitle>기초잔액 ({year.startDate})</CardTitle>
          <CardDescription>
            처음 쓰기 시작할 때 재무상태표 계정의 잔액을 입력합니다. 외상매출금·외상매입금은
            거래처별로 나눠 입력하면 거래처원장에 이어집니다.
          </CardDescription>
        </div>
        <div className="ml-auto flex gap-2">
          {data.source === 'carry_forward' ? (
            <Badge variant="muted">전기이월로 입력됨</Badge>
          ) : null}
          {locked ? <Badge variant="muted">첫 달 마감됨</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">계정과목</TableHead>
              <TableHead className="w-56">거래처</TableHead>
              <TableHead className="w-40 text-right">차변</TableHead>
              <TableHead className="w-40 text-right">대변</TableHead>
              {editable ? <TableHead className="w-12 pr-5" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.key}>
                <TableCell className="pl-5">
                  <Select
                    aria-label={`${i + 1}행 계정과목`}
                    value={r.accountId}
                    disabled={!editable}
                    onChange={(e) => update(r.key, { accountId: e.target.value })}
                  >
                    <option value="">계정 선택</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    aria-label={`${i + 1}행 거래처`}
                    value={r.partnerId}
                    disabled={!editable}
                    onChange={(e) => update(r.key, { partnerId: e.target.value })}
                  >
                    <option value="">(거래처 없음)</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <WonInput
                    aria-label={`${i + 1}행 차변`}
                    value={r.debit}
                    disabled={!editable}
                    onValueChange={(v) =>
                      update(r.key, { debit: v, ...(v > 0 ? { credit: 0 } : {}) })
                    }
                  />
                </TableCell>
                <TableCell>
                  <WonInput
                    aria-label={`${i + 1}행 대변`}
                    value={r.credit}
                    disabled={!editable}
                    onValueChange={(v) =>
                      update(r.key, { credit: v, ...(v > 0 ? { debit: 0 } : {}) })
                    }
                  />
                </TableCell>
                {editable ? (
                  <TableCell className="pr-5">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${i + 1}행 삭제`}
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-5 font-medium" colSpan={2}>
                합계
                {debit !== credit ? (
                  <span className="ml-3 text-danger" role="status">
                    차액 {formatWon(Math.abs(debit - credit))}원
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatWon(debit)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatWon(credit)}
              </TableCell>
              {editable ? <TableCell className="pr-5" /> : null}
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
      {editable ? (
        <CardFooter className="justify-between gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, emptyRow()])}>
            <Plus />줄 추가
          </Button>
          <Button
            disabled={save.isPending || debit !== credit || filled.length === 1}
            onClick={() => save.mutate()}
          >
            {save.isPending ? '저장 중…' : '기초잔액 저장'}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
