'use client';

import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api';
import type { AttachedFile } from './types';

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 파일을 올린다(POST /files). 전표에 붙이는 건 부모가 한다. */
export async function uploadFile(file: File): Promise<AttachedFile> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<AttachedFile>('/files', { method: 'POST', body: form });
}

/**
 * 증빙 첨부 목록. 영수증·세금계산서 사진, PDF 를 여러 개 올릴 수 있다.
 * canRemove 가 false 면(전기한 전표) 추가만 가능하다.
 */
export function AttachmentsField({
  files,
  onAdd,
  onRemove,
  canAdd = true,
  canRemove = true,
}: {
  files: AttachedFile[];
  onAdd: (files: AttachedFile[]) => void | Promise<void>;
  onRemove: (file: AttachedFile) => void | Promise<void>;
  canAdd?: boolean;
  canRemove?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      const uploaded: AttachedFile[] = [];
      for (const file of Array.from(list)) uploaded.push(await uploadFile(file));
      await onAdd(uploaded);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '파일을 올리지 못했습니다.');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {files.map((f) => (
          <span
            key={f.id}
            className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-xs"
          >
            {f.mimeType.startsWith('image/') ? (
              <ImageIcon className="size-3.5 text-muted-foreground" />
            ) : (
              <FileText className="size-3.5 text-muted-foreground" />
            )}
            <a
              href={`/api/files/${f.id}/download`}
              target="_blank"
              rel="noreferrer"
              className="max-w-48 truncate hover:underline"
            >
              {f.filename}
            </a>
            <span className="text-muted-foreground">{sizeLabel(f.sizeBytes)}</span>
            {canRemove ? (
              <button
                type="button"
                aria-label={`${f.filename} 첨부 삭제`}
                className="rounded p-0.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                onClick={() => void onRemove(f)}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </span>
        ))}
        {canAdd ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              <Paperclip />
              {uploading ? '올리는 중…' : '증빙 첨부'}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="증빙 파일"
              accept="image/*,application/pdf"
              onChange={(e) => void upload(e.target.files)}
            />
          </>
        ) : null}
      </div>
      {files.length === 0 && canAdd ? (
        <p className="text-xs text-muted-foreground">
          영수증·세금계산서 사진이나 PDF 를 붙여 두면 나중에 찾기 쉽습니다(파일당 10MB).
        </p>
      ) : null}
    </div>
  );
}
