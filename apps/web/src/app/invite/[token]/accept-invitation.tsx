'use client';

import { ROLE_LABELS, type Role } from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Lookup {
  companyName: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

const STATUS_MESSAGE: Record<Exclude<Lookup['status'], 'pending'>, string> = {
  accepted: '이미 수락한 초대입니다.',
  expired: '초대 기간이 지났습니다. 관리자에게 다시 요청해 주세요.',
  revoked: '취소된 초대입니다.',
};

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiFetch<Lookup>(`/invitations/lookup?token=${encodeURIComponent(token)}`),
  });
  const session = useSession();
  const accept = useMutation({
    mutationFn: () => apiFetch('/invitations/accept', { method: 'POST', json: { token } }),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/dashboard');
    },
  });

  if (invitation.isPending) {
    return <p className="text-center text-sm text-muted-foreground">초대를 확인하는 중…</p>;
  }
  if (invitation.error || !invitation.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>초대를 찾을 수 없습니다</CardTitle>
          <CardDescription>링크가 올바른지 확인해 주세요.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const inv = invitation.data;
  const next = `/invite/${token}`;
  const loggedIn = !!session.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{inv.companyName}에서 초대했습니다</CardTitle>
        <CardDescription>
          {inv.email} · {ROLE_LABELS[inv.role]}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {inv.status !== 'pending' ? (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
            {STATUS_MESSAGE[inv.status]}
          </p>
        ) : loggedIn ? (
          <>
            {accept.error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {accept.error instanceof ApiError ? accept.error.message : '수락하지 못했습니다.'}
              </p>
            ) : null}
            <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending ? '수락하는 중…' : '초대 수락하기'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {session.data?.user.email} 계정으로 로그인되어 있습니다.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              초대받은 이메일({inv.email})로 가입하거나 로그인한 뒤 수락해 주세요.
            </p>
            <Button asChild>
              <Link href={`/signup?next=${encodeURIComponent(next)}`}>가입하고 수락하기</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/login?next=${encodeURIComponent(next)}`}>로그인하고 수락하기</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
