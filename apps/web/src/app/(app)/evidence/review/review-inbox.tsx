'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTO_JOURNAL_KIND_LABELS,
  AUTO_JOURNAL_KINDS,
  type AutoJournalKind,
  type AutoJournalSettings,
  PURCHASE_KINDS,
  SUGGESTION_METHOD_LABELS,
  type SuggestionMethod,
  type UploadKind,
} from '@wellbuddy/shared';
import { Check, EyeOff, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { formatWon } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  type MasterData,
  useMasterData,
} from '../../accounting/journals/_components/use-master-data';

export interface ReviewItem {
  evidenceKind: UploadKind;
  evidenceId: string;
  kind: AutoJournalKind;
  kindLabel: string;
  date: string;
  description: string;
  counterparty: string | null;
  sourceLabel: string | null;
  amount: number;
  reversal: boolean;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  deductible: boolean | null;
  partnerId: string | null;
  partnerName: string | null;
  memo: string | null;
  confidence: number;
  method: SuggestionMethod;
  reason: string | null;
  error: string | null;
  edited: boolean;
  lines: { accountCode: string; accountName: string; debit: number; credit: number }[];
}

interface RunSummary {
  total: number;
  matched: number;
  posted: number;
  review: number;
  failed: number;
  aiClassified: number;
  aiError: string | null;
}

interface ApproveResult {
  posted: { evidenceKind: UploadKind; evidenceId: string; entryId: string }[];
  failed: { evidenceKind: UploadKind; evidenceId: string; message: string }[];
}

const REVIEW_KEY = ['auto-journal', 'review'];
const SETTINGS_KEY = ['auto-journal', 'settings'];
const THRESHOLDS = [0.7, 0.8, 0.9, 0.95, 1];

const onError = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

const keyOf = (i: { evidenceKind: string; evidenceId: string }) =>
  `${i.evidenceKind}:${i.evidenceId}`;
const labelOf = (i: ReviewItem) =>
  i.counterparty && i.counterparty !== i.description
    ? `${i.counterparty} ${i.description}`.trim()
    : i.counterparty || i.description;

function confidenceVariant(c: number) {
  return c >= 0.9 ? 'success' : c >= 0.6 ? 'default' : c > 0 ? 'warning' : 'muted';
}

/** 자동분개 검토함(P2-24): 추천 확인·수정 → 승인하면 전표가 된다 */
export function ReviewInbox() {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const master = useMasterData();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'' | AutoJournalKind>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useQuery({
    queryKey: [...REVIEW_KEY, kind],
    queryFn: () => apiFetch<ReviewItem[]>(`/auto-journal/review${kind ? `?kind=${kind}` : ''}`),
  });
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<AutoJournalSettings>('/auto-journal/settings'),
  });
  const refresh = () => {
    // 검토함·규칙 적용 횟수·수집 내역 상태가 함께 바뀐다
    void queryClient.invalidateQueries({ queryKey: ['auto-journal'] });
    void queryClient.invalidateQueries({ queryKey: ['evidence'] });
  };

  const run = useMutation({
    mutationFn: () => apiFetch<RunSummary>('/auto-journal/run', { method: 'POST' }),
    onSuccess: (s) => {
      toast.success(
        `자동분개: 매칭 ${s.matched}건, 자동 전기 ${s.posted}건, 검토 ${s.review}건${
          s.aiClassified ? `, AI 추천 ${s.aiClassified}건` : ''
        }${s.failed ? ` (전기 실패 ${s.failed}건)` : ''}`,
      );
      if (s.aiError) toast.warning(`AI 분류를 하지 못했습니다: ${s.aiError}`);
      refresh();
    },
    onError,
  });
  const saveSettings = useMutation({
    mutationFn: (next: AutoJournalSettings) =>
      apiFetch<AutoJournalSettings>('/auto-journal/settings', { method: 'PUT', json: next }),
    onSuccess: (s) => {
      queryClient.setQueryData(SETTINGS_KEY, s);
      toast.success('자동 전기 설정을 저장했습니다.');
    },
    onError,
  });
  const approve = useMutation({
    mutationFn: (items: ReviewItem[]) =>
      apiFetch<ApproveResult>('/auto-journal/approve', {
        method: 'POST',
        json: {
          items: items.map((i) => ({ evidenceKind: i.evidenceKind, evidenceId: i.evidenceId })),
        },
      }),
    onSuccess: (r) => {
      if (r.posted.length) toast.success(`${r.posted.length}건을 전표로 만들었습니다.`);
      if (r.failed.length)
        toast.error(`${r.failed.length}건은 전기하지 못했습니다: ${r.failed[0]!.message}`);
      setSelected(new Set());
      refresh();
    },
    onError,
  });

  const items = list.data ?? [];
  const chosen = items.filter((i) => selected.has(keyOf(i)));
  const allChosen = items.length > 0 && chosen.length === items.length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => run.mutate()} disabled={!writable || run.isPending}>
          <Play />
          자동분개 실행
        </Button>
        <Select
          aria-label="거래 종류"
          className="w-44"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as AutoJournalKind);
            setSelected(new Set());
          }}
        >
          <option value="">전체 종류</option>
          {AUTO_JOURNAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {AUTO_JOURNAL_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        {settings.data ? (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <Switch
              id="auto-post"
              checked={settings.data.autoPost}
              disabled={!writable || saveSettings.isPending}
              onCheckedChange={(autoPost) => saveSettings.mutate({ ...settings.data!, autoPost })}
            />
            <Label htmlFor="auto-post">신뢰도 높은 거래는 자동 전기</Label>
            <Select
              aria-label="자동 전기 신뢰도 기준"
              className="h-8 w-24"
              value={settings.data.threshold}
              disabled={!writable || saveSettings.isPending}
              onChange={(e) =>
                saveSettings.mutate({ ...settings.data!, threshold: Number(e.target.value) })
              }
            >
              {THRESHOLDS.map((t) => (
                <option key={t} value={t}>
                  {Math.round(t * 100)}% 이상
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {items.length > 0 && writable ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={chosen.length === 0 || approve.isPending}
            onClick={() => approve.mutate(chosen)}
          >
            <Check />
            선택 승인 ({chosen.length})
          </Button>
          <span className="text-xs text-muted-foreground">
            승인하면 추천대로 전표를 만들고, 고친 내용은 다음 추천에 반영됩니다.
          </span>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="자동분개 검토함">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="모두 선택"
                  checked={allChosen}
                  disabled={!writable || items.length === 0}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(items.map(keyOf)) : new Set())
                  }
                />
              </TableHead>
              <TableHead>일자</TableHead>
              <TableHead>거래</TableHead>
              <TableHead className="text-right">금액</TableHead>
              <TableHead className="min-w-64">분개 계정</TableHead>
              <TableHead className="min-w-56">추천 근거</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <ReviewRow
                key={`${keyOf(item)}:${item.accountId}:${item.partnerId}:${item.deductible}`}
                item={item}
                master={master}
                writable={writable}
                checked={selected.has(keyOf(item))}
                onCheck={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(keyOf(item));
                    else next.delete(keyOf(item));
                    return next;
                  })
                }
                onApprove={() => approve.mutate([item])}
                busy={approve.isPending}
                onChanged={refresh}
              />
            ))}
          </TableBody>
        </Table>
        {list.isSuccess && items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            검토할 거래가 없습니다.{' '}
            <Link href="/evidence/collect" className="underline">
              자동 수집
            </Link>
            하거나{' '}
            <Link href="/evidence/upload" className="underline">
              파일을 올린
            </Link>{' '}
            뒤 자동분개를 실행해 주세요.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReviewRow({
  item,
  master,
  writable,
  checked,
  onCheck,
  onApprove,
  busy,
  onChanged,
}: {
  item: ReviewItem;
  master: MasterData;
  writable: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onApprove: () => void;
  busy: boolean;
  onChanged: () => void;
}) {
  const label = labelOf(item);
  const update = useMutation({
    mutationFn: (patch: {
      accountId?: string | null;
      partnerId?: string | null;
      deductible?: boolean | null;
    }) =>
      apiFetch(`/auto-journal/review/${item.evidenceKind}/${item.evidenceId}`, {
        method: 'PUT',
        json: patch,
      }),
    onSuccess: onChanged,
    onError,
  });
  const ignore = useMutation({
    mutationFn: () =>
      apiFetch(`/evidence/${item.evidenceKind}/${item.evidenceId}/status`, {
        method: 'PATCH',
        json: { status: 'ignored' },
      }),
    onSuccess: () => {
      toast.success('제외했습니다.');
      onChanged();
    },
    onError,
  });
  const account = item.accountId ? master.accountById.get(item.accountId) : undefined;
  const needsPartner = !!account?.requiresPartner;
  const purchase = PURCHASE_KINDS.includes(item.kind);
  const debit = item.lines.filter((l) => l.debit > 0);
  const credit = item.lines.filter((l) => l.credit > 0);
  const fmt = (ls: typeof item.lines) =>
    ls.map((l) => `${l.accountCode} ${l.accountName} ${formatWon(l.debit || l.credit)}`).join(', ');

  return (
    <TableRow aria-label={label} className="align-top">
      <TableCell>
        <input
          type="checkbox"
          aria-label={`${label} 선택`}
          checked={checked}
          disabled={!writable}
          onChange={(e) => onCheck(e.target.checked)}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">{item.date}</TableCell>
      <TableCell>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {item.kindLabel}
          {item.sourceLabel ? ` · ${item.sourceLabel}` : ''}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.reversal ? '-' : ''}
        {formatWon(item.amount)}
      </TableCell>
      <TableCell>
        <div className="grid gap-1.5">
          <Combobox
            aria-label={`${label} 계정`}
            items={master.accountItems}
            value={item.accountId}
            disabled={!writable || update.isPending}
            onChange={(accountId) => {
              if (accountId && accountId !== item.accountId) update.mutate({ accountId });
            }}
          />
          {needsPartner ? (
            <Combobox
              aria-label={`${label} 거래처`}
              items={master.partnerItems}
              value={item.partnerId}
              placeholder="거래처 선택"
              invalid={!item.partnerId}
              disabled={!writable || update.isPending}
              onChange={(partnerId) => {
                if (partnerId !== item.partnerId) update.mutate({ partnerId });
              }}
            />
          ) : null}
          {purchase ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={item.deductible === false}
                disabled={!writable || update.isPending}
                onChange={(e) => update.mutate({ deductible: e.target.checked ? false : null })}
              />
              매입세액 불공제
            </label>
          ) : null}
          {item.lines.length ? (
            <div className="text-xs text-muted-foreground" aria-label={`${label} 전표 미리보기`}>
              <div>차) {fmt(debit)}</div>
              <div>대) {fmt(credit)}</div>
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={confidenceVariant(item.confidence)}>
            {Math.round(item.confidence * 100)}%
          </Badge>
          <span className="text-xs font-medium">{SUGGESTION_METHOD_LABELS[item.method]}</span>
        </div>
        {item.reason ? <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p> : null}
        {item.error ? (
          <p className={cn('mt-1 text-xs text-danger')} role="alert">
            {item.error}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        {writable ? (
          <div className="flex gap-1">
            <Button size="sm" disabled={busy || !item.accountId} onClick={onApprove}>
              <Check />
              승인
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={ignore.isPending}
              onClick={() => ignore.mutate()}
            >
              <EyeOff />
              제외
            </Button>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
