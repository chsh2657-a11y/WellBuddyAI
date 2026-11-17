'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { formatWon, VAT_TYPE_LABELS, VAT_TYPES, type VatType } from '@wellbuddy/accounting-core';
import {
  ITEM_KIND_ACCOUNTS,
  ITEM_KIND_LABELS,
  ITEM_KINDS,
  type ItemInput,
  ItemInputSchema,
  type ItemKind,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ExcelImportDialog } from '@/components/excel-import-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WonInput } from '@/components/won-input';
import { ApiError, apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';

export interface Item {
  id: string;
  code: string;
  name: string;
  kind: ItemKind;
  spec: string | null;
  unit: string;
  barcode: string | null;
  vatType: VatType;
  salesPrice: number | null;
  purchasePrice: number | null;
  salesAccountId: string | null;
  purchaseAccountId: string | null;
  safetyStock: number | null;
  trackLot: boolean;
  trackSerial: boolean;
  memo: string | null;
  isActive: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  group: string;
}

export const ITEMS_KEY = ['items'];
const EXPENSE_GROUPS = ['cost_of_sales', 'manufacturing_cost', 'sga', 'non_operating_expense'];

const price = (v: number | null) => (v == null ? '—' : formatWon(v));
const qty = (v: number | null) => (v == null ? '—' : v.toLocaleString('ko-KR'));

export function ItemsManager() {
  const { data: session } = useSession();
  const writable = can(session, 'sales', 'write');
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ItemKind | ''>('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);

  const params = new URLSearchParams({ includeInactive: 'true' });
  if (q.trim()) params.set('q', q.trim());
  if (kind) params.set('kind', kind);
  const items = useQuery({
    queryKey: [...ITEMS_KEY, q.trim(), kind],
    queryFn: () => apiFetch<Item[]>(`/items?${params}`),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="품목 검색"
            placeholder="품목명·코드·바코드·규격"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label="품목 구분"
          className="w-36"
          value={kind}
          onChange={(e) => setKind(e.target.value as ItemKind | '')}
        >
          <option value="">전체 구분</option>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {ITEM_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/exports/items" download>
              <Download />
              엑셀 다운로드
            </a>
          </Button>
          {writable ? (
            <>
              <ExcelImportDialog
                spec="items"
                title="품목"
                columns={[
                  { key: 'code', label: '품목코드' },
                  { key: 'name', label: '품목명' },
                  { key: 'kind', label: '구분' },
                  { key: 'salesPrice', label: '판매단가' },
                ]}
                onImported={() => void queryClient.invalidateQueries({ queryKey: ITEMS_KEY })}
              />
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus />
                품목 추가
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-2">
        <Table aria-label="품목">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 pl-5">코드</TableHead>
              <TableHead className="min-w-40">품목명</TableHead>
              <TableHead className="w-20">구분</TableHead>
              <TableHead className="min-w-28">규격</TableHead>
              <TableHead className="w-16">단위</TableHead>
              <TableHead className="min-w-32">바코드</TableHead>
              <TableHead className="w-28 text-right">판매단가</TableHead>
              <TableHead className="w-28 text-right">구매단가</TableHead>
              <TableHead className="w-20 whitespace-nowrap text-right">적정재고</TableHead>
              <TableHead className="w-20 pr-5">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.data?.map((i) => (
              <TableRow
                key={i.id}
                className={writable ? 'cursor-pointer' : undefined}
                onClick={() => writable && setEditing(i)}
              >
                <TableCell className="pl-5 tabular-nums">{i.code}</TableCell>
                <TableCell className="font-medium">
                  {i.name}
                  {i.vatType !== 'taxable' ? (
                    <Badge variant="muted" className="ml-2">
                      {VAT_TYPE_LABELS[i.vatType]}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{ITEM_KIND_LABELS[i.kind]}</TableCell>
                <TableCell>{i.spec ?? '—'}</TableCell>
                <TableCell>{i.unit}</TableCell>
                <TableCell className="tabular-nums">{i.barcode ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{price(i.salesPrice)}</TableCell>
                <TableCell className="text-right tabular-nums">{price(i.purchasePrice)}</TableCell>
                <TableCell className="text-right tabular-nums">{qty(i.safetyStock)}</TableCell>
                <TableCell className="pr-5">
                  {i.isActive ? (
                    <Badge variant="success">사용</Badge>
                  ) : (
                    <Badge variant="muted">중지</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {items.data?.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            품목이 없습니다. 추가하거나 엑셀로 한 번에 올려 주세요.
          </p>
        ) : null}
      </CardContent>
      {/* 열 때마다 새로 만든다(새로 추가할 때 이전 입력이 남지 않게) */}
      {editing ? (
        <ItemDialog
          key={editing === 'new' ? 'new' : editing.id}
          item={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

type FormValues = z.input<typeof ItemInputSchema>;

function toForm(i: Item | null): FormValues {
  return {
    code: i?.code ?? '',
    name: i?.name ?? '',
    kind: i?.kind ?? 'goods',
    spec: i?.spec ?? '',
    unit: i?.unit ?? 'EA',
    barcode: i?.barcode ?? '',
    vatType: i?.vatType ?? 'taxable',
    salesPrice: i?.salesPrice ?? null,
    purchasePrice: i?.purchasePrice ?? null,
    salesAccountId: i?.salesAccountId ?? '',
    purchaseAccountId: i?.purchaseAccountId ?? '',
    safetyStock: i?.safetyStock ?? null,
    trackLot: i?.trackLot ?? false,
    trackSerial: i?.trackSerial ?? false,
    memo: i?.memo ?? '',
    isActive: i?.isActive ?? true,
  };
}

function ItemDialog({ item, onClose }: { item: Item | 'new' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const existing = item && item !== 'new' ? item : null;
  const form = useForm<FormValues, unknown, ItemInput>({
    resolver: zodResolver(ItemInputSchema),
    values: toForm(existing),
  });
  const { errors } = form.formState;
  const kind = (useWatch({ control: form.control, name: 'kind' }) ?? 'goods') as ItemKind;
  const stock = kind !== 'service';

  // 계정 선택(회계 조회 권한이 없으면 숨기고 구분별 기본 계정을 쓴다)
  const accounts = useQuery({
    queryKey: ['accounts', { includeInactive: false }],
    queryFn: () => apiFetch<Account[]>('/accounts'),
    enabled: item !== null,
    retry: false,
  });
  const defaults = ITEM_KIND_ACCOUNTS[kind];
  const accountLabel = (code: string | null) => {
    const a = accounts.data?.find((x) => x.code === code);
    return a ? `${a.code} ${a.name}` : (code ?? '');
  };
  const salesAccounts = accounts.data?.filter((a) => a.group === 'revenue') ?? [];
  const purchaseAccounts =
    accounts.data?.filter((a) =>
      stock ? a.group === 'inventories' : EXPENSE_GROUPS.includes(a.group),
    ) ?? [];

  const save = useMutation({
    mutationFn: (values: ItemInput) =>
      existing
        ? apiFetch(`/items/${existing.id}`, { method: 'PATCH', json: values })
        : apiFetch('/items', { method: 'POST', json: values }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
      toast.success(existing ? '품목을 저장했습니다.' : '품목을 추가했습니다.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/items/${existing!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
      toast.success('품목을 삭제했습니다.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '삭제하지 못했습니다.'),
  });

  const text = (name: keyof FormValues, label: string, props: Record<string, unknown> = {}) => (
    <FormField
      id={`item-${name}`}
      label={label}
      error={errors[name]?.message as string | undefined}
    >
      <Input id={`item-${name}`} {...props} {...form.register(name)} />
    </FormField>
  );
  const won = (name: 'salesPrice' | 'purchasePrice', label: string) => (
    <FormField id={`item-${name}`} label={label} error={errors[name]?.message}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <WonInput
            id={`item-${name}`}
            value={typeof field.value === 'number' ? field.value : 0}
            onValueChange={(v) => field.onChange(v === 0 ? null : v)}
          />
        )}
      />
    </FormField>
  );
  const toggle = (name: 'trackLot' | 'trackSerial' | 'isActive', label: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!!field.value} onCheckedChange={field.onChange} aria-label={label} />
          {label}
        </label>
      )}
    />
  );

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : '품목 추가'}</DialogTitle>
          <DialogDescription>
            견적·주문·판매·구매와 재고에 쓰입니다. 코드를 비우면 자동으로 부여합니다.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr_8rem]">
            {text('code', '코드', { placeholder: '자동' })}
            {text('name', '품목명')}
            <FormField id="item-kind" label="구분" error={errors.kind?.message}>
              <Select
                id="item-kind"
                {...form.register('kind', {
                  // 서비스는 재고를 두지 않으므로 재고 설정을 지운다
                  onChange: (e: { target: { value: string } }) => {
                    if (e.target.value !== 'service') return;
                    form.setValue('trackLot', false);
                    form.setValue('trackSerial', false);
                    form.setValue('safetyStock', null);
                  },
                })}
              >
                {ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ITEM_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            {text('spec', '규격')}
            {text('unit', '단위', { placeholder: 'EA' })}
            {text('barcode', '바코드', { inputMode: 'numeric', autoComplete: 'off' })}
            <FormField id="item-vatType" label="과세구분">
              <Select id="item-vatType" {...form.register('vatType')}>
                {VAT_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {VAT_TYPE_LABELS[v]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {won('salesPrice', '판매단가')}
            {won('purchasePrice', '구매단가')}
            {stock ? (
              <FormField id="item-safetyStock" label="적정재고" error={errors.safetyStock?.message}>
                <Input
                  id="item-safetyStock"
                  type="number"
                  step="0.001"
                  min="0"
                  {...form.register('safetyStock', {
                    setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                  })}
                />
              </FormField>
            ) : null}
          </div>
          {accounts.isSuccess ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="item-salesAccountId"
                label="매출 계정"
                error={errors.salesAccountId?.message}
              >
                <Select id="item-salesAccountId" {...form.register('salesAccountId')}>
                  <option value="">기본({accountLabel(defaults.revenue)})</option>
                  {salesAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                id="item-purchaseAccountId"
                label={stock ? '재고 계정' : '매입 비용 계정'}
                error={errors.purchaseAccountId?.message}
              >
                <Select id="item-purchaseAccountId" {...form.register('purchaseAccountId')}>
                  <option value="">기본({accountLabel(defaults.purchase)})</option>
                  {purchaseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : null}
          {text('memo', '메모')}
          <div className="flex flex-wrap gap-6">
            {stock ? toggle('trackLot', 'LOT 관리') : null}
            {stock ? toggle('trackSerial', '시리얼 관리') : null}
            {toggle('isActive', '사용')}
          </div>
          <DialogFooter className="sm:justify-between">
            {existing ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger"
                onClick={() => confirm('이 품목을 삭제할까요?') && remove.mutate()}
              >
                <Trash2 />
                삭제
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                취소
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? '저장 중…' : '저장'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
