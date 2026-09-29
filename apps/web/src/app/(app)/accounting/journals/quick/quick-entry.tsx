'use client';

import { SYSTEM_ACCOUNTS } from '@wellbuddy/accounting-core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { WonInput } from '@/components/won-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, apiFetch } from '@/lib/api';
import { formatWon, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { JOURNALS_KEY } from '../_components/journal-editor';
import type { JournalEntry } from '../_components/types';
import { type MasterData, useMasterData } from '../_components/use-master-data';

type Kind = 'receipt' | 'payment';
type Col = 'date' | 'counter' | 'partner' | 'amount' | 'memo';

interface Row {
  key: number;
  entryDate: string;
  counterId: string | null;
  partnerId: string | null;
  amount: number;
  memo: string;
  error?: string;
}

let nextKey = 1;
const newRow = (entryDate: string): Row => ({
  key: nextKey++,
  entryDate,
  counterId: null,
  partnerId: null,
  amount: 0,
  memo: '',
});

/** 현금·예금 계정(입출금 기준 계정 후보) */
const CASH_CODES = [SYSTEM_ACCOUNTS.cash, '102', SYSTEM_ACCOUNTS.bankDeposit];

export function QuickEntry() {
  const data = useMasterData();
  if (!data.ready) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  return <QuickForm data={data} />;
}

/**
 * 입금·출금 간편 입력: 한 줄이 전표 한 장이 된다.
 * 입금 (차) 현금·예금 / (대) 상대 계정, 출금 (차) 상대 계정 / (대) 현금·예금
 */
function QuickForm({ data }: { data: MasterData }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const manager = session?.role === 'owner' || session?.role === 'admin';
  const canPost = !session?.company?.journalApprovalRequired || manager;
  const cashAccounts = CASH_CODES.flatMap((c) => data.accountByCode.get(c) ?? []);

  const [kind, setKind] = useState<Kind>('receipt');
  const [cashId, setCashId] = useState(cashAccounts[0]?.id ?? '');
  const [rows, setRows] = useState<Row[]>(() => [newRow(todayIso())]);

  const cells = useRef(new Map<string, { focus: () => void }>());
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    cells.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  const register = (key: number, col: Col) => (el: { focus: () => void } | null) => {
    if (el) cells.current.set(`${key}:${col}`, el);
    else cells.current.delete(`${key}:${col}`);
  };
  const focus = (key: number, col: Col) => {
    const cell = cells.current.get(`${key}:${col}`);
    if (cell) cell.focus();
    else pendingFocus.current = `${key}:${col}`;
  };

  const update = (row: Row) => setRows((prev) => prev.map((r) => (r.key === row.key ? row : r)));
  const advance = (index: number, from: Col, row: Row) => {
    const order: Col[] = ['date', 'counter', 'partner', 'amount', 'memo'];
    const account = row.counterId ? data.accountById.get(row.counterId) : undefined;
    let target = order[order.indexOf(from) + 1];
    if (target === 'partner' && !account?.requiresPartner && !row.partnerId) target = 'amount';
    if (target) return focus(row.key, target);
    const next = rows[index + 1];
    if (next) return focus(next.key, 'counter');
    const added = newRow(row.entryDate);
    setRows((prev) => [...prev.map((r) => (r.key === row.key ? row : r)), added]);
    pendingFocus.current = `${added.key}:counter`;
  };
  const onEnter = (index: number, col: Col) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    advance(index, col, rows[index]!);
  };

  const filled = rows.filter((r) => r.counterId && r.amount > 0);
  const total = filled.reduce((s, r) => s + r.amount, 0);

  const save = useMutation({
    mutationFn: async (status: 'draft' | 'pending' | 'posted') => {
      const results = new Map<number, string | null>();
      for (const r of filled) {
        const memo = r.memo || null;
        const counter = {
          accountId: r.counterId!,
          partnerId: r.partnerId,
          memo,
        };
        const cash = { accountId: cashId, memo };
        const lines =
          kind === 'receipt'
            ? [
                { ...cash, debit: r.amount, credit: 0 },
                { ...counter, debit: 0, credit: r.amount },
              ]
            : [
                { ...counter, debit: r.amount, credit: 0 },
                { ...cash, debit: 0, credit: r.amount },
              ];
        try {
          await apiFetch<JournalEntry>('/journals', {
            method: 'POST',
            json: {
              entry: { entryDate: r.entryDate, type: kind, description: memo, lines },
              status,
            },
          });
          results.set(r.key, null);
        } catch (e) {
          results.set(r.key, e instanceof ApiError ? e.message : '저장하지 못했습니다.');
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const failed = [...results.values()].filter(Boolean).length;
      const ok = results.size - failed;
      void queryClient.invalidateQueries({ queryKey: JOURNALS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
      setRows((prev) => {
        const left = prev
          .filter((r) => results.get(r.key) !== null)
          .map((r) => ({ ...r, error: results.get(r.key) ?? undefined }));
        return left.length > 0 ? left : [newRow(prev.at(-1)?.entryDate ?? todayIso())];
      });
      if (ok) toast.success(`${ok}건을 저장했습니다.`);
      if (failed) toast.error(`${failed}건은 저장하지 못했습니다. 줄의 오류를 확인해 주세요.`);
    },
  });

  const counterLabel = kind === 'receipt' ? '입금 내용(대변 계정)' : '출금 내용(차변 계정)';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border p-0.5" role="tablist" aria-label="입출금 구분">
          {(
            [
              ['receipt', '입금'],
              ['payment', '출금'],
            ] as const
          ).map(([k, label]) => (
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
              {label}
            </button>
          ))}
        </div>
        <Select
          aria-label="현금·예금 계정"
          className="w-44"
          value={cashId}
          onChange={(e) => setCashId(e.target.value)}
        >
          {cashAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          한 줄이 전표 한 장이 됩니다. Enter 로 다음 칸, 마지막 칸에서 Enter 면 새 줄.
        </p>
      </div>

      <div className="w-full overflow-x-auto rounded-md border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-surface-muted text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-40 px-2 py-2 text-left font-medium">일자</th>
              <th className="w-60 px-1 py-2 text-left font-medium">{counterLabel}</th>
              <th className="w-48 px-1 py-2 text-left font-medium">거래처</th>
              <th className="w-40 px-1 py-2 text-right font-medium">금액</th>
              <th className="px-1 py-2 text-left font-medium">적요</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const account = r.counterId ? data.accountById.get(r.counterId) : undefined;
              return (
                <tr key={r.key} className="border-b last:border-0 align-top">
                  <td className="px-2 py-1">
                    <Input
                      ref={register(r.key, 'date')}
                      type="date"
                      aria-label={`${i + 1}행 일자`}
                      className="h-9"
                      value={r.entryDate}
                      onChange={(e) => update({ ...r, entryDate: e.target.value })}
                      onKeyDown={onEnter(i, 'date')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <Combobox
                      ref={register(r.key, 'counter')}
                      aria-label={`${i + 1}행 계정과목`}
                      placeholder="코드·이름·초성"
                      items={data.accountItems}
                      value={r.counterId}
                      onChange={(id, viaEnter) => {
                        const row = { ...r, counterId: id };
                        update(row);
                        if (viaEnter) advance(i, 'counter', row);
                      }}
                      onEnter={() => advance(i, 'counter', r)}
                    />
                    {r.error ? (
                      <p role="alert" className="mt-1 text-xs text-danger">
                        {r.error}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-1 py-1">
                    <Combobox
                      ref={register(r.key, 'partner')}
                      aria-label={`${i + 1}행 거래처`}
                      placeholder={account?.requiresPartner ? '거래처 필수' : ''}
                      items={data.partnerItems}
                      value={r.partnerId}
                      invalid={!!account?.requiresPartner && !r.partnerId && r.amount > 0}
                      onChange={(id, viaEnter) => {
                        const row = { ...r, partnerId: id };
                        update(row);
                        if (viaEnter) advance(i, 'partner', row);
                      }}
                      onEnter={() => advance(i, 'partner', r)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <WonInput
                      ref={register(r.key, 'amount')}
                      aria-label={`${i + 1}행 금액`}
                      className="h-9"
                      value={r.amount}
                      onFocus={(e) => e.currentTarget.select()}
                      onValueChange={(amount) => update({ ...r, amount })}
                      onKeyDown={onEnter(i, 'amount')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <Input
                      ref={register(r.key, 'memo')}
                      aria-label={`${i + 1}행 적요`}
                      className="h-9"
                      maxLength={200}
                      value={r.memo}
                      onChange={(e) => update({ ...r, memo: e.target.value })}
                      onKeyDown={onEnter(i, 'memo')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    {rows.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        tabIndex={-1}
                        aria-label={`${i + 1}행 삭제`}
                        onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const added = newRow(rows.at(-1)?.entryDate ?? todayIso());
            setRows((prev) => [...prev, added]);
            pendingFocus.current = `${added.key}:counter`;
          }}
        >
          <Plus />줄 추가
        </Button>
        <span className="ml-auto text-sm">
          {filled.length}건 · 합계 <strong className="tabular-nums">{formatWon(total)}</strong>원
        </span>
        <Button
          variant="outline"
          disabled={save.isPending || filled.length === 0 || !cashId}
          onClick={() => save.mutate('draft')}
        >
          작성중 저장
        </Button>
        <Button
          variant={canPost ? 'outline' : 'default'}
          disabled={save.isPending || filled.length === 0 || !cashId}
          onClick={() => save.mutate('pending')}
        >
          승인요청
        </Button>
        {canPost ? (
          <Button
            disabled={save.isPending || filled.length === 0 || !cashId}
            onClick={() => save.mutate('posted')}
          >
            {save.isPending ? '저장 중…' : '전기'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
