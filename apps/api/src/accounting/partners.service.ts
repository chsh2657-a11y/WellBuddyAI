import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { partners, type Transaction } from '@wellbuddy/db';
import type { PartnerInput, PartnerKind, PartnerUpdateInput } from '@wellbuddy/shared';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { FieldCrypto } from '../common/crypto/field-crypto.js';
import { isForeignKeyViolation, isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

type Row = typeof partners.$inferSelect;

export interface PartnerListOptions {
  q?: string;
  kind?: PartnerKind;
  includeInactive?: boolean;
}

@Injectable()
export class PartnersService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {}

  private purpose(companyId: string) {
    return `partner-bank:${companyId}`;
  }

  async list(options: PartnerListOptions = {}) {
    const q = options.q ? `%${options.q}%` : undefined;
    const rows = await this.db.tenant((tx) =>
      tx
        .select()
        .from(partners)
        .where(
          and(
            options.includeInactive ? undefined : eq(partners.isActive, true),
            options.kind ? eq(partners.kind, options.kind) : undefined,
            q
              ? or(
                  ilike(partners.name, q),
                  ilike(partners.code, q),
                  ilike(partners.bizRegNo, q.replace(/-/g, '')),
                  ilike(partners.representative, q),
                )
              : undefined,
          ),
        )
        .orderBy(asc(partners.code)),
    );
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string) {
    const [row] = await this.db.tenant((tx) =>
      tx.select().from(partners).where(eq(partners.id, id)),
    );
    if (!row) throw new NotFoundException();
    return this.toDto(row);
  }

  async create(input: PartnerInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        const code = input.code || (await this.nextCode(tx));
        const [row] = await tx
          .insert(partners)
          .values({ ...this.toValues(companyId, input), companyId, code, name: input.name })
          .returning();
        await this.audit.record(
          {
            action: 'partner.create',
            entity: 'partner',
            entityId: row!.id,
            after: this.toDto(row!),
          },
          tx,
        );
        return this.toDto(row!);
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async update(id: string, input: PartnerUpdateInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        const [before] = await tx.select().from(partners).where(eq(partners.id, id));
        if (!before) throw new NotFoundException();
        const [after] = await tx
          .update(partners)
          .set({ ...this.toValues(companyId, input), ...(input.code ? { code: input.code } : {}) })
          .where(eq(partners.id, id))
          .returning();
        await this.audit.record(
          {
            action: 'partner.update',
            entity: 'partner',
            entityId: id,
            before: this.toDto(before),
            after: this.toDto(after!),
          },
          tx,
        );
        return this.toDto(after!);
      });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async remove(id: string) {
    try {
      await this.db.tenant(async (tx) => {
        const [row] = await tx.select().from(partners).where(eq(partners.id, id));
        if (!row) throw new NotFoundException();
        await tx.delete(partners).where(eq(partners.id, id));
        await this.audit.record(
          { action: 'partner.delete', entity: 'partner', entityId: id, before: this.toDto(row) },
          tx,
        );
      });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new AppException(
          'PARTNER_IN_USE',
          '전표에 사용된 거래처는 삭제할 수 없습니다. 사용중지해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /** 엑셀 일괄 등록: 사업자등록번호가 같으면 수정, 없으면 추가(사업자번호가 없으면 이름으로 비교). */
  async upsertMany(rows: PartnerInput[]) {
    const { companyId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const existing = await tx
        .select({ id: partners.id, bizRegNo: partners.bizRegNo, name: partners.name })
        .from(partners);
      const byBizNo = new Map(existing.filter((e) => e.bizRegNo).map((e) => [e.bizRegNo!, e.id]));
      const byName = new Map(existing.filter((e) => !e.bizRegNo).map((e) => [e.name, e.id]));
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const id = row.bizRegNo ? byBizNo.get(row.bizRegNo) : byName.get(row.name);
        if (id) {
          await tx.update(partners).set(this.toValues(companyId, row)).where(eq(partners.id, id));
          updated++;
        } else {
          const code = row.code || (await this.nextCode(tx));
          await tx
            .insert(partners)
            .values({ ...this.toValues(companyId, row), companyId, code, name: row.name });
          created++;
        }
      }
      await this.audit.record(
        { action: 'partner.import', entity: 'partner', after: { created, updated } },
        tx,
      );
      return { created, updated };
    });
  }

  /** 숫자 코드 중 가장 큰 값 + 1 (5자리, 예: 00001) */
  private async nextCode(tx: Transaction): Promise<string> {
    const [row] = await tx
      .select({ max: sql<string | null>`max(${partners.code}::bigint)` })
      .from(partners)
      .where(sql`${partners.code} ~ '^[0-9]+$'`);
    const next = Number(row?.max ?? 0) + 1;
    return String(next).padStart(5, '0');
  }

  private toValues(companyId: string, input: PartnerUpdateInput) {
    const { bankAccount, code: _code, ...rest } = input;
    const values: Partial<typeof partners.$inferInsert> = { ...rest };
    if (bankAccount !== undefined) {
      const digits = bankAccount?.replace(/\D/g, '') ?? '';
      values.bankAccountEnc = bankAccount
        ? this.crypto.encrypt(bankAccount, this.purpose(companyId))
        : null;
      values.bankAccountLast4 = digits ? digits.slice(-4) : null;
    }
    return values;
  }

  private toDto(row: Row) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      bizRegNo: row.bizRegNo,
      representative: row.representative,
      businessType: row.businessType,
      businessItem: row.businessItem,
      address: row.address,
      phone: row.phone,
      email: row.email,
      contactName: row.contactName,
      bankName: row.bankName,
      bankAccountMasked: row.bankAccountLast4 ? `****${row.bankAccountLast4}` : null,
      bankHolder: row.bankHolder,
      memo: row.memo,
      isActive: row.isActive,
    };
  }

  private mapError(e: unknown) {
    if (isUniqueViolation(e)) {
      const detail = String((e as { cause?: { constraint?: string } }).cause?.constraint ?? '');
      return new AppException(
        'DUPLICATE_PARTNER',
        detail.includes('bizno')
          ? '같은 사업자등록번호의 거래처가 이미 있습니다.'
          : '같은 코드의 거래처가 이미 있습니다.',
        HttpStatus.CONFLICT,
      );
    }
    return e;
  }
}
