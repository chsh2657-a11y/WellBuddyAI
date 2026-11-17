'use client';

import {
  PERMISSIONS,
  type PermissionKey,
  type PermissionLevel,
  ROLE_LABELS,
  type Role,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { can, SESSION_KEY, useSession } from '@/lib/session';

interface RolePermissions {
  role: Role;
  editable: boolean;
  overridden: boolean;
  permissions: Record<PermissionKey, PermissionLevel>;
}

const KEY = ['roles'];
const LEVEL_LABELS: Record<PermissionLevel, string> = { none: '없음', read: '조회', write: '변경' };

export function RolePermissionsSection() {
  const { data: session } = useSession();
  const writable = can(session, 'settings.users', 'write');
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: KEY, queryFn: () => apiFetch<RolePermissions[]>('/roles') });

  const update = useMutation({
    mutationFn: ({
      role,
      key,
      level,
    }: {
      role: Role;
      key: PermissionKey;
      level: PermissionLevel;
    }) =>
      apiFetch(`/roles/${role}/permissions`, {
        method: 'PUT',
        json: { permissions: { [key]: level } },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      toast.success('권한을 바꿨습니다.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '바꾸지 못했습니다.'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>역할별 권한</CardTitle>
        <CardDescription>
          조회: 메뉴를 볼 수 있음 · 변경: 등록·수정·삭제까지 가능. 대표 관리자는 항상 모든 권한을
          가집니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">메뉴·기능</TableHead>
              {roles.data?.map((r) => (
                <TableHead key={r.role} className="min-w-28">
                  {ROLE_LABELS[r.role]}
                  {r.overridden ? (
                    <Badge variant="warning" className="ml-1">
                      변경됨
                    </Badge>
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERMISSIONS.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="pl-5">
                  <span className="font-medium">{p.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{p.group}</span>
                </TableCell>
                {roles.data?.map((r) => (
                  <TableCell key={r.role}>
                    {writable && r.editable ? (
                      <Select
                        aria-label={`${ROLE_LABELS[r.role]} ${p.label} 권한`}
                        className="h-8"
                        value={r.permissions[p.key]}
                        onChange={(e) =>
                          update.mutate({
                            role: r.role,
                            key: p.key,
                            level: e.target.value as PermissionLevel,
                          })
                        }
                      >
                        {(['none', 'read', 'write'] as const).map((level) => (
                          <option key={level} value={level}>
                            {LEVEL_LABELS[level]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {LEVEL_LABELS[r.permissions[p.key]]}
                      </span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
