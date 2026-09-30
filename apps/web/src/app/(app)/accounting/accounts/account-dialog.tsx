'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  defaultNormalBalance,
  STATEMENT_GROUP_KEYS,
  STATEMENT_GROUPS,
} from '@wellbuddy/accounting-core';
import { type AccountInput, AccountInputSchema } from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ApiError, apiFetch } from '@/lib/api';
import { type Account, ACCOUNTS_KEY } from './accounts-manager';

type FormValues = z.input<typeof AccountInputSchema>;

export function AccountDialog({
  account,
  onClose,
}: {
  account: Account | 'new' | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isNew = account === 'new';
  const existing = account && account !== 'new' ? account : null;
  const locked = existing?.isSystem ?? false;

  const form = useForm<FormValues, unknown, AccountInput>({
    resolver: zodResolver(AccountInputSchema),
    values: existing
      ? {
          code: existing.code,
          name: existing.name,
          group: existing.group,
          normalBalance: existing.normalBalance,
          requiresPartner: existing.requiresPartner,
          requiresDepartment: existing.requiresDepartment,
          isActive: existing.isActive,
          description: existing.description ?? '',
        }
      : {
          code: '',
          name: '',
          group: 'sga',
          normalBalance: 'debit',
          requiresPartner: false,
          requiresDepartment: false,
          isActive: true,
          description: '',
        },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: AccountInput) => {
      const body = locked
        ? {
            name: values.name,
            requiresPartner: values.requiresPartner,
            requiresDepartment: values.requiresDepartment,
            isActive: values.isActive,
            description: values.description,
          }
        : values;
      return isNew
        ? apiFetch('/accounts', { method: 'POST', json: body })
        : apiFetch(`/accounts/${existing!.id}`, { method: 'PATCH', json: body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      toast.success(isNew ? '계정을 추가했습니다.' : '계정을 저장했습니다.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/accounts/${existing!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      toast.success('계정을 삭제했습니다.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '삭제하지 못했습니다.'),
  });

  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? '계정 추가' : `${existing?.code} ${existing?.name}`}</DialogTitle>
          <DialogDescription>
            {locked
              ? '표준 계정과목은 코드·구분·정상잔액을 바꿀 수 없습니다. 이름과 옵션은 바꿀 수 있습니다.'
              : '재무제표 구분에 따라 재무상태표·손익계산서의 어느 항목에 표시될지 정해집니다.'}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <FormField id="account-code" label="코드" error={errors.code?.message}>
              <Input
                id="account-code"
                inputMode="numeric"
                disabled={locked}
                {...form.register('code')}
              />
            </FormField>
            <FormField id="account-name" label="계정명" error={errors.name?.message}>
              <Input id="account-name" {...form.register('name')} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="account-group" label="재무제표 구분" error={errors.group?.message}>
              <Select
                id="account-group"
                disabled={locked}
                {...form.register('group', {
                  onChange: (e) =>
                    form.setValue('normalBalance', defaultNormalBalance(e.target.value)),
                })}
              >
                {STATEMENT_GROUP_KEYS.map((g) => (
                  <option key={g} value={g}>
                    {STATEMENT_GROUPS[g].statement === 'BS' ? '[재무상태표]' : '[손익계산서]'}{' '}
                    {STATEMENT_GROUPS[g].label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              id="account-normal"
              label="정상잔액"
              hint="차감 계정(충당금·누계액 등)은 반대로 설정"
            >
              <Select id="account-normal" disabled={locked} {...form.register('normalBalance')}>
                <option value="debit">차변</option>
                <option value="credit">대변</option>
              </Select>
            </FormField>
          </div>
          <div className="grid gap-3 rounded-md border p-3">
            {(
              [
                ['requiresPartner', '전표 입력 시 거래처 필수'],
                ['requiresDepartment', '전표 입력 시 부서 필수'],
                ['isActive', '사용'],
              ] as const
            ).map(([name, label]) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <label className="flex items-center justify-between text-sm">
                    {label}
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                      aria-label={label}
                    />
                  </label>
                )}
              />
            ))}
          </div>
          <FormField id="account-desc" label="설명" error={errors.description?.message}>
            <Input id="account-desc" {...form.register('description')} />
          </FormField>
          {existing ? <MemoEditor accountId={existing.id} /> : null}
          <DialogFooter className="sm:justify-between">
            {existing && !locked ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger"
                onClick={() => confirm('이 계정을 삭제할까요?') && remove.mutate()}
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

function MemoEditor({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const key = ['account-memos', accountId];
  const memos = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<{ id: string; text: string }[]>(`/accounts/${accountId}/memos`),
  });
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => apiFetch(`/accounts/${accountId}/memos`, { method: 'POST', json: { text } }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '추가하지 못했습니다.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/accounts/${accountId}/memos/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="grid gap-2">
      <Label>자주 쓰는 적요</Label>
      <div className="flex flex-wrap gap-1.5">
        {memos.data?.map((m) => (
          <span
            key={m.id}
            className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs"
          >
            {m.text}
            <button type="button" aria-label={`${m.text} 삭제`} onClick={() => remove.mutate(m.id)}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        {memos.data?.length === 0 ? (
          <span className="text-xs text-muted-foreground">없음</span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="새 적요"
          placeholder="예: 직원 식대"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (text.trim()) add.mutate();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={() => text.trim() && add.mutate()}>
          추가
        </Button>
      </div>
    </div>
  );
}
