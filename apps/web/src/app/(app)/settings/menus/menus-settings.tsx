'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { MODULE_ICONS } from '@/components/app-shell/module-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ApiError, apiFetch } from '@/lib/api';
import { can, SESSION_KEY, useSession } from '@/lib/session';

interface ModuleSetting {
  key: keyof typeof MODULE_ICONS;
  label: string;
  phase: string;
  available: boolean;
  required: boolean;
  enabled: boolean;
}

const KEY = ['settings', 'modules'];

export function MenusSettings() {
  const { data: session } = useSession();
  const writable = can(session, 'settings.menus', 'write');
  const queryClient = useQueryClient();
  const modules = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<ModuleSetting[]>('/settings/modules'),
  });
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  const save = useMutation({
    mutationFn: () =>
      apiFetch<ModuleSetting[]>('/settings/modules', {
        method: 'PUT',
        json: { enabledModules: draft },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      setDraft({});
      toast.success('메뉴 사용 설정을 저장했습니다.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>메뉴 사용 여부</CardTitle>
        <CardDescription>
          쓰지 않는 업무 메뉴를 끄면 모든 구성원의 사이드 메뉴에서 숨겨집니다. 대시보드·설정은 끌 수
          없습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border">
          {modules.data?.map((m) => {
            const Icon = MODULE_ICONS[m.key];
            const checked = draft[m.key] ?? m.enabled;
            return (
              <li key={m.key} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-4 text-muted-foreground" />
                <label htmlFor={`module-${m.key}`} className="flex-1 text-sm font-medium">
                  {m.label}
                </label>
                {m.required ? <Badge variant="muted">필수</Badge> : null}
                {!m.available ? <Badge variant="muted">{m.phase} 예정</Badge> : null}
                <Switch
                  id={`module-${m.key}`}
                  checked={checked}
                  disabled={!writable || m.required}
                  onCheckedChange={(value) => setDraft((d) => ({ ...d, [m.key]: value }))}
                />
              </li>
            );
          })}
        </ul>
      </CardContent>
      {writable ? (
        <CardFooter className="justify-end">
          <Button
            onClick={() => save.mutate()}
            disabled={Object.keys(draft).length === 0 || save.isPending}
          >
            {save.isPending ? '저장 중…' : '저장'}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
