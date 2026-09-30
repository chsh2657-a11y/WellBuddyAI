'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTO_JOURNAL_KIND_LABELS,
  AUTO_JOURNAL_KINDS,
  type AutoJournalKind,
} from '@wellbuddy/shared';
import { Lightbulb, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { WonInput } from '@/components/won-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
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
import { formatDateTime, formatWon } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  type MasterData,
  useMasterData,
} from '../../accounting/journals/_components/use-master-data';

interface Rule {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  kinds: AutoJournalKind[];
  keywords: string | null;
  partnerName: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  account: string;
  deductible: boolean | null;
  memo: string | null;
  hitCount: number;
  lastHitAt: string | null;
}

const RULES_KEY = ['auto-journal', 'rules'];

const onError = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

/** 조건 요약: "카드 승인 · '스타벅스, 이디야' · 1만~5만원" */
function conditionText(r: Rule): string {
  const parts: string[] = [];
  if (r.kinds.length) parts.push(r.kinds.map((k) => AUTO_JOURNAL_KIND_LABELS[k]).join('·'));
  if (r.keywords) parts.push(`'${r.keywords}'`);
  if (r.partnerName) parts.push(`거래처 ${r.partnerName}`);
  if (r.minAmount != null || r.maxAmount != null) {
    parts.push(
      `${r.minAmount != null ? formatWon(r.minAmount) : ''}~${
        r.maxAmount != null ? formatWon(r.maxAmount) : ''
      }원`,
    );
  }
  return parts.join(' · ');
}

/** 회사 분개 규칙(P2-20): 조건이 맞으면 신뢰도 100% 로 이 계정에 분개한다 */
export function RulesManager() {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const master = useMasterData();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: RULES_KEY,
    queryFn: () => apiFetch<Rule[]>('/auto-journal/rules'),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: RULES_KEY });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/auto-journal/rules/${id}`, { method: 'PATCH', json: { isActive } }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/auto-journal/rules/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  if (!master.ready) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  return (
    <div className="grid gap-6">
      <RuleSuggestions writable={writable} onAccepted={refresh} />
      {writable ? <RuleForm master={master} onCreated={refresh} /> : null}
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="분개 규칙">
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">순서</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>조건</TableHead>
              <TableHead>분개 계정</TableHead>
              <TableHead className="text-right">적용</TableHead>
              <TableHead className="w-16">사용</TableHead>
              {writable ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.map((r) => (
              <TableRow key={r.id} className={cn(!r.isActive && 'text-muted-foreground')}>
                <TableCell className="tabular-nums">{r.priority}</TableCell>
                <TableCell className="font-medium">
                  {r.name}
                  {r.memo ? (
                    <div className="text-xs text-muted-foreground">적요: {r.memo}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{conditionText(r)}</TableCell>
                <TableCell className="text-sm">
                  {r.account}
                  {r.deductible === false ? (
                    <span className="ml-1 text-xs text-muted-foreground">(불공제)</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {r.hitCount}회
                  {r.lastHitAt ? (
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(r.lastHitAt)}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Switch
                    aria-label={`${r.name} 사용`}
                    checked={r.isActive}
                    disabled={!writable}
                    onCheckedChange={(isActive) => toggle.mutate({ id: r.id, isActive })}
                  />
                </TableCell>
                {writable ? (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${r.name} 삭제`}
                      onClick={() => confirm(`'${r.name}' 규칙을 지울까요?`) && remove.mutate(r.id)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.data?.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            아직 규칙이 없습니다. 자주 쓰는 거래를 규칙으로 만들면 검토 없이 분개할 수 있습니다.
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface RuleSuggestion {
  kind: AutoJournalKind;
  kindLabel: string;
  keys: string[];
  label: string;
  partnerName: string | null;
  keywords: string | null;
  account: string;
  deductible: boolean | null;
  useCount: number;
  total: number;
  name: string;
}

const SUGGESTIONS_KEY = ['auto-journal', 'rule-suggestions'];

/** 수정 학습 → 규칙 제안(P2-25): 같은 거래를 같은 계정으로 3번 이상 승인했으면 규칙을 권한다 */
function RuleSuggestions({ writable, onAccepted }: { writable: boolean; onAccepted: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: SUGGESTIONS_KEY,
    queryFn: () => apiFetch<RuleSuggestion[]>('/auto-journal/rule-suggestions'),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
  const body = (s: RuleSuggestion) => ({ kind: s.kind, keys: s.keys });
  const accept = useMutation({
    mutationFn: (s: RuleSuggestion) =>
      apiFetch<Rule>('/auto-journal/rule-suggestions/accept', { method: 'POST', json: body(s) }),
    onSuccess: (r) => {
      toast.success(`'${r.name}' 규칙을 만들었습니다.`);
      refresh();
      onAccepted();
    },
    onError,
  });
  const dismiss = useMutation({
    mutationFn: (s: RuleSuggestion) =>
      apiFetch('/auto-journal/rule-suggestions/dismiss', { method: 'POST', json: body(s) }),
    onSuccess: refresh,
    onError,
  });
  if (!list.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="size-4" />
          추천 규칙
        </CardTitle>
        <CardDescription>
          같은 거래를 같은 계정으로 여러 번 승인했습니다. 규칙으로 만들면 다음부터 검토 없이 분개할
          수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2" aria-label="추천 규칙">
          {list.data.map((s) => (
            <li
              key={`${s.kind}:${s.keys.join(',')}`}
              aria-label={s.name}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {s.partnerName ? `거래처 ${s.partnerName}` : `'${s.keywords}'`} → {s.account}
                  {s.deductible === false ? (
                    <span className="ml-1 text-xs text-muted-foreground">(불공제)</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.kindLabel} · {s.total}번 중 {s.useCount}번 이 계정으로 승인
                </div>
              </div>
              {writable ? (
                <div className="flex gap-1">
                  <Button size="sm" disabled={accept.isPending} onClick={() => accept.mutate(s)}>
                    <Plus />
                    규칙으로 만들기
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(s)}
                  >
                    <X />
                    무시
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RuleForm({ master, onCreated }: { master: MasterData; onCreated: () => void }) {
  const blank = () => ({
    name: '',
    priority: 100,
    kinds: [] as AutoJournalKind[],
    keywords: '',
    partnerId: null as string | null,
    minAmount: 0,
    maxAmount: 0,
    accountId: null as string | null,
    deductible: '' as '' | 'false',
    memo: '',
  });
  const [draft, setDraft] = useState(blank);
  const create = useMutation({
    mutationFn: () =>
      apiFetch<Rule>('/auto-journal/rules', {
        method: 'POST',
        json: {
          name: draft.name,
          priority: draft.priority,
          kinds: draft.kinds,
          keywords: draft.keywords,
          partnerId: draft.partnerId,
          minAmount: draft.minAmount || null,
          maxAmount: draft.maxAmount || null,
          accountId: draft.accountId,
          deductible: draft.deductible === 'false' ? false : null,
          memo: draft.memo,
        },
      }),
    onSuccess: (r) => {
      toast.success(`'${r.name}' 규칙을 추가했습니다.`);
      setDraft(blank());
      onCreated();
    },
    onError,
  });
  const toggleKind = (k: AutoJournalKind, on: boolean) =>
    setDraft((d) => ({ ...d, kinds: on ? [...d.kinds, k] : d.kinds.filter((x) => x !== k) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>규칙 추가</CardTitle>
        <CardDescription>
          조건(거래 종류·키워드·거래처·금액)이 모두 맞는 거래를 이 계정으로 분개합니다. 순서 숫자가
          작은 규칙을 먼저 봅니다. 회사 규칙은 신뢰도 100%라 자동 전기를 켜면 바로 전표가 됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id="rule-name" label="규칙 이름">
              <Input
                id="rule-name"
                value={draft.name}
                maxLength={50}
                required
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </FormField>
            <FormField
              id="rule-keywords"
              label="키워드"
              hint="쉼표로 여러 개(하나라도 들어 있으면)"
            >
              <Input
                id="rule-keywords"
                value={draft.keywords}
                placeholder="예: 스타벅스, 이디야"
                onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
              />
            </FormField>
            <FormField id="rule-account" label="분개 계정">
              <Combobox
                aria-label="분개 계정"
                items={master.accountItems}
                value={draft.accountId}
                onChange={(accountId) => setDraft({ ...draft, accountId })}
              />
            </FormField>
            <FormField id="rule-partner" label="거래처 조건(선택)">
              <Combobox
                aria-label="거래처 조건"
                items={master.partnerItems}
                value={draft.partnerId}
                onChange={(partnerId) => setDraft({ ...draft, partnerId })}
              />
            </FormField>
            <FormField id="rule-min" label="최소 금액(선택)">
              <WonInput
                id="rule-min"
                value={draft.minAmount}
                onValueChange={(minAmount) => setDraft({ ...draft, minAmount })}
              />
            </FormField>
            <FormField id="rule-max" label="최대 금액(선택)">
              <WonInput
                id="rule-max"
                value={draft.maxAmount}
                onValueChange={(maxAmount) => setDraft({ ...draft, maxAmount })}
              />
            </FormField>
            <FormField id="rule-deductible" label="매입세액">
              <Select
                id="rule-deductible"
                value={draft.deductible}
                onChange={(e) => setDraft({ ...draft, deductible: e.target.value as '' | 'false' })}
              >
                <option value="">증빙대로 공제</option>
                <option value="false">불공제(기업업무추진비 등)</option>
              </Select>
            </FormField>
            <FormField id="rule-memo" label="전표 적요(선택)">
              <Input
                id="rule-memo"
                value={draft.memo}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
              />
            </FormField>
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 text-sm font-medium">
              거래 종류{' '}
              <span className="font-normal text-muted-foreground">(고르지 않으면 모두)</span>
            </legend>
            {AUTO_JOURNAL_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.kinds.includes(k)}
                  onChange={(e) => toggleKind(k, e.target.checked)}
                />
                {AUTO_JOURNAL_KIND_LABELS[k]}
              </label>
            ))}
          </fieldset>
          <div className="flex items-end gap-3">
            <FormField id="rule-priority" label="순서" className="w-24">
              <Input
                id="rule-priority"
                type="number"
                min={1}
                max={999}
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 100 })}
              />
            </FormField>
            <Button type="submit" disabled={create.isPending}>
              <Plus />
              규칙 추가
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
