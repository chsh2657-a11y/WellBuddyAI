'use client';

import { useMutation } from '@tanstack/react-query';
import {
  DEPRECIATION_METHOD_LABELS,
  DEPRECIATION_METHODS,
  type DepreciationMethod,
  STATEMENT_GROUPS,
} from '@wellbuddy/accounting-core';
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
import { Select } from '@/components/ui/select';
import { WonInput } from '@/components/won-input';
import { ApiError, apiFetch } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useMasterData } from '../journals/_components/use-master-data';
import type { FixedAsset } from './types';

interface Draft {
  code: string;
  name: string;
  assetAccountId: string | null;
  accumulatedAccountId: string | null;
  expenseAccountId: string | null;
  departmentId: string | null;
  acquisitionDate: string;
  cost: number;
  residualValue: number;
  usefulLifeYears: number;
  method: DepreciationMethod;
  priorAccumulated: number;
  memo: string;
}

const FIXED_GROUPS = new Set(['tangible_assets', 'intangible_assets']);

/** 고정자산 등록. 기본 계정은 비품(212)·감가상각누계액(213)·감가상각비(818) */
export function AssetFormDialog({ onSaved }: { onSaved: () => void }) {
  const master = useMasterData();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idOf = (code: string) => master.accountByCode.get(code)?.id ?? null;
  const blank = (): Draft => ({
    code: '',
    name: '',
    assetAccountId: idOf('212'),
    accumulatedAccountId: idOf('213'),
    expenseAccountId: idOf('818'),
    departmentId: null,
    acquisitionDate: todayIso(),
    cost: 0,
    residualValue: 0,
    usefulLifeYears: 5,
    method: 'straight_line',
    priorAccumulated: 0,
    memo: '',
  });
  const [draft, setDraft] = useState<Draft>(blank);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const fixedItems = master.accountItems.filter((i) =>
    FIXED_GROUPS.has(master.accountById.get(i.id)!.group),
  );
  const expenseItems = master.accountItems.filter(
    (i) => STATEMENT_GROUPS[master.accountById.get(i.id)!.group].category === 'expense',
  );

  const save = useMutation({
    mutationFn: () => apiFetch<FixedAsset>('/fixed-assets', { method: 'POST', json: draft }),
    onSuccess: (asset) => {
      toast.success(`${asset.code} ${asset.name}을(를) 등록했습니다.`);
      setOpen(false);
      onSaved();
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
          자산 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>고정자산 등록</DialogTitle>
          <DialogDescription>
            취득 전표는 따로 입력하고, 여기서는 상각에 필요한 정보만 등록합니다. 상각 전표가 생긴
            뒤에는 취득 정보를 고칠 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <form
          id="asset-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <FormField id="asset-name" label="자산명">
            <Input
              id="asset-name"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </FormField>
          <FormField id="asset-code" label="자산코드" hint="비우면 FA0001 처럼 자동으로 붙입니다.">
            <Input
              id="asset-code"
              value={draft.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </FormField>
          <FormField id="asset-account" label="자산 계정">
            <Combobox
              aria-label="자산 계정"
              items={fixedItems}
              value={draft.assetAccountId}
              onChange={(id) => set('assetAccountId', id)}
            />
          </FormField>
          <FormField id="accumulated-account" label="상각누계액 계정">
            <Combobox
              aria-label="상각누계액 계정"
              items={fixedItems}
              value={draft.accumulatedAccountId}
              onChange={(id) => set('accumulatedAccountId', id)}
            />
          </FormField>
          <FormField id="expense-account" label="감가상각비 계정">
            <Combobox
              aria-label="감가상각비 계정"
              items={expenseItems}
              value={draft.expenseAccountId}
              onChange={(id) => set('expenseAccountId', id)}
            />
          </FormField>
          <FormField id="asset-department" label="부서(선택)">
            <Combobox
              aria-label="부서"
              items={master.departmentItems}
              value={draft.departmentId}
              onChange={(id) => set('departmentId', id)}
            />
          </FormField>
          <FormField id="acquisition-date" label="취득일">
            <Input
              id="acquisition-date"
              type="date"
              value={draft.acquisitionDate}
              onChange={(e) => set('acquisitionDate', e.target.value)}
              required
            />
          </FormField>
          <FormField id="asset-cost" label="취득가액">
            <WonInput id="asset-cost" value={draft.cost} onValueChange={(v) => set('cost', v)} />
          </FormField>
          <FormField id="asset-method" label="상각방법">
            <Select
              id="asset-method"
              value={draft.method}
              onChange={(e) => set('method', e.target.value as DepreciationMethod)}
            >
              {DEPRECIATION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {DEPRECIATION_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="asset-life" label="내용연수(년)">
            <Input
              id="asset-life"
              type="number"
              min={1}
              max={60}
              value={draft.usefulLifeYears}
              onChange={(e) => set('usefulLifeYears', Number(e.target.value))}
            />
          </FormField>
          <FormField
            id="asset-residual"
            label="잔존가치"
            hint="0 이면 비망가액 1,000원을 남깁니다."
          >
            <WonInput
              id="asset-residual"
              value={draft.residualValue}
              onValueChange={(v) => set('residualValue', v)}
            />
          </FormField>
          <FormField
            id="asset-prior"
            label="이전 상각누계액"
            hint="이 프로그램을 쓰기 전에 이미 상각한 금액(기초잔액에 포함된 금액)"
          >
            <WonInput
              id="asset-prior"
              value={draft.priorAccumulated}
              onValueChange={(v) => set('priorAccumulated', v)}
            />
          </FormField>
          <FormField id="asset-memo" label="메모" className="sm:col-span-2">
            <Input
              id="asset-memo"
              value={draft.memo}
              onChange={(e) => set('memo', e.target.value)}
            />
          </FormField>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="submit" form="asset-form" disabled={save.isPending}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
