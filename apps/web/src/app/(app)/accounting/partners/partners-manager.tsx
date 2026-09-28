'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatBizRegNo,
  PARTNER_KIND_LABELS,
  PARTNER_KINDS,
  type PartnerInput,
  PartnerInputSchema,
  type PartnerKind,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { ApiError, apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';

export interface Partner {
  id: string;
  code: string;
  name: string;
  kind: PartnerKind;
  bizRegNo: string | null;
  representative: string | null;
  businessType: string | null;
  businessItem: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  bankName: string | null;
  bankAccountMasked: string | null;
  bankHolder: string | null;
  memo: string | null;
  isActive: boolean;
}

const KEY = ['partners'];

export function PartnersManager() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<PartnerKind | ''>('');
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);

  const params = new URLSearchParams({ includeInactive: 'true' });
  if (q.trim()) params.set('q', q.trim());
  if (kind) params.set('kind', kind);
  const partners = useQuery({
    queryKey: [...KEY, q.trim(), kind],
    queryFn: () => apiFetch<Partner[]>(`/partners?${params}`),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="거래처 검색"
            placeholder="거래처명·코드·사업자번호·대표자"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label="구분"
          className="w-36"
          value={kind}
          onChange={(e) => setKind(e.target.value as PartnerKind | '')}
        >
          <option value="">전체 구분</option>
          {PARTNER_KINDS.map((k) => (
            <option key={k} value={k}>
              {PARTNER_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/exports/partners" download>
              <Download />
              엑셀 다운로드
            </a>
          </Button>
          {writable ? (
            <>
              <ExcelImportDialog
                spec="partners"
                title="거래처"
                columns={[
                  { key: 'name', label: '거래처명' },
                  { key: 'kind', label: '구분' },
                  { key: 'bizRegNo', label: '사업자등록번호' },
                ]}
                onImported={() => void queryClient.invalidateQueries({ queryKey: KEY })}
              />
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus />
                거래처 추가
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 pl-5">코드</TableHead>
              <TableHead>거래처명</TableHead>
              <TableHead className="w-24">구분</TableHead>
              <TableHead className="w-36">사업자등록번호</TableHead>
              <TableHead className="w-28">대표자</TableHead>
              <TableHead className="w-32">전화</TableHead>
              <TableHead className="w-20 pr-5">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.data?.map((p) => (
              <TableRow
                key={p.id}
                className={writable ? 'cursor-pointer' : undefined}
                onClick={() => writable && setEditing(p)}
              >
                <TableCell className="pl-5 tabular-nums">{p.code}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{PARTNER_KIND_LABELS[p.kind]}</TableCell>
                <TableCell className="tabular-nums">
                  {p.bizRegNo ? formatBizRegNo(p.bizRegNo) : '—'}
                </TableCell>
                <TableCell>{p.representative ?? '—'}</TableCell>
                <TableCell>{p.phone ?? '—'}</TableCell>
                <TableCell className="pr-5">
                  {p.isActive ? (
                    <Badge variant="success">사용</Badge>
                  ) : (
                    <Badge variant="muted">중지</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {partners.data?.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            거래처가 없습니다. 추가하거나 엑셀로 한 번에 올려 주세요.
          </p>
        ) : null}
      </CardContent>
      <PartnerDialog partner={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

type FormValues = z.input<typeof PartnerInputSchema>;

function toForm(p: Partner | null): FormValues {
  return {
    code: p?.code ?? '',
    name: p?.name ?? '',
    kind: p?.kind ?? 'both',
    bizRegNo: p?.bizRegNo ? formatBizRegNo(p.bizRegNo) : '',
    representative: p?.representative ?? '',
    businessType: p?.businessType ?? '',
    businessItem: p?.businessItem ?? '',
    address: p?.address ?? '',
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    contactName: p?.contactName ?? '',
    bankName: p?.bankName ?? '',
    bankAccount: '',
    bankHolder: p?.bankHolder ?? '',
    memo: p?.memo ?? '',
    isActive: p?.isActive ?? true,
  };
}

function PartnerDialog({
  partner,
  onClose,
}: {
  partner: Partner | 'new' | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const existing = partner && partner !== 'new' ? partner : null;
  const form = useForm<FormValues, unknown, PartnerInput>({
    resolver: zodResolver(PartnerInputSchema),
    values: toForm(existing),
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: PartnerInput) => {
      // 계좌번호 칸을 비워 두면 기존 계좌를 그대로 둔다
      const body = { ...values, ...(values.bankAccount ? {} : { bankAccount: undefined }) };
      return existing
        ? apiFetch(`/partners/${existing.id}`, { method: 'PATCH', json: body })
        : apiFetch('/partners', { method: 'POST', json: body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(existing ? '거래처를 저장했습니다.' : '거래처를 추가했습니다.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/partners/${existing!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success('거래처를 삭제했습니다.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '삭제하지 못했습니다.'),
  });

  const text = (name: keyof FormValues, label: string, props: Record<string, unknown> = {}) => (
    <FormField
      id={`partner-${name}`}
      label={label}
      error={errors[name]?.message as string | undefined}
    >
      <Input id={`partner-${name}`} {...props} {...form.register(name)} />
    </FormField>
  );

  return (
    <Dialog open={partner !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : '거래처 추가'}</DialogTitle>
          <DialogDescription>
            세금계산서 발행·수취와 채권·채무 관리에 쓰입니다. 코드를 비우면 자동으로 부여합니다.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr_9rem]">
            {text('code', '코드', { placeholder: '자동' })}
            {text('name', '거래처명')}
            <FormField id="partner-kind" label="구분">
              <Select id="partner-kind" {...form.register('kind')}>
                {PARTNER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PARTNER_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {text('bizRegNo', '사업자등록번호', {
              placeholder: '000-00-00000',
              inputMode: 'numeric',
            })}
            {text('representative', '대표자')}
            {text('phone', '전화')}
            {text('businessType', '업태')}
            {text('businessItem', '종목')}
            {text('email', '세금계산서 이메일', { type: 'email' })}
          </div>
          {text('address', '주소')}
          <div className="grid gap-4 sm:grid-cols-4">
            {text('contactName', '담당자')}
            {text('bankName', '은행')}
            <FormField
              id="partner-bankAccount"
              label="계좌번호"
              error={errors.bankAccount?.message}
              hint={
                existing?.bankAccountMasked
                  ? `저장됨: ${existing.bankAccountMasked}`
                  : '암호화해 저장'
              }
            >
              <Input
                id="partner-bankAccount"
                autoComplete="off"
                {...form.register('bankAccount')}
              />
            </FormField>
            {text('bankHolder', '예금주')}
          </div>
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
                onClick={() => confirm('이 거래처를 삭제할까요?') && remove.mutate()}
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
