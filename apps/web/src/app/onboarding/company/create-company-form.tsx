'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type CreateCompanyInput, CreateCompanySchema } from '@wellbuddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';

export function CreateCompanyForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof CreateCompanySchema>, unknown, CreateCompanyInput>({
    resolver: zodResolver(CreateCompanySchema),
    defaultValues: {
      name: '',
      bizRegNo: '',
      representative: '',
      businessType: '',
      businessItem: '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiFetch('/companies', { method: 'POST', json: values });
      queryClient.clear();
      router.replace('/dashboard');
    } catch (e) {
      form.setError('root', {
        message: e instanceof ApiError ? e.message : '회사를 만들지 못했습니다.',
      });
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4 pt-5">
          <FormField id="name" label="회사명" error={errors.name?.message}>
            <Input id="name" aria-invalid={!!errors.name} {...form.register('name')} />
          </FormField>
          <FormField
            id="bizRegNo"
            label="사업자등록번호"
            error={errors.bizRegNo?.message}
            hint="예: 123-45-67890"
          >
            <Input
              id="bizRegNo"
              inputMode="numeric"
              placeholder="000-00-00000"
              aria-invalid={!!errors.bizRegNo}
              {...form.register('bizRegNo')}
            />
          </FormField>
          <FormField id="representative" label="대표자명" error={errors.representative?.message}>
            <Input id="representative" {...form.register('representative')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="businessType" label="업태" error={errors.businessType?.message}>
              <Input
                id="businessType"
                placeholder="예: 도소매"
                {...form.register('businessType')}
              />
            </FormField>
            <FormField id="businessItem" label="종목" error={errors.businessItem?.message}>
              <Input
                id="businessItem"
                placeholder="예: 사무용품"
                {...form.register('businessItem')}
              />
            </FormField>
          </div>
          {errors.root ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {errors.root.message}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '만드는 중…' : '회사 만들고 시작하기'}
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}
