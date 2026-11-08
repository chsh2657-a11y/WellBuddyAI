import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { departments, projects } from '@wellbuddy/db';
import type { DimensionInput, ProjectInput } from '@wellbuddy/shared';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

export type DimensionKind = 'department' | 'project';

const LABEL: Record<DimensionKind, string> = { department: '부서', project: '프로젝트' };

/** 전표 관리항목: 부서·프로젝트 */
@Injectable()
export class DimensionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private table(kind: DimensionKind) {
    return kind === 'department' ? departments : projects;
  }

  list(kind: DimensionKind, includeInactive = false) {
    const table = this.table(kind);
    return this.db.tenant((tx) =>
      tx
        .select()
        .from(table)
        .where(includeInactive ? undefined : eq(table.isActive, true))
        .orderBy(asc(table.code)),
    );
  }

  async create(kind: DimensionKind, input: DimensionInput | ProjectInput) {
    const { companyId } = requireCompanyContext();
    const table = this.table(kind);
    try {
      return await this.db.tenant(async (tx) => {
        const [row] = await tx
          .insert(table)
          .values({ ...input, companyId })
          .returning();
        await this.audit.record(
          { action: `${kind}.create`, entity: kind, entityId: row!.id, after: row },
          tx,
        );
        return row!;
      });
    } catch (e) {
      throw this.mapError(kind, e);
    }
  }

  async update(kind: DimensionKind, id: string, input: Partial<DimensionInput & ProjectInput>) {
    const table = this.table(kind);
    try {
      return await this.db.tenant(async (tx) => {
        const [before] = await tx.select().from(table).where(eq(table.id, id));
        if (!before) throw new NotFoundException();
        const [after] = await tx.update(table).set(input).where(eq(table.id, id)).returning();
        await this.audit.record(
          { action: `${kind}.update`, entity: kind, entityId: id, before, after },
          tx,
        );
        return after!;
      });
    } catch (e) {
      throw this.mapError(kind, e);
    }
  }

  async remove(kind: DimensionKind, id: string) {
    const table = this.table(kind);
    try {
      await this.db.tenant(async (tx) => {
        const [row] = await tx.select().from(table).where(eq(table.id, id));
        if (!row) throw new NotFoundException();
        await tx.delete(table).where(eq(table.id, id));
        await this.audit.record(
          { action: `${kind}.delete`, entity: kind, entityId: id, before: row },
          tx,
        );
      });
    } catch (e) {
      throw this.mapError(kind, e);
    }
  }

  private mapError(kind: DimensionKind, e: unknown) {
    if (isUniqueViolation(e)) {
      return new AppException(
        'DUPLICATE_CODE',
        `같은 코드의 ${LABEL[kind]}가 이미 있습니다.`,
        HttpStatus.CONFLICT,
      );
    }
    if (isForeignKeyViolation(e)) {
      return new AppException(
        'IN_USE',
        `전표에 사용된 ${LABEL[kind]}는 삭제할 수 없습니다. 사용중지해 주세요.`,
        HttpStatus.CONFLICT,
      );
    }
    return e;
  }
}
