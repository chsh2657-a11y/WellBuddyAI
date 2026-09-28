import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { fileObjects } from '@wellbuddy/db';
import { eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { STORAGE, type StorageDriver } from '../storage/storage.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 증빙·결재 첨부로 받을 수 있는 형식(실제 파일 내용으로 판별, 확장자만 바꾼 파일은 거부) */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const TEXT_EXT = /\.(csv|txt)$/i;

export interface FileMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

function isProbablyText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 8000).includes(0);
}

@Injectable()
export class FilesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async upload(file: { buffer: Buffer; originalname: string }): Promise<FileMeta> {
    const { companyId, userId } = requireCompanyContext();
    if (file.buffer.length === 0) throw new AppException('FILE_EMPTY', '빈 파일입니다.');
    if (file.buffer.length > MAX_FILE_BYTES) {
      throw new AppException(
        'FILE_TOO_LARGE',
        '10MB 이하 파일만 올릴 수 있습니다.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    let mimeType: string | undefined = detected?.mime;
    if (!detected && TEXT_EXT.test(file.originalname) && isProbablyText(file.buffer)) {
      mimeType = file.originalname.toLowerCase().endsWith('.csv') ? 'text/csv' : 'text/plain';
    }
    if (!mimeType || !(ALLOWED_MIME.has(mimeType) || mimeType.startsWith('text/'))) {
      throw new AppException(
        'UNSUPPORTED_FILE_TYPE',
        '이미지(JPG·PNG·WEBP·HEIC), PDF, 엑셀, CSV 파일만 올릴 수 있습니다.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    const now = new Date();
    const storageKey = `${companyId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.put(storageKey, file.buffer, mimeType);

    try {
      return await this.db.tenant(async (tx) => {
        const [row] = await tx
          .insert(fileObjects)
          .values({
            companyId,
            storageKey,
            filename: file.originalname.slice(0, 255),
            mimeType,
            sizeBytes: file.buffer.length,
            sha256,
            uploadedBy: userId,
          })
          .returning();
        await this.audit.record(
          {
            action: 'file.upload',
            entity: 'file',
            entityId: row!.id,
            after: { filename: row!.filename, mimeType, size: row!.sizeBytes },
          },
          tx,
        );
        return this.toMeta(row!);
      });
    } catch (e) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw e;
    }
  }

  async get(id: string) {
    const [row] = await this.db.tenant((tx) =>
      tx.select().from(fileObjects).where(eq(fileObjects.id, id)),
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  async download(id: string) {
    const row = await this.get(id);
    return { meta: this.toMeta(row), body: await this.storage.get(row.storageKey) };
  }

  /** 올린 사람 또는 대표·관리자만 삭제할 수 있다. */
  async remove(id: string): Promise<void> {
    const ctx = requireCompanyContext();
    const row = await this.get(id);
    if (row.uploadedBy !== ctx.userId && ctx.role !== 'owner' && ctx.role !== 'admin') {
      throw new AppException(
        'FORBIDDEN',
        '올린 사람이나 관리자만 삭제할 수 있습니다.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.db.tenant(async (tx) => {
      await tx.delete(fileObjects).where(eq(fileObjects.id, id));
      await this.audit.record(
        { action: 'file.delete', entity: 'file', entityId: id, before: { filename: row.filename } },
        tx,
      );
    });
    await this.storage.delete(row.storageKey).catch(() => undefined);
  }

  toMeta(row: typeof fileObjects.$inferSelect): FileMeta {
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
