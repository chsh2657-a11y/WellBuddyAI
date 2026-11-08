'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoteKind } from '@wellbuddy/accounting-core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { WonInput } from '@/components/won-input';
import { ApiError, apiFetch } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useMasterData } from '../journals/_components/use-master-data';
import { KIND_TEXT, type NoteDetail, NOTES_KEY } from './types';

interface Draft {
  noteNo: string;
  partnerId: string | null;
  issueDate: string;
  dueDate: string;
  amount: number;
  bank: string;
  counterAccountId: string | null;
  entryDate: string;
  createEntry: boolean;
  memo: string;
}

/** 받을어음 수취·지급어음 발행 등록(전표 자동 전기) */
export function NoteFormDialog({ kind }: { kind: NoteKind }) {
  const master = useMasterData();
  const queryClient = useQueryClient();
  const text = KIND_TEXT[kind];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = (): Draft => ({
    noteNo: '',
    partnerId: null,
    issueDate: todayIso(),
    dueDate: '',
    amount: 0,
    bank: '',
    counterAccountId: master.accountByCode.get(kind === 'receivable' ? '108' : '251')?.id ?? null,
    entryDate: '',
    createEntry: true,
    memo: '',
  });
  const [draft, setDraft] = useState<Draft>(blank);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = useMutation({
    mutationFn: () => apiFetch<NoteDetail>('/notes', { method: 'POST', json: { ...draft, kind } }),
    onSuccess: (note) => {
      toast.success(`${text.label} ${note.noteNo}을(를) ${text.register}로 등록했습니다.`);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: NOTES_KEY });
      void queryClient.invalidateQueries({ queryKey: ['journals'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : '등록하지 못했습니다.'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(blank());
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={!master.ready}>
          <Plus />
          {text.label} {text.register}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {text.label} {text.register}
          </DialogTitle>
          <DialogDescription>
            {kind === 'receivable'
              ? '(차) 받을어음 / (대) 외상매출금(또는 고른 계정) 전표를 전기합니다.'
              : '(차) 외상매입금(또는 고른 계정) / (대) 지급어음 전표를 전기합니다.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="note-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <FormField id="note-no" label="어음번호">
            <Input
              id="note-no"
              value={draft.noteNo}
              onChange={(e) => set('noteNo', e.target.value)}
              required
            />
          </FormField>
          <FormField id="note-partner" label={`거래처(${text.partner})`}>
            <Combobox
              aria-label="거래처"
              items={master.partnerItems}
              value={draft.partnerId}
              onChange={(id) => set('partnerId', id)}
            />
          </FormField>
          <FormField id="note-issue" label="발행일">
            <Input
              id="note-issue"
              type="date"
              value={draft.issueDate}
              onChange={(e) => set('issueDate', e.target.value)}
              required
            />
          </FormField>
          <FormField id="note-due" label="만기일">
            <Input
              id="note-due"
              type="date"
              value={draft.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
              required
            />
          </FormField>
          <FormField id="note-amount" label="금액">
            <WonInput
              id="note-amount"
              value={draft.amount}
              onValueChange={(v) => set('amount', v)}
            />
          </FormField>
          <FormField id="note-bank" label="지급은행(선택)">
            <Input
              id="note-bank"
              value={draft.bank}
              onChange={(e) => set('bank', e.target.value)}
            />
          </FormField>
          <FormField id="note-counter" label="상대 계정" hint={`기본: ${text.counter}`}>
            <Combobox
              aria-label="상대 계정"
              items={master.accountItems}
              value={draft.counterAccountId}
              onChange={(id) => set('counterAccountId', id)}
            />
          </FormField>
          <FormField id="note-entry-date" label="전표 일자" hint="비우면 발행일">
            <Input
              id="note-entry-date"
              type="date"
              value={draft.entryDate}
              onChange={(e) => set('entryDate', e.target.value)}
            />
          </FormField>
          <FormField id="note-memo" label="메모" className="sm:col-span-2">
            <Input
              id="note-memo"
              value={draft.memo}
              onChange={(e) => set('memo', e.target.value)}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={!draft.createEntry}
              onChange={(e) => set('createEntry', !e.target.checked)}
            />
            전표 없이 대장에만 등록(기초잔액에 이미 들어 있는 어음)
          </label>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="submit" form="note-form" disabled={save.isPending}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
