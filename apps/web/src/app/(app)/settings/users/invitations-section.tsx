'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateInvitationInput,
  CreateInvitationSchema,
  INVITABLE_ROLES,
  ROLE_LABELS,
  type Role,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';

interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

const KEY = ['invitations'];
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' });

export function InvitationsSection() {
  const { data: session } = useSession();
  const writable = can(session, 'settings.users', 'write');
  const queryClient = useQueryClient();
  const invitations = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<Invitation[]>('/invitations'),
  });
  const form = useForm<z.input<typeof CreateInvitationSchema>, unknown, CreateInvitationInput>({
    resolver: zodResolver(CreateInvitationSchema),
    defaultValues: { email: '', role: 'employee' },
  });
  const { errors } = form.formState;

  const invite = useMutation({
    mutationFn: (values: CreateInvitationInput) =>
      apiFetch('/invitations', { method: 'POST', json: values }),
    onSuccess: (_data, values) => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      form.reset({ email: '', role: values.role });
      toast.success(`${values.email}에 초대 메일을 보냈습니다.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '초대하지 못했습니다.'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '취소하지 못했습니다.'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>초대</CardTitle>
        <CardDescription>
          초대받은 사람은 메일의 링크로 가입·로그인하면 지정한 역할로 회사에 들어옵니다(7일간 유효).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {writable ? (
          <form
            className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]"
            onSubmit={form.handleSubmit((v) => invite.mutate(v))}
            noValidate
          >
            <FormField id="invite-email" label="이메일" error={errors.email?.message}>
              <Input
                id="invite-email"
                type="email"
                placeholder="name@company.com"
                {...form.register('email')}
              />
            </FormField>
            <FormField id="invite-role" label="역할" error={errors.role?.message}>
              <Select id="invite-role" {...form.register('role')}>
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button type="submit" disabled={invite.isPending}>
              <Mail />
              초대 보내기
            </Button>
          </form>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium">대기 중인 초대</p>
          {invitations.data?.length ? (
            <ul className="divide-y rounded-md border">
              {invitations.data.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1 truncate">{inv.email}</span>
                  <span className="text-muted-foreground">{ROLE_LABELS[inv.role]}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {dateFormat.format(new Date(inv.expiresAt))}까지
                  </span>
                  {writable ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${inv.email} 초대 취소`}
                      onClick={() => revoke.mutate(inv.id)}
                    >
                      <X />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">대기 중인 초대가 없습니다.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
