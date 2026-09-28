'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type UpdateCompanyInput, UpdateCompanySchema } from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, apiFetch } from '@/lib/api';
import { can, SESSION_KEY, useSession } from '@/lib/session';

interface Company {
  id: string;
  name: string;
  bizRegNo: string;
  representative: string | null;
  businessType: string | null;
  businessItem: string | null;
  address: string | null;
  phone: string | null;
  fiscalYearStartMonth: number;
}

type FormValues = z.input<typeof UpdateCompanySchema>;

function toForm(c: Company): FormValues {
  return {
    name: c.name,
    bizRegNo: c.bizRegNo,
    representative: c.representative ?? '',
    businessType: c.businessType ?? '',
    businessItem: c.businessItem ?? '',
    address: c.address ?? '',
    phone: c.phone ?? '',
    fiscalYearStartMonth: c.fiscalYearStartMonth,
  };
}

export function CompanyInfoSection() {
  const { data: session } = useSession();
  const writable = can(session, 'settings.company', 'write');
  const queryClient = useQueryClient();
  const company = useQuery({
    queryKey: ['company'],
    queryFn: () => apiFetch<Company>('/companies/current'),
  });
  const form = useForm<FormValues, unknown, UpdateCompanyInput>({
    resolver: zodResolver(UpdateCompanySchema),
  });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (company.data) form.reset(toForm(company.data));
  }, [company.data, form]);

  const save = useMutation({
    mutationFn: (values: UpdateCompanyInput) =>
      apiFetch<Company>('/companies/current', { method: 'PATCH', json: values }),
    onSuccess: (data) => {
      queryClient.setQueryData(['company'], data);
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      toast.success('회사정보를 저장했습니다.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>회사정보</CardTitle>
        <CardDescription>세금계산서·신고서 등에 표시되는 기본 정보입니다.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <fieldset disabled={!writable || company.isPending}>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField id="name" label="회사명" error={errors.name?.message}>
              <Input id="name" {...form.register('name')} />
            </FormField>
            <FormField id="bizRegNo" label="사업자등록번호" error={errors.bizRegNo?.message}>
              <Input id="bizRegNo" inputMode="numeric" {...form.register('bizRegNo')} />
            </FormField>
            <FormField id="representative" label="대표자명" error={errors.representative?.message}>
              <Input id="representative" {...form.register('representative')} />
            </FormField>
            <FormField id="phone" label="대표 전화" error={errors.phone?.message}>
              <Input id="phone" {...form.register('phone')} />
            </FormField>
            <FormField id="businessType" label="업태" error={errors.businessType?.message}>
              <Input id="businessType" {...form.register('businessType')} />
            </FormField>
            <FormField id="businessItem" label="종목" error={errors.businessItem?.message}>
              <Input id="businessItem" {...form.register('businessItem')} />
            </FormField>
            <div className="sm:col-span-2">
              <FormField id="address" label="주소" error={errors.address?.message}>
                <Input id="address" {...form.register('address')} />
              </FormField>
            </div>
            <FormField id="fiscalYearStartMonth" label="회계연도 시작 월">
              <Select
                id="fiscalYearStartMonth"
                {...form.register('fiscalYearStartMonth', { valueAsNumber: true })}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}월
                  </option>
                ))}
              </Select>
            </FormField>
          </CardContent>
        </fieldset>
        {writable ? (
          <CardFooter className="justify-end">
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {save.isPending ? '저장 중…' : '저장'}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
