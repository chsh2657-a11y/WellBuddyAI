'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type SignupInput, SignupSchema } from '@wellbuddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';

export function SignupForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof SignupSchema>, unknown, SignupInput>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { email: '', password: '', name: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiFetch('/auth/signup', { method: 'POST', json: values });
      queryClient.clear();
      router.replace(next?.startsWith('/') ? next : '/onboarding/company');
    } catch (e) {
      form.setError('root', {
        message: e instanceof ApiError ? e.message : '가입하지 못했습니다.',
      });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>회원가입</CardTitle>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          <FormField id="name" label="이름" error={errors.name?.message}>
            <Input
              id="name"
              autoComplete="name"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
          </FormField>
          <FormField id="email" label="이메일" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...form.register('email')}
            />
          </FormField>
          <FormField
            id="password"
            label="비밀번호"
            error={errors.password?.message}
            hint="8자 이상, 영문과 숫자를 함께 사용"
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...form.register('password')}
            />
          </FormField>
          {errors.root ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {errors.root.message}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '가입 중…' : '가입하기'}
          </Button>
        </CardContent>
      </form>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        이미 계정이 있으신가요?
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="font-medium text-primary hover:underline"
        >
          로그인
        </Link>
      </CardFooter>
    </Card>
  );
}
