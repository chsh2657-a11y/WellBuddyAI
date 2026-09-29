'use client';

import { SYSTEM_ACCOUNTS } from '@wellbuddy/accounting-core';
import { JOURNAL_TYPE_LABELS } from '@wellbuddy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ApiError, apiFetch } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { AttachmentsField } from './attachments-field';
import { trimRate } from './foreign-calc';
import { gridTotals, JournalGrid } from './journal-grid';
import {
  type AttachedFile,
  filledLines,
  type GridLine,
  type JournalEntry,
  newGridLine,
  toLineInput,
} from './types';
import { type MasterData, useMasterData } from './use-master-data';
import { initialVatState, type VatKind, vatLines, vatPayload, type VatState } from './vat-calc';
import { VatPanel } from './vat-panel';

type Mode = 'general' | 'vat';
type GeneralType = 'general' | 'receipt' | 'payment';
type Target = 'draft' | 'pending' | 'posted';

const TARGET_DONE: Record<Target, string> = {
  draft: '저장했습니다',
  pending: '승인요청했습니다',
  posted: '전기했습니다',
};

export const JOURNALS_KEY = ['journals'];

export function JournalEditor(props: {
  entry?: JournalEntry;
  initialMode?: Mode;
  initialKind?: VatKind;
  onSaved?: (entry: JournalEntry) => void;
}) {
  const data = useMasterData();
  if (!data.ready) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  return <EditorForm {...props} data={data} />;
}

function linesFromEntry(entry: JournalEntry): GridLine[] {
  return entry.lines.map((l) =>
    newGridLine({
      accountId: l.accountId,
      partnerId: l.partnerId,
      departmentId: l.departmentId,
      projectId: l.projectId,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo ?? '',
      currency: l.currency,
      foreignAmount: l.foreignAmount ?? '',
      exchangeRate: l.exchangeRate ? trimRate(l.exchangeRate) : '',
    }),
  );
}

function vatStateFromEntry(entry: JournalEntry, data: MasterData): VatState {
  const v = entry.vat!;
  const kind: VatKind = entry.type === 'sales' ? 'sales' : 'purchase';
  const vatCode = kind === 'sales' ? SYSTEM_ACCOUNTS.vatReceived : SYSTEM_ACCOUNTS.vatPaid;
  const main =
    kind === 'sales'
      ? entry.lines.find((l) => l.credit > 0 && l.accountCode !== vatCode)
      : entry.lines.find((l) => l.debit > 0 && l.accountCode !== vatCode);
  const settle =
    kind === 'sales' ? entry.lines.find((l) => l.debit > 0) : entry.lines.find((l) => l.credit > 0);
  return {
    ...initialVatState(kind, data),
    vatType: v.vatType,
    evidenceType: v.evidenceType,
    partnerId: v.partnerId,
    amount: v.supplyAmount,
    vat: v.vatAmount,
    vatEdited: true,
    deductible: v.deductible,
    mainAccountId: main?.accountId ?? null,
    settlementCode: settle?.accountCode ?? initialVatState(kind, data).settlementCode,
    memo: entry.lines[0]?.memo ?? '',
  };
}

function EditorForm({
  entry,
  initialMode = 'general',
  initialKind = 'sales',
  onSaved,
  data,
}: {
  entry?: JournalEntry;
  initialMode?: Mode;
  initialKind?: VatKind;
  onSaved?: (entry: JournalEntry) => void;
  data: MasterData;
}) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const manager = session?.role === 'owner' || session?.role === 'admin';
  const canPost = !session?.company?.journalApprovalRequired || manager;

  const [mode, setMode] = useState<Mode>(entry ? (entry.vat ? 'vat' : 'general') : initialMode);
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? todayIso());
  const [generalType, setGeneralType] = useState<GeneralType>(
    entry && (entry.type === 'receipt' || entry.type === 'payment') ? entry.type : 'general',
  );
  const [description, setDescription] = useState(entry?.description ?? '');
  const [vat, setVat] = useState<VatState>(() =>
    entry?.vat ? vatStateFromEntry(entry, data) : initialVatState(initialKind, data),
  );
  const [lines, setLines] = useState<GridLine[]>(() =>
    entry ? linesFromEntry(entry) : [newGridLine(), newGridLine()],
  );
  const [attachments, setAttachments] = useState<AttachedFile[]>(entry?.attachments ?? []);
  const [foreign, setForeign] = useState(() => !!entry?.lines.some((l) => l.currency));
  const toggleForeign = (on: boolean) => {
    setForeign(on);
    // 외화 열을 끄면 줄의 외화 정보도 지운다(원화 금액은 그대로)
    if (!on) {
      setLines((prev) =>
        prev.map((l) => ({ ...l, currency: null, foreignAmount: '', exchangeRate: '' })),
      );
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === 'vat') setForeign(false);
    setLines(next === 'vat' ? vatLines(vat, data) : [newGridLine(), newGridLine()]);
  };
  const changeVat = (next: VatState) => {
    setVat(next);
    setLines(vatLines(next, data));
  };

  const reset = () => {
    setDescription('');
    setAttachments([]);
    const fresh = { ...initialVatState(vat.kind, data), evidenceType: vat.evidenceType };
    setVat(fresh);
    setLines(mode === 'vat' ? vatLines(fresh, data) : [newGridLine(), newGridLine()]);
  };

  /** 매입매출전표에 적요가 없으면 "거래처 매출" 처럼 채운다 */
  const defaultDescription = () => {
    if (mode !== 'vat') return null;
    const partner = vat.partnerId
      ? data.partnerItems.find((p) => p.id === vat.partnerId)?.name
      : undefined;
    const text =
      vat.memo || [partner, vat.kind === 'sales' ? '매출' : '매입'].filter(Boolean).join(' ');
    return text || null;
  };

  const save = useMutation({
    mutationFn: async (target: Target) => {
      const body = {
        entryDate,
        type: mode === 'vat' ? vat.kind : generalType,
        description: description.trim() || defaultDescription(),
        lines: filledLines(lines).map(toLineInput),
        vat: mode === 'vat' ? vatPayload(vat) : null,
        attachmentIds: attachments.map((a) => a.id),
      };
      if (!entry) {
        return apiFetch<JournalEntry>('/journals', {
          method: 'POST',
          json: { entry: body, status: target },
        });
      }
      let saved = await apiFetch<JournalEntry>(`/journals/${entry.id}`, {
        method: 'PUT',
        json: body,
      });
      if (target === 'pending') {
        saved = await apiFetch<JournalEntry>(`/journals/${entry.id}/submit`, { method: 'POST' });
      } else if (target === 'posted') {
        saved = await apiFetch<JournalEntry>(`/journals/${entry.id}/post`, { method: 'POST' });
      }
      return saved;
    },
    onSuccess: (saved, target) => {
      void queryClient.invalidateQueries({ queryKey: JOURNALS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
      toast.success(`${saved.number} 전표를 ${TARGET_DONE[target]}.`);
      if (entry) onSaved?.(saved);
      else reset();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  const submit = (target: Target) => {
    const filled = filledLines(lines);
    if (filled.length < 2) return toast.error('분개는 2줄 이상이어야 합니다.');
    if (filled.some((l) => !l.accountId)) return toast.error('계정과목을 모두 선택해 주세요.');
    const { difference } = gridTotals(filled);
    if (difference !== 0) return toast.error('차변 합계와 대변 합계가 다릅니다.');
    save.mutate(target);
  };
  const primary: Target = canPost ? 'posted' : 'pending';

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-4">
        {!entry ? (
          <div className="flex rounded-md border p-0.5" role="tablist" aria-label="전표 종류">
            {(
              [
                ['general', '일반전표'],
                ['vat', '매입매출전표'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={cn(
                  'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => switchMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <FormField id="journal-date" label="일자" className="w-44">
          <Input
            id="journal-date"
            type="date"
            required
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
          />
        </FormField>
        {mode === 'general' ? (
          <FormField id="journal-type" label="구분" className="w-32">
            <Select
              id="journal-type"
              value={generalType}
              onChange={(e) => setGeneralType(e.target.value as GeneralType)}
            >
              {(['general', 'receipt', 'payment'] as const).map((t) => (
                <option key={t} value={t}>
                  {JOURNAL_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        <FormField id="journal-description" label="전표 적요" className="min-w-64 flex-1">
          <Input
            id="journal-description"
            maxLength={200}
            placeholder="예: 9월 사무실 임차료"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
      </div>

      {mode === 'vat' ? <VatPanel state={vat} onChange={changeVat} data={data} /> : null}

      {mode === 'general' ? (
        <label className="-mb-2 flex w-fit items-center gap-2 text-sm">
          <Switch aria-label="외화 입력" checked={foreign} onCheckedChange={toggleForeign} />
          외화 입력(통화·외화금액·환율)
        </label>
      ) : null}

      <JournalGrid
        lines={lines}
        onChange={setLines}
        data={data}
        foreign={foreign}
        entryDate={entryDate}
        onSubmit={() => submit(primary)}
      />

      <AttachmentsField
        files={attachments}
        onAdd={(files) => setAttachments((prev) => [...prev, ...files])}
        onRemove={(file) => setAttachments((prev) => prev.filter((f) => f.id !== file.id))}
      />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {!canPost ? (
          <p className="mr-auto text-xs text-muted-foreground">
            전표 승인을 사용 중입니다. 승인요청하면 대표·관리자·결재권자가 승인해 전기합니다.
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending}
          onClick={() => submit('draft')}
        >
          작성중 저장
        </Button>
        <Button
          type="button"
          variant={primary === 'pending' ? 'default' : 'outline'}
          disabled={save.isPending}
          onClick={() => submit('pending')}
        >
          승인요청
        </Button>
        {canPost ? (
          <Button type="button" disabled={save.isPending} onClick={() => submit('posted')}>
            전기
          </Button>
        ) : null}
      </div>
    </div>
  );
}
