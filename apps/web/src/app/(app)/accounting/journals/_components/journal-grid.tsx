'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { Combobox } from '@/components/combobox';
import { WonInput } from '@/components/won-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { formatWon } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type GridLine, newGridLine } from './types';
import type { MasterData } from './use-master-data';

type Col = 'account' | 'partner' | 'department' | 'project' | 'debit' | 'credit' | 'memo';

interface Focusable {
  focus: () => void;
}

interface Props {
  lines: GridLine[];
  onChange: (lines: GridLine[]) => void;
  data: MasterData;
  disabled?: boolean;
  /** Ctrl+Enter */
  onSubmit?: () => void;
}

export function gridTotals(lines: readonly GridLine[]) {
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  return { debit, credit, difference: debit - credit };
}

/**
 * 키보드 중심 분개 입력 그리드.
 * - Enter: 다음 칸(거래처가 필요 없는 계정은 거래처 칸을 건너뜀), 마지막 칸에서 Enter 면 다음 줄
 * - 새 줄(또는 비어 있는 다음 줄)은 차액을 반대편 금액에 미리 채우고, 앞 줄의 적요를 이어받는다
 * - Ctrl+Enter: 저장
 */
export function JournalGrid({ lines, onChange, data, disabled, onSubmit }: Props) {
  const showDimensions = data.departmentItems.length > 0 || data.projectItems.length > 0;
  const cells = useRef(new Map<string, Focusable>());
  const pendingFocus = useRef<string | null>(null);

  // 새 줄을 만든 뒤에는 렌더가 끝나야 칸이 생기므로, 렌더 후에 포커스한다
  useEffect(() => {
    if (!pendingFocus.current) return;
    cells.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  const register = (key: number, col: Col) => (el: Focusable | null) => {
    const id = `${key}:${col}`;
    if (el) cells.current.set(id, el);
    else cells.current.delete(id);
  };
  const focus = (key: number, col: Col) => {
    const cell = cells.current.get(`${key}:${col}`);
    if (cell) cell.focus();
    else pendingFocus.current = `${key}:${col}`;
  };

  const replace = (current: GridLine) => lines.map((l) => (l.key === current.key ? current : l));
  const update = (current: GridLine) => onChange(replace(current));

  const amountCol = (l: GridLine): Col => (l.credit > 0 ? 'credit' : 'debit');

  const advance = (index: number, from: Col, current: GridLine) => {
    const account = current.accountId ? data.accountById.get(current.accountId) : undefined;
    const needsDept = showDimensions && !!account?.requiresDepartment;
    let target: Col | null = null;
    if (from === 'account') {
      target =
        account?.requiresPartner || current.partnerId
          ? 'partner'
          : needsDept
            ? 'department'
            : amountCol(current);
    } else if (from === 'partner') target = needsDept ? 'department' : amountCol(current);
    else if (from === 'department') target = 'project';
    else if (from === 'project') target = amountCol(current);
    else if (from === 'debit') target = current.debit > 0 ? 'memo' : 'credit';
    else if (from === 'credit') target = 'memo';
    if (target) return focus(current.key, target);

    // 다음 줄로: 비어 있는 줄이면 차액을 반대편 금액에 미리 채우고 앞 줄의 적요를 이어받는다
    const updated = replace(current);
    const { difference } = gridTotals(updated);
    const prefill = {
      memo: current.memo,
      ...(difference > 0 ? { credit: difference } : difference < 0 ? { debit: -difference } : {}),
    };
    const next = lines[index + 1];
    if (next) {
      const empty = !next.accountId && next.debit === 0 && next.credit === 0 && !next.memo;
      if (empty) onChange(updated.map((l) => (l.key === next.key ? { ...l, ...prefill } : l)));
      return focus(next.key, 'account');
    }
    const added = newGridLine(prefill);
    onChange([...updated, added]);
    pendingFocus.current = `${added.key}:account`;
  };

  const onEnter = (index: number, col: Col) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    advance(index, col, lines[index]!);
  };

  const totals = gridTotals(lines);

  return (
    <div
      className="grid gap-2"
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
          e.preventDefault();
          e.stopPropagation();
          onSubmit();
        }
      }}
    >
      <div className="w-full overflow-x-auto rounded-md border">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-surface-muted text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-10 px-2 py-2 text-center font-medium">#</th>
              <th className="w-60 px-1 py-2 text-left font-medium">계정과목</th>
              <th className="w-48 px-1 py-2 text-left font-medium">거래처</th>
              {showDimensions ? (
                <>
                  <th className="w-36 px-1 py-2 text-left font-medium">부서</th>
                  <th className="w-36 px-1 py-2 text-left font-medium">프로젝트</th>
                </>
              ) : null}
              <th className="w-36 px-3 py-2 text-right font-medium">차변</th>
              <th className="w-36 px-3 py-2 text-right font-medium">대변</th>
              <th className="px-3 py-2 text-left font-medium">적요</th>
              <th className="w-10 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const account = line.accountId ? data.accountById.get(line.accountId) : undefined;
              const hasAmount = line.debit > 0 || line.credit > 0;
              return (
                <tr key={line.key} className="border-b last:border-0">
                  <td className="px-2 text-center text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-1 py-1">
                    <Combobox
                      ref={register(line.key, 'account')}
                      aria-label={`${i + 1}행 계정과목`}
                      placeholder="코드·이름·초성"
                      items={data.accountItems}
                      value={line.accountId}
                      disabled={disabled}
                      invalid={hasAmount && !line.accountId}
                      onChange={(id, viaEnter) => {
                        const current = { ...line, accountId: id };
                        update(current);
                        if (viaEnter) advance(i, 'account', current);
                      }}
                      onEnter={() => advance(i, 'account', line)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <Combobox
                      ref={register(line.key, 'partner')}
                      aria-label={`${i + 1}행 거래처`}
                      placeholder={account?.requiresPartner ? '거래처 필수' : ''}
                      items={data.partnerItems}
                      value={line.partnerId}
                      disabled={disabled}
                      invalid={!!account?.requiresPartner && !line.partnerId && hasAmount}
                      onChange={(id, viaEnter) => {
                        const current = { ...line, partnerId: id };
                        update(current);
                        if (viaEnter) advance(i, 'partner', current);
                      }}
                      onEnter={() => advance(i, 'partner', line)}
                    />
                  </td>
                  {showDimensions ? (
                    <>
                      <td className="px-1 py-1">
                        <Combobox
                          ref={register(line.key, 'department')}
                          aria-label={`${i + 1}행 부서`}
                          items={data.departmentItems}
                          value={line.departmentId}
                          disabled={disabled}
                          invalid={!!account?.requiresDepartment && !line.departmentId && hasAmount}
                          onChange={(id, viaEnter) => {
                            const current = { ...line, departmentId: id };
                            update(current);
                            if (viaEnter) advance(i, 'department', current);
                          }}
                          onEnter={() => advance(i, 'department', line)}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Combobox
                          ref={register(line.key, 'project')}
                          aria-label={`${i + 1}행 프로젝트`}
                          items={data.projectItems}
                          value={line.projectId}
                          disabled={disabled}
                          onChange={(id, viaEnter) => {
                            const current = { ...line, projectId: id };
                            update(current);
                            if (viaEnter) advance(i, 'project', current);
                          }}
                          onEnter={() => advance(i, 'project', line)}
                        />
                      </td>
                    </>
                  ) : null}
                  <td className="px-1 py-1">
                    <WonInput
                      ref={register(line.key, 'debit')}
                      aria-label={`${i + 1}행 차변`}
                      className="h-9"
                      value={line.debit}
                      disabled={disabled}
                      onFocus={(e) => e.currentTarget.select()}
                      onValueChange={(v) =>
                        update({ ...line, debit: v, ...(v > 0 ? { credit: 0 } : {}) })
                      }
                      onKeyDown={onEnter(i, 'debit')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <WonInput
                      ref={register(line.key, 'credit')}
                      aria-label={`${i + 1}행 대변`}
                      className="h-9"
                      value={line.credit}
                      disabled={disabled}
                      onFocus={(e) => e.currentTarget.select()}
                      onValueChange={(v) =>
                        update({ ...line, credit: v, ...(v > 0 ? { debit: 0 } : {}) })
                      }
                      onKeyDown={onEnter(i, 'credit')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <MemoInput
                      ref={register(line.key, 'memo')}
                      index={i}
                      accountId={line.accountId}
                      value={line.memo}
                      disabled={disabled}
                      onChange={(memo) => update({ ...line, memo })}
                      onKeyDown={onEnter(i, 'memo')}
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {!disabled && lines.length > 2 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        tabIndex={-1}
                        aria-label={`${i + 1}행 삭제`}
                        onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-surface-muted">
            <tr>
              <td />
              <td className="px-2 py-2 font-medium" colSpan={showDimensions ? 4 : 2}>
                합계
                {totals.difference !== 0 ? (
                  <span className="ml-3 text-danger">
                    차액 {formatWon(Math.abs(totals.difference))}원
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {formatWon(totals.debit)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {formatWon(totals.credit)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {!disabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const added = newGridLine();
              onChange([...lines, added]);
              pendingFocus.current = `${added.key}:account`;
            }}
          >
            <Plus />줄 추가
          </Button>
          <p className="text-xs text-muted-foreground">
            Enter 다음 칸 · 마지막 칸에서 Enter 면 차액을 채운 새 줄 · Ctrl+Enter 저장
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** 적요 입력칸: 계정에 등록한 자주 쓰는 적요를 목록으로 보여 준다 */
function MemoInput({
  ref,
  index,
  accountId,
  value,
  disabled,
  onChange,
  onKeyDown,
}: {
  ref: (el: HTMLInputElement | null) => void;
  index: number;
  accountId: string | null;
  value: string;
  disabled?: boolean;
  onChange: (memo: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const memos = useQuery({
    queryKey: ['account-memos', accountId],
    queryFn: () => apiFetch<{ id: string; text: string }[]>(`/accounts/${accountId}/memos`),
    enabled: !!accountId && !disabled,
    staleTime: 60_000,
  });
  const listId = `memo-list-${index}`;
  return (
    <>
      <Input
        ref={ref}
        aria-label={`${index + 1}행 적요`}
        className={cn('h-9')}
        list={memos.data?.length ? listId : undefined}
        maxLength={200}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {memos.data?.length ? (
        <datalist id={listId}>
          {memos.data.map((m) => (
            <option key={m.id} value={m.text} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
