import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { type Transaction, warehouses } from '@wellbuddy/db';
import type { WarehouseInput, WarehouseUpdateInput } from '@wellbuddy/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

type Row = typeof warehouses.$inferSelect;

/** 창고. 처음 열면 '기본창고'(W01)를 만들어 둔다. */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(options: { includeInactive?: boolean } = {}) {
    return this.db.tenant(async (tx) => {
      await this.ensureDefaultIn(tx);
      const rows = await tx.select().from(warehouses).orderBy(asc(warehouses.code));
      return rows.filter((r) => options.includeInactive || r.isActive).map((r) => this.toDto(r));
    });
  }

  /** 창고가 하나도 없으면 기본창고를 만들고, 사용 중인 첫 창고를 돌려준다. */
  async ensureDefaultIn(tx: Transaction): Promise<Row> {
    const { companyId } = requireCompanyContext();
    const rows = await tx.select().from(warehouses).orderBy(asc(warehouses.code));
    const active = rows.find((r) => r.isActive);
    if (active) return active;
    if (rows.length > 0) return rows[0]!;
    const [row] = await tx
      .insert(warehouses)
      .values({ companyId, code: 'W01', name: '기본창고' })
      .onConflictDoNothing()
      .returning();
    return row ?? (await tx.select().from(warehouses).where(eq(warehouses.code, 'W01')))[0]!;
  }

  async create(input: WarehouseInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        const code = input.code || (await this.nextCode(tx));
        const [row] = await tx
          .insert(warehouses)
          .values({ ...input, companyId, code })
          .returning();
        await this.audit.record(
          {
            action: 'warehouse.create',
            entity: 'warehouse',
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

  async update(id: string, input: WarehouseUpdateInput) {
    try {
      return await this.db.tenant(async (tx) => {
        const [before] = await tx.select().from(warehouses).where(eq(warehouses.id, id));
        if (!before) throw new NotFoundException();
        const { code, ...rest } = input;
        const [after] = await tx
          .update(warehouses)
          .set({ ...rest, ...(code ? { code } : {}) })
          .where(eq(warehouses.id, id))
          .returning();
        await this.audit.record(
          {
            action: 'warehouse.update',
            entity: 'warehouse',
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
        const [row] = await tx.select().from(warehouses).where(eq(warehouses.id, id));
        if (!row) throw new NotFoundException();
        await tx.delete(warehouses).where(eq(warehouses.id, id));
        await this.audit.record(
          {
            action: 'warehouse.delete',
            entity: 'warehouse',
            entityId: id,
            before: this.toDto(row),
          },
          tx,
        );
      });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new AppException(
          'WAREHOUSE_IN_USE',
          '재고 거래가 있는 창고는 삭제할 수 없습니다. 사용중지해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /** W + 두 자리 순번(W01, W02 …) */
  private async nextCode(tx: Transaction): Promise<string> {
    const [row] = await tx
      .select({ max: sql<string | null>`max(substring(${warehouses.code} from 2)::int)` })
      .from(warehouses)
      .where(sql`${warehouses.code} ~ '^W[0-9]{1,6}$'`);
    return `W${String(Number(row?.max ?? 0) + 1).padStart(2, '0')}`;
  }

  private toDto(row: Row) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      memo: row.memo,
      isActive: row.isActive,
    };
  }

  private mapError(e: unknown) {
    if (isUniqueViolation(e)) {
      return new AppException(
        'DUPLICATE_WAREHOUSE',
        '같은 코드의 창고가 이미 있습니다.',
        HttpStatus.CONFLICT,
      );
    }
    return e;
  }
}
