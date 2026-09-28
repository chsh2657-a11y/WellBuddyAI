'use client';

import {
  type ChannelDefinition,
  type ConnectionTestResult,
  INTEGRATIONS,
  type IntegrationStatus,
  SCHEDULE_PRESETS,
  type SchedulePreset,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlugZap, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ApiError, apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';

const KEY = ['integrations'];
const KIND_LABEL = { file: '파일', mock: '모의', external: '실연동', builtin: '내장' } as const;
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

export function IntegrationsSettings() {
  const { data: session } = useSession();
  const writable = can(session, 'settings.integrations', 'write');
  const statuses = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<IntegrationStatus[]>('/integrations'),
  });

  return (
    <div className="grid gap-4">
      <p className="rounded-md border bg-surface px-4 py-3 text-sm text-muted-foreground">
        채널마다 <b className="text-foreground">파일 업로드</b>(계약 불필요),{' '}
        <b className="text-foreground">모의 데이터</b>(체험용),{' '}
        <b className="text-foreground">실연동</b>(CODEF·팝빌·AI, 계약·API 키 필요) 중 하나를 골라
        켜고 끌 수 있습니다. 자격증명은 암호화되어 저장되며 다시 표시되지 않습니다.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {INTEGRATIONS.map((channel) => {
          const status = statuses.data?.find((s) => s.channel === channel.key);
          return status ? (
            <IntegrationCard
              key={`${channel.key}:${status.provider}:${status.enabled}`}
              channel={channel}
              status={status}
              writable={writable}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

function IntegrationCard({
  channel,
  status,
  writable,
}: {
  channel: ChannelDefinition;
  status: IntegrationStatus;
  writable: boolean;
}) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(status.enabled);
  const [provider, setProvider] = useState(status.provider);
  const [schedule, setSchedule] = useState<SchedulePreset>(status.schedule);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const def = channel.providers.find((p) => p.key === provider) ?? channel.providers[0]!;
  const sameProvider = provider === status.provider;
  const dirty =
    enabled !== status.enabled ||
    !sameProvider ||
    schedule !== status.schedule ||
    Object.values(credentials).some(Boolean);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<IntegrationStatus>(`/integrations/${channel.key}`, {
        method: 'PUT',
        json: { enabled, provider, schedule, credentials },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(`${channel.label} 연동 설정을 저장했습니다.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });
  const test = useMutation({
    mutationFn: () =>
      apiFetch<ConnectionTestResult>(`/integrations/${channel.key}/test`, { method: 'POST' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '연결 테스트에 실패했습니다.'),
  });

  return (
    <Card data-testid={`integration-${channel.key}`}>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2">
            {channel.label}
            <Badge variant={status.enabled ? 'success' : 'muted'}>
              {status.enabled ? '사용 중' : '꺼짐'}
            </Badge>
          </CardTitle>
          <CardDescription>{channel.description}</CardDescription>
        </div>
        <Switch
          aria-label={`${channel.label} 사용`}
          checked={enabled}
          disabled={!writable}
          onCheckedChange={setEnabled}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormField id={`${channel.key}-provider`} label="연동 방식" hint={def.description}>
          <Select
            id={`${channel.key}-provider`}
            value={provider}
            disabled={!writable}
            onChange={(e) => {
              setProvider(e.target.value);
              setCredentials({});
            }}
          >
            {channel.providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} ({KIND_LABEL[p.kind]})
              </option>
            ))}
          </Select>
        </FormField>

        {def.credentials.map((field) => {
          const saved = sameProvider ? status.credentials[field.key] : undefined;
          return (
            <FormField
              key={field.key}
              id={`${channel.key}-${field.key}`}
              label={`${field.label}${field.required ? ' *' : ''}`}
              hint={saved ? `저장됨: ${saved} (바꿀 때만 입력)` : field.help}
            >
              <Input
                id={`${channel.key}-${field.key}`}
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={saved ? '••••••••' : field.placeholder}
                disabled={!writable}
                value={credentials[field.key] ?? ''}
                onChange={(e) => setCredentials((c) => ({ ...c, [field.key]: e.target.value }))}
              />
            </FormField>
          );
        })}

        {def.schedulable ? (
          <FormField id={`${channel.key}-schedule`} label="자동 수집 주기">
            <Select
              id={`${channel.key}-schedule`}
              value={schedule}
              disabled={!writable}
              onChange={(e) => setSchedule(e.target.value as SchedulePreset)}
            >
              {(Object.keys(SCHEDULE_PRESETS) as SchedulePreset[]).map((k) => (
                <option key={k} value={k}>
                  {SCHEDULE_PRESETS[k].label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        {status.lastStatus ? (
          <p
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
              status.lastStatus === 'success'
                ? 'bg-success-soft text-success'
                : 'bg-danger-soft text-danger'
            }`}
            data-testid={`integration-${channel.key}-result`}
          >
            {status.lastStatus === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {status.lastMessage}
              {status.lastRunAt ? (
                <span className="ml-1 opacity-70">
                  ({dateFormat.format(new Date(status.lastRunAt))})
                </span>
              ) : null}
            </span>
          </p>
        ) : null}
      </CardContent>
      {writable ? (
        <CardFooter className="justify-end">
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={dirty || test.isPending}
            title={dirty ? '먼저 저장해 주세요' : undefined}
          >
            <PlugZap />
            {test.isPending ? '확인 중…' : '연결 테스트'}
          </Button>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? '저장 중…' : '저장'}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
