'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type WarehouseInput, WarehouseInputSchema } from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
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
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  memo: string | null;
  isActive: boolean;
}

export const WAREHOUSES_KEY = ['warehouses'];

export function WarehousesManager() {
  const { data: session } = useSession();
  const writable = can(session, 'sales', 'write');
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  const warehouses = useQuery({
    queryKey: [...WAREHOUSES_KEY, 'all'],
    queryFn: () => apiFetch<Warehouse[]>('/warehouses?includeInactive=true'),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          재고는 창고별로 관리합니다. 처음에는 기본창고 하나가 만들어져 있습니다.
        </p>
        {writable ? (
          <Button size="sm" className="ml-auto" onClick={() => setEditing('new')}>
            <Plus />
            창고 추가
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table aria-label="창고">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 pl-5">코드</TableHead>
              <TableHead>창고명</TableHead>
              <TableHead>주소</TableHead>
              <TableHead className="w-20 pr-5">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {warehouses.data?.map((w) => (
              <TableRow
                key={w.id}
                className={writable ? 'cursor-pointer' : undefined}
                onClick={() => writable && setEditing(w)}
              >
                <TableCell className="pl-5 tabular-nums">{w.code}</TableCell>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell>{w.address ?? '—'}</TableCell>
                <TableCell className="pr-5">
                  {w.isActive ? (
                    <Badge variant="success">사용</Badge>
                  ) : (
                    <Badge variant="muted">중지</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {editing ? (
        <WarehouseDialog
          key={editing === 'new' ? 'new' : editing.id}
          warehouse={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

type FormValues = z.input<typeof WarehouseInputSchema>;

function WarehouseDialog({
  warehouse,
  onClose,
}: {
  warehouse: Warehouse | 'new' | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const existing = warehouse && warehouse !== 'new' ? warehouse : null;
  const form = useForm<FormValues, unknown, WarehouseInput>({
    resolver: zodResolver(WarehouseInputSchema),
    values: {
      code: existing?.code ?? '',
      name: existing?.name ?? '',
      address: existing?.address ?? '',
      memo: existing?.memo ?? '',
      isActive: existing?.isActive ?? true,
    },
  });
  const { errors } = form.formState;
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: WAREHOUSES_KEY });
    toast.success(message);
    onClose();
  };
  const save = useMutation({
    mutationFn: (values: WarehouseInput) =>
      existing
        ? apiFetch(`/warehouses/${existing.id}`, { method: 'PATCH', json: values })
        : apiFetch('/warehouses', { method: 'POST', json: values }),
    onSuccess: () => done(existing ? '창고를 저장했습니다.' : '창고를 추가했습니다.'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/warehouses/${existing!.id}`, { method: 'DELETE' }),
    onSuccess: () => done('창고를 삭제했습니다.'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '삭제하지 못했습니다.'),
  });

  const text = (name: 'code' | 'name' | 'address' | 'memo', label: string, placeholder = '') => (
    <FormField id={`warehouse-${name}`} label={label} error={errors[name]?.message}>
      <Input id={`warehouse-${name}`} placeholder={placeholder} {...form.register(name)} />
    </FormField>
  );

  return (
    <Dialog open={warehouse !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : '창고 추가'}</DialogTitle>
          <DialogDescription>코드를 비우면 W01, W02 … 순서로 부여합니다.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
            {text('code', '코드', '자동')}
            {text('name', '창고명')}
          </div>
          {text('address', '주소')}
          {text('memo', '메모')}
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={!!field.value}
                  onCheckedChange={field.onChange}
                  aria-label="사용"
                />
                사용
              </label>
            )}
          />
          <DialogFooter className="sm:justify-between">
            {existing ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger"
                onClick={() => confirm('이 창고를 삭제할까요?') && remove.mutate()}
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
