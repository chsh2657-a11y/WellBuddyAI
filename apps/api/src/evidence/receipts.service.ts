import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isValidBizNo, normalizeBizNo } from '@wellbuddy/accounting-core';
import {
  cardTransactions,
  fileObjects,
  journalAttachments,
  journalEntries,
  receipts,
  type Transaction,
} from '@wellbuddy/db';
import { ProviderRegistry, type ReceiptFields } from '@wellbuddy/integrations';
import {
  BAD_BIZ_NO_STATUSES,
  type BizNoStatus,
  formatJournalNo,
  getProvider,
  type ReceiptListQuery,
  type ReceiptUpdateInput,
} from '@wellbuddy/shared';
import { and, desc, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { FilesService } from '../files/files.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { STORAGE, type StorageDriver } from '../storage/storage.js';

/** 영수증으로 받는 형식(사진·스캔 PDF) */
const RECEIPT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'application/pdf',
]);
/** 이 신뢰도보다 낮으면 사람이 확인하게 검토 필요로 둔다 */
export const RECEIPT_REVIEW_CONFIDENCE = 0.8;

type ReceiptRow = typeof receipts.$inferSelect;

interface OcrOutcome {
  fields: ReceiptFields | null;
  provider: string | null;
  error: string | null;
}

/** 검토 필요 여부: 날짜·합계가 없거나, 인식 신뢰도가 낮거나, 사업자번호가 문제면 */
function receiptStatus(r: {
  txDate: string | null;
  totalAmount: number | null;
  bizNoStatus: string | null;
  confidence: number | null;
}): 'pending' | 'review' {
  if (!r.txDate || !r.totalAmount) return 'review';
  if (r.confidence !== null && r.confidence < RECEIPT_REVIEW_CONFIDENCE) return 'review';
  if (r.bizNoStatus && BAD_BIZ_NO_STATUSES.includes(r.bizNoStatus as BizNoStatus)) {
    return 'review';
  }
  return 'pending';
}

/** 카드와 짝지었거나 전표로 만든 영수증은 고치거나 지울 수 없다 */
function assertEditable(row: ReceiptRow) {
  if (row.status === 'matched' || row.status === 'posted') {
    throw new AppException(
      'RECEIPT_LOCKED',
      row.status === 'matched'
        ? '카드 승인과 짝지은 영수증은 고치거나 지울 수 없습니다.'
        : '전표로 만든 영수증은 고치거나 지울 수 없습니다.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 영수증 업로드 → OCR → 증빙 등록, 사업자번호 확인(P2-18).
 * OCR·사업자 상태 조회 공급자는 연동관리 설정(ocr·bizcheck 채널)으로 고른다.
 * OCR 이 꺼져 있거나 실패하면 빈 영수증을 만들어 직접 입력하게 한다.
 * 카드 승인과의 짝짓기는 자동분개 실행 때 한다(AutoJournalService).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly integrations: IntegrationsService,
    private readonly registry: ProviderRegistry,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  // ── 조회 ────────────────────────────────────────────

  private async load(tx: Transaction, where: ReturnType<typeof and>, limit = 500) {
    const rows = await tx
      .select({
        r: receipts,
        filename: fileObjects.filename,
        mimeType: fileObjects.mimeType,
        cardMerchant: cardTransactions.merchantName,
        cardApprovalNo: cardTransactions.approvalNo,
        cardDate: cardTransactions.approvedDate,
        cardAmount: cardTransactions.amount,
        entryDate: journalEntries.entryDate,
        entryNo: journalEntries.entryNo,
      })
      .from(receipts)
      .leftJoin(fileObjects, eq(fileObjects.id, receipts.fileId))
      .leftJoin(cardTransactions, eq(cardTransactions.id, receipts.cardTransactionId))
      .leftJoin(journalEntries, eq(journalEntries.id, receipts.entryId))
      .where(where)
      .orderBy(desc(receipts.createdAt))
      .limit(limit);
    return rows.map(({ r, ...j }) => ({
      id: r.id,
      fileId: r.fileId,
      filename: j.filename,
      mimeType: j.mimeType,
      txDate: r.txDate,
      merchantName: r.merchantName,
      bizNo: r.bizNo,
      bizNoStatus: r.bizNoStatus as BizNoStatus | null,
      totalAmount: r.totalAmount,
      vatAmount: r.vatAmount,
      ocrProvider: r.ocrProvider,
      ocrError: typeof r.ocrResult?.error === 'string' ? r.ocrResult.error : null,
      confidence: r.confidence === null ? null : Math.round(r.confidence * 100) / 100,
      card:
        r.cardTransactionId && j.cardApprovalNo
          ? {
              id: r.cardTransactionId,
              merchantName: j.cardMerchant!,
              approvalNo: j.cardApprovalNo,
              approvedDate: j.cardDate!,
              amount: j.cardAmount!,
            }
          : null,
      source: r.source,
      status: r.status,
      entryId: r.entryId,
      entryNumber:
        j.entryDate && j.entryNo !== null ? formatJournalNo(j.entryDate, j.entryNo) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  list(q: ReceiptListQuery) {
    return this.db.tenant((tx) =>
      this.load(tx, and(q.status ? eq(receipts.status, q.status) : undefined)),
    );
  }

  async get(id: string) {
    const [row] = await this.db.tenant((tx) => this.load(tx, and(eq(receipts.id, id)), 1));
    if (!row) throw new NotFoundException();
    return row;
  }

  // ── 외부 공급자 ──────────────────────────────────────

  private async recognize(file: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<OcrOutcome> {
    const setting = await this.integrations.providerSetting('ocr');
    if (!setting.enabled) return { fields: null, provider: null, error: null };
    const label = getProvider('ocr', setting.provider)?.label ?? setting.provider;
    try {
      const { companyId } = requireCompanyContext();
      const ocr = this.registry.resolve('ocr', setting, {
        companyId,
        companyName: '',
        bizNo: null,
      });
      const fields = await ocr.extractReceipt({
        data: file.buffer,
        mimeType: file.mimeType,
        filename: file.filename,
      });
      return { fields, provider: setting.provider, error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { fields: null, provider: setting.provider, error: `${label}: ${message}` };
    }
  }

  /** 번호별 상태. 검증번호가 틀리면 invalid, 국세청 조회는 연동관리에서 켠 경우에만 한다 */
  private async bizNoStatuses(bizNos: string[]) {
    const result = new Map<string, BizNoStatus>();
    const valid = [...new Set(bizNos)].filter((b) => {
      if (isValidBizNo(b)) return true;
      result.set(b, 'invalid');
      return false;
    });
    if (valid.length === 0) return { result, error: null };
    const setting = await this.integrations.providerSetting('bizcheck');
    let error: string | null = null;
    if (setting.enabled && this.registry.has('bizcheck', setting.provider)) {
      try {
        const { companyId } = requireCompanyContext();
        const checker = this.registry.resolve('bizcheck', setting, {
          companyId,
          companyName: '',
          bizNo: null,
        });
        const status = await checker.check(valid);
        for (const b of valid) result.set(b, status.get(b) ?? 'unknown');
        return { result, error };
      } catch (e) {
        error = `사업자 상태를 조회하지 못해 번호 형식만 확인했습니다: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    for (const b of valid) result.set(b, 'valid');
    return { result, error };
  }

  private async bizNoStatus(bizNo: string | null) {
    if (!bizNo) return { status: null, error: null };
    const { result, error } = await this.bizNoStatuses([bizNo]);
    return { status: result.get(bizNo) ?? null, error };
  }

  // ── 등록·수정·삭제 ────────────────────────────────────

  async upload(file: { buffer: Buffer; originalname: string }) {
    const { companyId, userId } = requireCompanyContext();
    if (file.buffer.length === 0) throw new AppException('FILE_EMPTY', '빈 파일입니다.');
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !RECEIPT_MIME.has(detected.mime)) {
      throw new AppException(
        'UNSUPPORTED_FILE_TYPE',
        '영수증은 사진(JPG·PNG·WEBP·HEIC)이나 PDF 로 올려 주세요.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const dedupeHash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = async () => {
      const [row] = await this.db.tenant((tx) =>
        this.load(tx, and(eq(receipts.dedupeHash, dedupeHash)), 1),
      );
      return row ? { ...row, duplicate: true, message: '이미 올린 영수증입니다.' } : null;
    };
    const existing = await duplicate();
    if (existing) return existing;

    const meta = await this.files.upload(file);
    const ocr = await this.recognize({
      buffer: file.buffer,
      mimeType: meta.mimeType,
      filename: meta.filename,
    });
    const f = ocr.fields;
    const bizNo = f?.bizNo ? (normalizeBizNo(f.bizNo) ?? f.bizNo) : null;
    const biz = await this.bizNoStatus(bizNo);
    const values = {
      txDate: f?.date ?? null,
      merchantName: f?.merchantName ?? null,
      bizNo,
      totalAmount: f?.totalAmount ?? null,
      vatAmount: f?.vatAmount ?? null,
      confidence: f ? f.confidence : null,
      bizNoStatus: biz.status,
    };

    const id = await this.db.tenant(async (tx) => {
      const [row] = await tx
        .insert(receipts)
        .values({
          companyId,
          fileId: meta.id,
          ...values,
          ocrProvider: ocr.provider,
          ocrResult: {
            ...(f ? { fields: f } : {}),
            ...(ocr.error ? { error: ocr.error } : {}),
          },
          uploadedBy: userId,
          source: 'file',
          dedupeHash,
          status: f ? receiptStatus(values) : 'review',
        })
        .onConflictDoNothing()
        .returning({ id: receipts.id });
      if (!row) return null;
      await this.audit.record(
        {
          action: 'receipt.upload',
          entity: 'receipt',
          entityId: row.id,
          after: { filename: meta.filename, ocrProvider: ocr.provider, ...values },
        },
        tx,
      );
      return row.id;
    });
    if (!id) {
      // 동시에 같은 파일을 올렸다: 먼저 들어간 것을 돌려주고 방금 올린 파일은 지운다
      await this.removeFile(meta.id).catch(() => undefined);
      return (await duplicate())!;
    }
    const message = [
      ocr.error
        ? `영수증을 읽지 못했습니다. 값을 직접 입력해 주세요. (${ocr.error})`
        : !f
          ? 'OCR 이 꺼져 있어 값을 직접 입력해 주세요.'
          : null,
      biz.error,
    ]
      .filter(Boolean)
      .join(' ');
    return { ...(await this.get(id)), duplicate: false, message: message || null };
  }

  private async findRow(tx: Transaction, id: string) {
    const [row] = await tx.select().from(receipts).where(eq(receipts.id, id)).for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  async update(id: string, input: ReceiptUpdateInput) {
    const current = await this.db.tenant((tx) => this.findRow(tx, id));
    assertEditable(current);
    const bizNoChanged = input.bizNo !== undefined;
    const bizNo = bizNoChanged
      ? input.bizNo
        ? (normalizeBizNo(input.bizNo) ?? input.bizNo.replace(/\s/g, ''))
        : null
      : current.bizNo;
    const biz = bizNoChanged ? await this.bizNoStatus(bizNo) : null;

    await this.db.tenant(async (tx) => {
      const row = await this.findRow(tx, id);
      assertEditable(row);
      const next = {
        txDate: input.txDate !== undefined ? input.txDate : row.txDate,
        merchantName:
          input.merchantName !== undefined ? input.merchantName || null : row.merchantName,
        bizNo,
        bizNoStatus: biz ? biz.status : row.bizNoStatus,
        totalAmount: input.totalAmount !== undefined ? input.totalAmount : row.totalAmount,
        vatAmount: input.vatAmount !== undefined ? input.vatAmount : row.vatAmount,
      };
      if (
        next.totalAmount !== null &&
        next.vatAmount !== null &&
        next.vatAmount > next.totalAmount
      ) {
        throw new AppException('VALIDATION_ERROR', '부가세가 합계보다 큽니다.');
      }
      // 사람이 확인한 값이라 인식 신뢰도는 따지지 않는다
      const status =
        row.status === 'ignored' ? 'ignored' : receiptStatus({ ...next, confidence: null });
      await tx
        .update(receipts)
        .set({ ...next, status, updatedAt: new Date() })
        .where(eq(receipts.id, id));
      await this.audit.record(
        {
          action: 'receipt.update',
          entity: 'receipt',
          entityId: id,
          before: {
            txDate: row.txDate,
            merchantName: row.merchantName,
            bizNo: row.bizNo,
            totalAmount: row.totalAmount,
            vatAmount: row.vatAmount,
          },
          after: next,
        },
        tx,
      );
    });
    return { ...(await this.get(id)), message: biz?.error ?? null };
  }

  /** 사업자번호 상태를 다시 조회한다(국세청 조회를 켠 뒤 등) */
  async verifyBizNo(id: string) {
    const current = await this.db.tenant((tx) => this.findRow(tx, id));
    if (!current.bizNo) {
      throw new AppException('BIZ_NO_REQUIRED', '사업자번호를 먼저 입력해 주세요.');
    }
    const biz = await this.bizNoStatus(current.bizNo);
    await this.db.tenant(async (tx) => {
      const row = await this.findRow(tx, id);
      const status =
        row.status === 'pending' || row.status === 'review'
          ? receiptStatus({ ...row, bizNoStatus: biz.status, confidence: null })
          : row.status;
      await tx
        .update(receipts)
        .set({ bizNoStatus: biz.status, status, updatedAt: new Date() })
        .where(eq(receipts.id, id));
    });
    return { ...(await this.get(id)), message: biz.error };
  }

  async remove(id: string) {
    const fileId = await this.db.tenant(async (tx) => {
      const row = await this.findRow(tx, id);
      assertEditable(row);
      await tx.delete(receipts).where(eq(receipts.id, id));
      await this.audit.record(
        {
          action: 'receipt.delete',
          entity: 'receipt',
          entityId: id,
          before: { merchantName: row.merchantName, totalAmount: row.totalAmount },
        },
        tx,
      );
      return row.fileId;
    });
    if (fileId) await this.removeFile(fileId);
  }

  /** 영수증 원본 파일을 지운다(전표에 첨부한 파일은 남긴다) */
  private async removeFile(fileId: string) {
    const key = await this.db.tenant(async (tx) => {
      const [attached] = await tx
        .select({ fileId: journalAttachments.fileId })
        .from(journalAttachments)
        .where(eq(journalAttachments.fileId, fileId))
        .limit(1);
      if (attached) return null;
      const [file] = await tx
        .delete(fileObjects)
        .where(eq(fileObjects.id, fileId))
        .returning({ storageKey: fileObjects.storageKey });
      return file?.storageKey ?? null;
    });
    if (key) await this.storage.delete(key).catch(() => undefined);
  }
}
