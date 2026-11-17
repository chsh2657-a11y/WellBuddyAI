'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type BusinessPlaceInput,
  BusinessPlaceInputSchema,
  formatBizRegNo,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ExcelImportDialog } from '@/components/excel-import-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

interface Place {
  id: string;
  name: string;
  bizRegNo: string;
  representative: string | null;
  businessType: string | null;
  businessItem: string | null;
  address: string | null;
  isHeadquarters: boolean;
}

const KEY = ['business-places'];

export function BusinessPlacesSection() {
  const { data: session } = useSession();
  const writable = can(session, 'settings.company', 'write');
  const queryClient = useQueryClient();
  const places = useQuery({ queryKey: KEY, queryFn: () => apiFetch<Place[]>('/business-places') });
  const [editing, setEditing] = useState<Place | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/business-places/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success('사업장을 삭제했습니다.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '삭제하지 못했습니다.'),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle>사업장</CardTitle>
          <CardDescription>
            본점과 지점(종사업장)을 관리합니다. 부가세 신고는 사업장별로 합니다.
          </CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild size="sm" variant="outline">
            <a href="/api/exports/business-places" download>
              <Download />
              엑셀 다운로드
            </a>
          </Button>
          {writable ? (
            <>
              <ExcelImportDialog
                spec="business-places"
                title="사업장"
                columns={[
                  { key: 'name', label: '사업장명' },
                  { key: 'bizRegNo', label: '사업자등록번호' },
                  { key: 'address', label: '주소' },
                ]}
                onImported={() => void queryClient.invalidateQueries({ queryKey: KEY })}
              />
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus />
                사업장 추가
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">사업장명</TableHead>
              <TableHead>사업자등록번호</TableHead>
              <TableHead>대표자</TableHead>
              <TableHead>주소</TableHead>
              {writable ? <TableHead className="w-28 pr-5 text-right">관리</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {places.data?.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-5 font-medium">
                  {p.name} {p.isHeadquarters ? <Badge className="ml-1">본점</Badge> : null}
                </TableCell>
                <TableCell className="tabular-nums">{formatBizRegNo(p.bizRegNo)}</TableCell>
                <TableCell>{p.representative ?? '—'}</TableCell>
                <TableCell className="max-w-64 truncate">{p.address ?? '—'}</TableCell>
                {writable ? (
                  <TableCell className="whitespace-nowrap pr-5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${p.name} 수정`}
                      onClick={() => setEditing(p)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${p.name} 삭제`}
                      disabled={p.isHeadquarters || remove.isPending}
                      onClick={() => {
                        if (confirm(`'${p.name}' 사업장을 삭제할까요?`)) remove.mutate(p.id);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <PlaceDialog place={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

type FormValues = z.input<typeof BusinessPlaceInputSchema>;

function PlaceDialog({ place, onClose }: { place: Place | 'new' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isNew = place === 'new';
  const form = useForm<FormValues, unknown, BusinessPlaceInput>({
    resolver: zodResolver(BusinessPlaceInputSchema),
    values:
      place && place !== 'new'
        ? {
            name: place.name,
            bizRegNo: formatBizRegNo(place.bizRegNo),
            representative: place.representative ?? '',
            businessType: place.businessType ?? '',
            businessItem: place.businessItem ?? '',
            address: place.address ?? '',
          }
        : {
            name: '',
            bizRegNo: '',
            representative: '',
            businessType: '',
            businessItem: '',
            address: '',
          },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: BusinessPlaceInput) =>
      isNew
        ? apiFetch('/business-places', { method: 'POST', json: values })
        : apiFetch(`/business-places/${(place as Place).id}`, { method: 'PATCH', json: values }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(isNew ? '사업장을 추가했습니다.' : '사업장을 수정했습니다.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  return (
    <Dialog open={place !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? '사업장 추가' : '사업장 수정'}</DialogTitle>
          <DialogDescription>사업자등록증에 적힌 정보를 입력해 주세요.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <FormField id="place-name" label="사업장명" error={errors.name?.message}>
            <Input id="place-name" {...form.register('name')} />
          </FormField>
          <FormField id="place-bizno" label="사업자등록번호" error={errors.bizRegNo?.message}>
            <Input id="place-bizno" inputMode="numeric" {...form.register('bizRegNo')} />
          </FormField>
          <FormField id="place-rep" label="대표자명">
            <Input id="place-rep" {...form.register('representative')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="place-type" label="업태">
              <Input id="place-type" {...form.register('businessType')} />
            </FormField>
            <FormField id="place-item" label="종목">
              <Input id="place-item" {...form.register('businessItem')} />
            </FormField>
          </div>
          <FormField id="place-address" label="주소">
            <Input id="place-address" {...form.register('address')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? '저장 중…' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
