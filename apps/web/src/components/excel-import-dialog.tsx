'use client';

import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError } from '@/lib/api';

interface PreviewRow {
  rowNumber: number;
  values: Record<string, string>;
  errors: { field: string; message: string }[];
}

interface Preview {
  total: number;
  valid: number;
  invalid: number;
  missingHeaders: string[];
  rows: PreviewRow[];
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'include' });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.code ?? 'ERROR',
      body?.message ?? '처리하지 못했습니다.',
      body?.details,
    );
  }
  return body as T;
}

/**
 * 공통 엑셀 일괄 등록 창: 양식 다운로드 → 파일 선택 → 미리보기(행별 오류) → 등록.
 * spec 은 API 의 ImportRegistry 에 등록된 대상(예: business-places).
 */
export function ExcelImportDialog({
  spec,
  title,
  columns,
  onImported,
}: {
  spec: string;
  title: string;
  columns: { key: string; label: string }[];
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function choose(selected: File | undefined) {
    if (!selected) return;
    setFile(selected);
    setBusy(true);
    try {
      setPreview(await upload<Preview>(`/imports/${spec}/preview`, selected));
    } catch (e) {
      setPreview(null);
      toast.error(e instanceof ApiError ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const skip = preview.invalid > 0 ? '?skipInvalid=true' : '';
      const result = await upload<{ created: number; updated: number; skipped: number }>(
        `/imports/${spec}/commit${skip}`,
        file,
      );
      toast.success(
        `${result.created}건 추가, ${result.updated}건 수정${result.skipped ? `, ${result.skipped}건 제외` : ''}`,
      );
      onImported();
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '등록하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload />
          엑셀 업로드
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title} 엑셀 일괄 등록</DialogTitle>
          <DialogDescription>
            양식을 내려받아 작성한 뒤 올려 주세요. 등록 전에 행별 검사 결과를 먼저 보여 드립니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/imports/${spec}/template`} download>
              <Download />
              양식 내려받기
            </a>
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            aria-label="엑셀 파일 선택"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileSpreadsheet />
            {file ? '다른 파일 선택' : '파일 선택 (.xlsx, .csv)'}
          </Button>
          {file ? (
            <span className="truncate text-sm text-muted-foreground">{file.name}</span>
          ) : null}
        </div>

        {preview ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="muted">전체 {preview.total}행</Badge>
              <Badge variant="success">정상 {preview.valid}행</Badge>
              {preview.invalid > 0 ? (
                <Badge variant="danger">오류 {preview.invalid}행</Badge>
              ) : null}
            </div>
            {preview.missingHeaders.length > 0 ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                필수 열이 없습니다: {preview.missingHeaders.join(', ')} — 양식을 다시 내려받아
                주세요.
              </p>
            ) : null}
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">행</TableHead>
                    {columns.map((c) => (
                      <TableHead key={c.key}>{c.label}</TableHead>
                    ))}
                    <TableHead>검사 결과</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow
                      key={row.rowNumber}
                      className={row.errors.length ? 'bg-danger-soft/40' : undefined}
                    >
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.rowNumber}
                      </TableCell>
                      {columns.map((c) => (
                        <TableCell key={c.key}>{row.values[c.key]}</TableCell>
                      ))}
                      <TableCell className="text-xs">
                        {row.errors.length ? (
                          <span className="text-danger">
                            {row.errors
                              .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
                              .join(' · ')}
                          </span>
                        ) : (
                          <span className="text-success">정상</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
          <Button
            onClick={commit}
            disabled={!preview || preview.valid === 0 || preview.missingHeaders.length > 0 || busy}
          >
            {preview && preview.invalid > 0 ? `오류 행 제외하고 ${preview.valid}건 등록` : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
