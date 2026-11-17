'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, LoginSchema } from '@wellbuddy/shared';
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

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof LoginSchema>, unknown, LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiFetch('/auth/login', { method: 'POST', json: values });
      queryClient.clear();
      router.replace(next?.startsWith('/') ? next : '/dashboard');
    } catch (e) {
      form.setError('root', {
        message: e instanceof ApiError ? e.message : '로그인하지 못했습니다.',
      });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>로그인</CardTitle>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          <FormField id="email" label="이메일" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...form.register('email')}
            />
          </FormField>
          <FormField id="password" label="비밀번호" error={errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
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
            {isSubmitting ? '로그인 중…' : '로그인'}
          </Button>
        </CardContent>
      </form>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        계정이 없으신가요?
        <Link
          href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
          className="font-medium text-primary hover:underline"
        >
          회원가입
        </Link>
      </CardFooter>
    </Card>
  );
}
