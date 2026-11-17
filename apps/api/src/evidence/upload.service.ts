import { Injectable } from '@nestjs/common';
import {
  bankAccounts,
  companies,
  corporateCards,
  importMappings,
  type Transaction,
} from '@wellbuddy/db';
import {
  BANK_FIELDS,
  type BankTransactionRecord,
  type CardApprovalRecord,
  CARD_FIELDS,
  CASH_RECEIPT_FIELDS,
  cashReceiptHash,
  type CashReceiptRecord,
  normalizeHeader,
  parseBankRows,
  parseCardRows,
  parseCashReceiptRows,
  parseTaxInvoiceRows,
  type ParseResult,
  TAX_INVOICE_FIELDS,
  taxInvoiceHash,
  type TaxInvoiceRecord,
} from '@wellbuddy/integrations';
import type { UploadKind, UploadOptions } from '@wellbuddy/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { parseTabular, TabularParseError } from '../imports/tabular.js';
import { EvidenceStore } from './evidence-store.service.js';

const FIELDS = {
  bank: BANK_FIELDS,
  card: CARD_FIELDS,
  tax_invoice: TAX_INVOICE_FIELDS,
  cash_receipt: CASH_RECEIPT_FIELDS,
} as const;

export const CHANNEL_OF: Record<UploadKind, 'bank' | 'card' | 'hometax'> = {
  bank: 'bank',
  card: 'card',
  tax_invoice: 'hometax',
  cash_receipt: 'hometax',
};

type Parsed =
  | { kind: 'bank'; result: ParseResult<BankTransactionRecord, string> }
  | { kind: 'card'; result: ParseResult<CardApprovalRecord, string> }
  | { kind: 'tax_invoice'; result: ParseResult<TaxInvoiceRecord, string> }
  | { kind: 'cash_receipt'; result: ParseResult<CashReceiptRecord, string> };

/** 미리보기에 돌려줄 파일 앞부분(머리글 자동 인식이 살펴보는 범위와 같다) */
const TOP_ROWS = 30;
const TOP_COLS = 40;

/** 머리글 줄 서명: 같은 양식인지 알아보는 데 쓴다 */
export function headerSignature(row: string[] | undefined): string {
  return (row ?? []).map((c) => normalizeHeader(c ?? '')).join('|');
}

/**
 * 은행·카드·홈택스 파일 업로드: 읽기 → (저장한 매핑 또는 자동 인식) → 미리보기(중복 건수) → 등록.
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly db: DbService,
    private readonly store: EvidenceStore,
    private readonly audit: AuditService,
  ) {}

  private async readRows(file: Express.Multer.File) {
    try {
      return await parseTabular(file.buffer, file.originalname);
    } catch (e) {
      if (e instanceof TabularParseError) throw new AppException('FILE_UNREADABLE', e.message);
      throw new AppException(
        'FILE_UNREADABLE',
        '파일을 읽지 못했습니다. 엑셀(.xlsx)·CSV 인지 확인해 주세요.',
      );
    }
  }

  private async assertSource(tx: Transaction, opts: UploadOptions) {
    if (opts.kind === 'bank') {
      const [row] = await tx
        .select({ isActive: bankAccounts.isActive })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, opts.sourceId!));
      if (!row) throw new AppException('NOT_FOUND', '없는 계좌입니다.');
      if (!row.isActive) throw new AppException('SOURCE_INACTIVE', '사용 중지한 계좌입니다.');
    }
    if (opts.kind === 'card') {
      const [row] = await tx
        .select({ isActive: corporateCards.isActive })
        .from(corporateCards)
        .where(eq(corporateCards.id, opts.sourceId!));
      if (!row) throw new AppException('NOT_FOUND', '없는 카드입니다.');
      if (!row.isActive) throw new AppException('SOURCE_INACTIVE', '사용 중지한 카드입니다.');
    }
  }

  /** 사용자가 고른 매핑 → 저장한 매핑(머리글이 같으면) → 자동 인식 순서 */
  private async resolveMapping(tx: Transaction, rows: string[][], opts: UploadOptions) {
    if (opts.mapping && opts.headerRow !== undefined) {
      return { headerRow: opts.headerRow, mapping: opts.mapping, savedName: null };
    }
    const saved = await tx.select().from(importMappings).where(eq(importMappings.kind, opts.kind));
    const hit = saved.find((s) => headerSignature(rows[s.headerRow]) === s.signature);
    return hit
      ? { headerRow: hit.headerRow, mapping: hit.mapping, savedName: hit.name }
      : { headerRow: undefined, mapping: undefined, savedName: null };
  }

  private async parse(
    tx: Transaction,
    rows: string[][],
    opts: UploadOptions,
  ): Promise<{ parsed: Parsed; savedName: string | null }> {
    const resolved = await this.resolveMapping(tx, rows, opts);
    const given = { headerRow: resolved.headerRow, mapping: resolved.mapping };
    const savedName = resolved.savedName;
    switch (opts.kind) {
      case 'bank':
        return { parsed: { kind: 'bank', result: parseBankRows(rows, given) }, savedName };
      case 'card':
        return { parsed: { kind: 'card', result: parseCardRows(rows, given) }, savedName };
      case 'tax_invoice': {
        const { companyId } = requireCompanyContext();
        const [company] = await tx
          .select({ bizRegNo: companies.bizRegNo })
          .from(companies)
          .where(eq(companies.id, companyId));
        const result = parseTaxInvoiceRows(rows, {
          ...given,
          companyBizNo: company?.bizRegNo,
          direction: opts.direction,
          exempt: opts.exempt,
        });
        return { parsed: { kind: 'tax_invoice', result }, savedName };
      }
      case 'cash_receipt': {
        const result = parseCashReceiptRows(rows, { ...given, direction: opts.direction! });
        return { parsed: { kind: 'cash_receipt', result }, savedName };
      }
    }
  }

  private hashes(parsed: Parsed, sourceId: string | undefined): string[] {
    switch (parsed.kind) {
      case 'bank':
        return this.store.bankHashes(
          sourceId!,
          parsed.result.records.map((r) => r.record),
        );
      case 'card':
        return this.store.cardHashes(
          sourceId!,
          parsed.result.records.map((r) => r.record),
        );
      case 'tax_invoice':
        return parsed.result.records.map((r) => taxInvoiceHash(r.record));
      case 'cash_receipt':
        return parsed.result.records.map((r) => cashReceiptHash(r.record));
    }
  }

  private insert(tx: Transaction, parsed: Parsed, sourceId: string | undefined, runId: string) {
    switch (parsed.kind) {
      case 'bank':
        return this.store.insertBank(
          tx,
          sourceId!,
          parsed.result.records.map((r) => r.record),
          'file',
          runId,
        );
      case 'card':
        return this.store.insertCards(
          tx,
          sourceId!,
          parsed.result.records.map((r) => r.record),
          'file',
          runId,
        );
      case 'tax_invoice':
        return this.store.insertTaxInvoices(
          tx,
          parsed.result.records.map((r) => r.record),
          'file',
          runId,
        );
      case 'cash_receipt':
        return this.store.insertCashReceipts(
          tx,
          parsed.result.records.map((r) => r.record),
          'file',
          runId,
        );
    }
  }

  async preview(file: Express.Multer.File, opts: UploadOptions) {
    const rows = await this.readRows(file);
    return this.db.tenant(async (tx) => {
      await this.assertSource(tx, opts);
      const { parsed, savedName } = await this.parse(tx, rows, opts);
      const result = parsed.result;
      const existing = await this.store.existingHashes(
        tx,
        opts.kind,
        this.hashes(parsed, opts.sourceId),
      );
      return {
        kind: opts.kind,
        headerRow: result.headerRow,
        headers: result.headers,
        // 머리글을 못 찾았거나 사용자가 다시 고를 때 보여 줄 파일 앞부분
        topRows: rows
          .slice(0, TOP_ROWS)
          .map((r) => r.slice(0, TOP_COLS).map((c) => String(c ?? '').slice(0, 40))),
        mapping: result.mapping as Record<string, number>,
        fields: FIELDS[opts.kind].map((f) => ({
          key: f.key,
          label: f.label,
          required: f.required,
        })),
        savedMappingName: savedName,
        total: result.records.length,
        duplicates: existing.size,
        issues: result.issues.slice(0, 100),
        issueCount: result.issues.length,
        sample: result.records.slice(0, 20).map((r) => ({ row: r.row, ...r.record })),
      };
    });
  }

  async commit(file: Express.Multer.File, opts: UploadOptions) {
    const { companyId } = requireCompanyContext();
    const rows = await this.readRows(file);
    return this.db.tenant(async (tx) => {
      await this.assertSource(tx, opts);
      const { parsed } = await this.parse(tx, rows, opts);
      const result = parsed.result;
      if (result.records.length === 0) {
        throw new AppException(
          'UPLOAD_EMPTY',
          result.issues[0]?.message ?? '등록할 거래가 없습니다.',
          400,
          { issues: result.issues.slice(0, 100) },
        );
      }
      const channel = CHANNEL_OF[opts.kind];
      const runId = await this.store.startRun(tx, channel, 'file', 'file');
      const inserted = await this.insert(tx, parsed, opts.sourceId, runId);
      const message = `${file.originalname}: ${inserted.inserted}건 등록, 중복 ${inserted.duplicates}건${
        result.issues.length ? `, 읽지 못한 줄 ${result.issues.length}건` : ''
      }`;
      await this.store.finishRun(tx, runId, channel, { ...inserted, status: 'success', message });

      if (opts.saveMapping && result.headerRow >= 0) {
        const signature = headerSignature(result.headers);
        const values = {
          name: opts.mappingName || file.originalname,
          headerRow: result.headerRow,
          mapping: result.mapping as Record<string, number>,
          updatedAt: new Date(),
        };
        await tx
          .insert(importMappings)
          .values({ companyId, kind: opts.kind, signature, ...values })
          .onConflictDoUpdate({
            target: [importMappings.companyId, importMappings.kind, importMappings.signature],
            set: values,
          });
      }
      await this.audit.record(
        {
          action: 'evidence.upload',
          entity: 'collection_run',
          entityId: runId,
          after: { kind: opts.kind, file: file.originalname, ...inserted },
        },
        tx,
      );
      return { runId, ...inserted, issueCount: result.issues.length, message };
    });
  }

  async listMappings(kind?: UploadKind) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select()
        .from(importMappings)
        .where(kind ? eq(importMappings.kind, kind) : undefined)
        .orderBy(importMappings.kind, importMappings.name);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        headerRow: r.headerRow,
        mapping: r.mapping,
        updatedAt: r.updatedAt.toISOString(),
      }));
    });
  }

  async removeMapping(id: string) {
    await this.db.tenant(async (tx) => {
      const [row] = await tx
        .delete(importMappings)
        .where(and(eq(importMappings.id, id)))
        .returning();
      if (!row) throw new AppException('NOT_FOUND', '없는 매핑입니다.', 404);
    });
  }
}
