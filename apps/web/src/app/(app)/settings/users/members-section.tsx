'use client';

import { ROLE_LABELS, ROLES, type Role } from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'disabled';
  createdAt: string;
  isMe: boolean;
}

export const MEMBERS_KEY = ['members'];

export function MembersSection() {
  const { data: session } = useSession();
  const writable = can(session, 'settings.users', 'write');
  const iAmOwner = session?.role === 'owner';
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: () => apiFetch<Member[]>('/members'),
  });

  const update = useMutation({
    mutationFn: ({ id, ...change }: { id: string; role?: Role; status?: Member['status'] }) =>
      apiFetch(`/members/${id}`, { method: 'PATCH', json: change }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
      toast.success('구성원 정보를 바꿨습니다.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '바꾸지 못했습니다.'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>구성원</CardTitle>
        <CardDescription>
          역할에 따라 메뉴 권한이 정해집니다. 비활성화하면 즉시 회사 데이터에 접근할 수 없습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead className="w-44">역할</TableHead>
              <TableHead className="w-24 pr-5">사용</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data?.map((m) => {
              const editable = writable && !m.isMe && (m.role !== 'owner' || iAmOwner);
              return (
                <TableRow key={m.id}>
                  <TableCell className="pl-5 font-medium">
                    {m.name} {m.isMe ? <Badge variant="muted">나</Badge> : null}
                  </TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell>
                    {editable ? (
                      <Select
                        aria-label={`${m.name} 역할`}
                        value={m.role}
                        onChange={(e) => update.mutate({ id: m.id, role: e.target.value as Role })}
                        className="h-8"
                      >
                        {ROLES.filter((r) => r !== 'owner' || iAmOwner).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      ROLE_LABELS[m.role]
                    )}
                  </TableCell>
                  <TableCell className="pr-5">
                    <Switch
                      aria-label={`${m.name} 사용 여부`}
                      checked={m.status === 'active'}
                      disabled={!editable || update.isPending}
                      onCheckedChange={(checked) =>
                        update.mutate({ id: m.id, status: checked ? 'active' : 'disabled' })
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
