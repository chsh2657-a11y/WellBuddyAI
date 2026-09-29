'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UPLOAD_KIND_LABELS, UPLOAD_KINDS, type UploadKind } from '@wellbuddy/shared';
import { Eye, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
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
import { formatDate } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  columnChoices,
  formatCell,
  KIND_SHORT_LABELS,
  rowLabel,
  SAMPLE_COLUMNS,
} from '../_components/evidence-format';
import { BANK_ACCOUNTS_KEY, CARDS_KEY } from '../sources/sources-manager';

interface Preview {
  kind: UploadKind;
  headerRow: number;
  headers: string[];
  topRows: string[][];
  mapping: Record<string, number>;
  fields: { key: string; label: string; required: boolean }[];
  savedMappingName: string | null;
  total: number;
  duplicates: number;
  issues: { row: number; message: string }[];
  issueCount: number;
  sample: Record<string, unknown>[];
}

interface CommitResult {
  runId: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  issueCount: number;
  message: string;
}

interface SavedMapping {
  id: string;
  kind: UploadKind;
  name: string;
  headerRow: number;
  mapping: Record<string, number>;
  updatedAt: string;
}

interface Source {
  id: string;
  alias: string;
  isActive: boolean;
  bankName?: string;
  accountNoMasked?: string;
  cardCompanyName?: string;
  cardNoMasked?: string;
}

/** 사용자가 고른 머리글 줄과 열 지정 */
interface Manual {
  headerRow: number;
  mapping: Record<string, number>;
}

const MAPPINGS_KEY = ['evidence', 'mappings'];

/** 어디서 내려받는지 안내 */
const HELP: Record<UploadKind, string> = {
  bank: '인터넷뱅킹 → 거래내역 조회 → 엑셀(또는 CSV) 저장한 파일을 올립니다. 국민·신한·우리·하나·농협·기업은행 양식은 저절로 알아봅니다.',
  card: '카드사 홈페이지 → 법인카드 승인내역 조회 → 엑셀 저장한 파일을 올립니다. 취소 건은 따로 표시합니다.',
  tax_invoice:
    '홈택스 → 전자(세금)계산서 → 목록조회 → 엑셀 내려받기 파일을 올립니다. 매출·매입은 우리 회사 사업자번호로 가릅니다.',
  cash_receipt:
    '홈택스 → 현금영수증 → 매출(또는 매입) 내역 조회 → 엑셀 내려받기 파일을 올립니다. 매출·매입을 골라 주세요.',
};

const onError = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

function send<T>(step: 'preview' | 'commit', file: File, options: object): Promise<T> {
  const form = new FormData();
  form.append('options', JSON.stringify(options));
  form.append('file', file);
  return apiFetch<T>(`/evidence/uploads/${step}`, { method: 'POST', body: form });
}

/** 통장·카드·홈택스 파일 올리기: 종류 선택 → 미리보기(열 지정) → 등록 */
export function UploadWizard() {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const queryClient = useQueryClient();
  const banks = useQuery({
    queryKey: BANK_ACCOUNTS_KEY,
    queryFn: () => apiFetch<Source[]>('/bank-accounts'),
  });
  const cards = useQuery({
    queryKey: CARDS_KEY,
    queryFn: () => apiFetch<Source[]>('/corporate-cards'),
  });

  const [kind, setKind] = useState<UploadKind>('bank');
  const [sourceId, setSourceId] = useState('');
  const [direction, setDirection] = useState<'' | 'sales' | 'purchase'>('');
  const [exempt, setExempt] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [manual, setManual] = useState<Manual | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saveMapping, setSaveMapping] = useState(false);
  const [mappingName, setMappingName] = useState('');
  const [done, setDone] = useState<CommitResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sources =
    kind === 'bank'
      ? (banks.data ?? [])
          .filter((a) => a.isActive)
          .map((a) => ({ id: a.id, label: `${a.alias} (${a.bankName} ${a.accountNoMasked})` }))
      : kind === 'card'
        ? (cards.data ?? [])
            .filter((c) => c.isActive)
            .map((c) => ({
              id: c.id,
              label: `${c.alias} (${c.cardCompanyName} ${c.cardNoMasked})`,
            }))
        : null;
  const selectedSource = sources
    ? sources.some((s) => s.id === sourceId)
      ? sourceId
      : (sources[0]?.id ?? '')
    : '';

  /** 조건이 바뀌면 미리보기를 버린다 */
  const change = (fn: () => void) => {
    fn();
    setPreview(null);
    setManual(null);
    setSaveMapping(false);
  };

  const options = (m: Manual | null) => ({
    kind,
    ...(sources ? { sourceId: selectedSource } : {}),
    ...(direction && (kind === 'tax_invoice' || kind === 'cash_receipt') ? { direction } : {}),
    ...(kind === 'tax_invoice' && exempt ? { exempt: true } : {}),
    ...(m ?? {}),
  });

  const previewMut = useMutation({
    mutationFn: (m: Manual | null) => send<Preview>('preview', file!, options(m)),
    onSuccess: (p, m) => {
      setPreview(p);
      setManual(m);
      setDone(null);
      setMappingName((name) => name || file!.name.replace(/\.[^.]+$/, ''));
    },
    onError,
  });

  const commitMut = useMutation({
    mutationFn: () =>
      send<CommitResult>('commit', file!, {
        ...options(manual),
        ...(saveMapping ? { saveMapping: true, mappingName: mappingName.trim() || undefined } : {}),
      }),
    onSuccess: (r) => {
      toast.success(`${r.inserted}건을 등록했습니다.`);
      setDone(r);
      setPreview(null);
      setManual(null);
      setFile(null);
      setSaveMapping(false);
      setMappingName('');
      if (fileRef.current) fileRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
    },
    onError,
  });

  if (!writable) {
    return <p className="text-sm text-muted-foreground">파일을 올릴 권한이 없습니다.</p>;
  }

  const needsSource = kind === 'bank' || kind === 'card';
  const noSource = needsSource && sources?.length === 0 && (banks.isSuccess || cards.isSuccess);
  const canPreview =
    !!file && (!needsSource || !!selectedSource) && (kind !== 'cash_receipt' || !!direction);
  const newCount = preview ? preview.total - preview.duplicates : 0;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>파일 올리기</CardTitle>
          <CardDescription>{HELP[kind]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canPreview) previewMut.mutate(null);
            }}
          >
            <FormField id="upload-kind" label="자료 종류" className="w-44">
              <Select
                id="upload-kind"
                value={kind}
                onChange={(e) =>
                  change(() => {
                    setKind(e.target.value as UploadKind);
                    setDirection('');
                    setDone(null);
                  })
                }
              >
                {UPLOAD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {UPLOAD_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </FormField>
            {sources ? (
              <FormField
                id="upload-source"
                label={kind === 'bank' ? '계좌' : '카드'}
                className="w-72"
              >
                <Select
                  id="upload-source"
                  value={selectedSource}
                  onChange={(e) => change(() => setSourceId(e.target.value))}
                  disabled={sources.length === 0}
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            {kind === 'tax_invoice' || kind === 'cash_receipt' ? (
              <FormField id="upload-direction" label="매출·매입" className="w-52">
                <Select
                  id="upload-direction"
                  value={direction}
                  onChange={(e) => change(() => setDirection(e.target.value as 'sales'))}
                >
                  <option value="">
                    {kind === 'tax_invoice' ? '사업자번호로 자동 판단' : '골라 주세요'}
                  </option>
                  <option value="sales">매출</option>
                  <option value="purchase">매입</option>
                </Select>
              </FormField>
            ) : null}
            {kind === 'tax_invoice' ? (
              <div className="flex h-10 items-center gap-2">
                <Switch
                  id="upload-exempt"
                  checked={exempt}
                  onCheckedChange={(v) => change(() => setExempt(v))}
                />
                <Label htmlFor="upload-exempt">계산서(면세)</Label>
              </div>
            ) : null}
            <FormField id="upload-file" label="파일" className="w-72">
              <Input
                id="upload-file"
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.html,.htm"
                onChange={(e) =>
                  change(() => {
                    setFile(e.target.files?.[0] ?? null);
                    setDone(null);
                  })
                }
              />
            </FormField>
            <Button type="submit" disabled={!canPreview || previewMut.isPending}>
              <Eye />
              미리보기
            </Button>
          </form>
          {noSource ? (
            <p className="mt-3 text-sm text-warning">
              먼저{' '}
              <Link href="/evidence/sources" className="underline">
                계좌·카드
              </Link>
              에서 {kind === 'bank' ? '계좌' : '카드'}를 등록해 주세요.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {done ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <p className="text-sm" role="status">
              {done.message}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/evidence/records?kind=${kind}`}>수집 내역 보기</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {preview ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>미리보기</CardTitle>
              <div className="flex flex-wrap gap-2 pt-1" aria-label="미리보기 요약">
                <Badge>읽은 거래 {preview.total}건</Badge>
                <Badge variant="success">새로 등록 {newCount}건</Badge>
                {preview.duplicates ? (
                  <Badge variant="muted">이미 등록 {preview.duplicates}건</Badge>
                ) : null}
                {preview.issueCount ? (
                  <Badge variant="warning">읽지 못한 줄 {preview.issueCount}건</Badge>
                ) : null}
                {preview.savedMappingName ? (
                  <Badge variant="muted">저장한 열 지정 ‘{preview.savedMappingName}’ 사용</Badge>
                ) : manual ? (
                  <Badge variant="muted">직접 지정한 열 사용</Badge>
                ) : preview.headerRow >= 0 ? (
                  <Badge variant="muted">양식 자동 인식</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {preview.issues.length ? (
                <ul className="grid gap-1 text-sm text-warning" aria-label="읽지 못한 줄">
                  {preview.issues.slice(0, 10).map((i) => (
                    <li key={`${i.row}-${i.message}`}>
                      {i.row ? `${i.row}행: ` : ''}
                      {i.message}
                    </li>
                  ))}
                  {preview.issueCount > 10 ? <li>외 {preview.issueCount - 10}건</li> : null}
                </ul>
              ) : null}
              {preview.sample.length ? (
                <div className="overflow-x-auto rounded-md border">
                  <Table aria-label="읽은 거래">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">줄</TableHead>
                        {SAMPLE_COLUMNS[preview.kind].map((c) => (
                          <TableHead key={c.key} className={cn(c.type === 'won' && 'text-right')}>
                            {c.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.sample.map((r) => (
                        <TableRow key={String(r.row)}>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {String(r.row)}
                          </TableCell>
                          {SAMPLE_COLUMNS[preview.kind].map((c) => (
                            <TableCell
                              key={c.key}
                              className={cn(c.type === 'won' && 'text-right tabular-nums')}
                            >
                              {formatCell(r[c.key], c.type)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {preview.total > preview.sample.length ? (
                    <p className="p-3 text-xs text-muted-foreground">
                      앞 {preview.sample.length}건만 보여 줍니다.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {preview.headerRow >= 0 || manual ? (
                <div className="flex flex-wrap items-end gap-3 border-t pt-4">
                  <div className="flex h-10 items-center gap-2">
                    <Switch
                      id="save-mapping"
                      checked={saveMapping}
                      onCheckedChange={setSaveMapping}
                    />
                    <Label htmlFor="save-mapping">이 열 지정을 저장해 같은 양식에 다시 쓰기</Label>
                  </div>
                  {saveMapping ? (
                    <FormField id="mapping-name" label="양식 이름" className="w-56">
                      <Input
                        id="mapping-name"
                        value={mappingName}
                        maxLength={50}
                        onChange={(e) => setMappingName(e.target.value)}
                      />
                    </FormField>
                  ) : null}
                  <Button
                    className="ml-auto"
                    disabled={preview.total === 0 || commitMut.isPending}
                    onClick={() => commitMut.mutate()}
                  >
                    <Upload />
                    {newCount}건 등록
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <MappingEditor
            key={`${preview.headerRow}:${JSON.stringify(preview.mapping)}:${preview.total}`}
            preview={preview}
            busy={previewMut.isPending}
            onApply={(m) => previewMut.mutate(m)}
          />
        </>
      ) : null}

      <SavedMappings />
    </div>
  );
}

/** 머리글 줄과 필드별 열을 직접 고른다(처음 보는 양식이나 잘못 알아본 열) */
function MappingEditor({
  preview,
  busy,
  onApply,
}: {
  preview: Preview;
  busy: boolean;
  onApply: (m: Manual) => void;
}) {
  const [headerRow, setHeaderRow] = useState(Math.max(preview.headerRow, 0));
  const [mapping, setMapping] = useState<Record<string, number>>(preview.mapping);
  const choices = columnChoices(preview.topRows, headerRow);

  return (
    <Card>
      <CardHeader>
        <CardTitle>열 지정</CardTitle>
        <CardDescription>
          {preview.headerRow < 0
            ? '머리글을 알아보지 못했습니다. 머리글 줄과 각 항목이 들어 있는 열을 골라 주세요.'
            : '잘못 읽은 항목이 있으면 열을 바꾸고 다시 읽어 주세요.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormField id="map-header-row" label="머리글 줄" className="max-w-xl">
          <Select
            id="map-header-row"
            value={headerRow}
            onChange={(e) => setHeaderRow(Number(e.target.value))}
          >
            {preview.topRows.map((r, i) => (
              <option key={i} value={i}>
                {rowLabel(r, i)}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {preview.fields.map((f) => (
            <FormField
              key={f.key}
              id={`map-${f.key}`}
              label={f.label}
              hint={f.required ? '필수' : undefined}
            >
              <Select
                id={`map-${f.key}`}
                value={mapping[f.key] ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setMapping((prev) => {
                    const next = { ...prev };
                    if (value === '') delete next[f.key];
                    else next[f.key] = Number(value);
                    return next;
                  });
                }}
              >
                <option value="">(쓰지 않음)</option>
                {choices.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ))}
        </div>
        <div>
          <Button variant="outline" disabled={busy} onClick={() => onApply({ headerRow, mapping })}>
            이 열 지정으로 다시 읽기
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SavedMappings() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: MAPPINGS_KEY,
    queryFn: () => apiFetch<SavedMapping[]>('/evidence/mappings'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/evidence/mappings/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: MAPPINGS_KEY }),
    onError,
  });
  if (!list.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>저장한 열 지정</CardTitle>
        <CardDescription>
          머리글이 같은 파일을 올리면 저장한 열 지정을 저절로 씁니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>양식 이름</TableHead>
                <TableHead>자료 종류</TableHead>
                <TableHead>머리글 줄</TableHead>
                <TableHead>저장일</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{KIND_SHORT_LABELS[m.kind]}</TableCell>
                  <TableCell className="tabular-nums">{m.headerRow + 1}행</TableCell>
                  <TableCell>{formatDate(m.updatedAt)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${m.name} 삭제`}
                      onClick={() =>
                        confirm(`'${m.name}' 열 지정을 지울까요?`) && remove.mutate(m.id)
                      }
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
