import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { companyMembers, rolePermissions, users } from '@wellbuddy/db';
import {
  isRoleEditable,
  type PermissionLevel,
  resolvePermissions,
  ROLES,
  type Role,
} from '@wellbuddy/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

@Injectable()
export class AccessService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** 역할별 최종 권한(기본값 + 회사 재정의) */
  async listRoles() {
    const overrides = await this.db.tenant((tx) =>
      tx
        .select({ role: rolePermissions.role, permissions: rolePermissions.permissions })
        .from(rolePermissions),
    );
    const byRole = new Map(overrides.map((o) => [o.role, o.permissions]));
    return ROLES.map((role) => ({
      role,
      editable: isRoleEditable(role),
      overridden: isRoleEditable(role) && byRole.has(role),
      permissions: resolvePermissions(role, byRole.get(role)),
    }));
  }

  async updateRole(role: Role, permissions: Partial<Record<string, PermissionLevel>>) {
    if (!isRoleEditable(role)) {
      throw new AppException('ROLE_NOT_EDITABLE', '대표 관리자 권한은 바꿀 수 없습니다.');
    }
    const { companyId } = requireCompanyContext();
    const before = (await this.listRoles()).find((r) => r.role === role)!.permissions;
    const merged = { ...before, ...permissions };
    await this.db.tenant(async (tx) => {
      await tx
        .insert(rolePermissions)
        .values({ companyId, role, permissions: merged })
        .onConflictDoUpdate({
          target: [rolePermissions.companyId, rolePermissions.role],
          set: { permissions: merged },
        });
      await this.audit.record(
        {
          action: 'role.permissions.update',
          entity: 'role',
          entityId: role,
          before,
          after: merged,
        },
        tx,
      );
    });
    return (await this.listRoles()).find((r) => r.role === role)!;
  }

  async listMembers() {
    const { userId } = requireCompanyContext();
    const rows = await this.db.tenant((tx) =>
      tx
        .select({
          id: companyMembers.id,
          userId: companyMembers.userId,
          name: users.name,
          email: users.email,
          role: companyMembers.role,
          status: companyMembers.status,
          createdAt: companyMembers.createdAt,
        })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId))
        .orderBy(asc(companyMembers.createdAt)),
    );
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      isMe: r.userId === userId,
    }));
  }

  /**
   * 구성원 역할·상태 변경.
   * - 자기 자신은 바꿀 수 없다(관리자가 스스로 권한을 잃는 사고 방지)
   * - 대표 관리자 지정·해제와 대표 관리자 계정 변경은 대표 관리자만 할 수 있다
   */
  async updateMember(id: string, change: { role?: Role; status?: 'active' | 'disabled' }) {
    const ctx = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const [member] = await tx.select().from(companyMembers).where(eq(companyMembers.id, id));
      if (!member) throw new NotFoundException();
      if (member.userId === ctx.userId) {
        throw new AppException('CANNOT_CHANGE_SELF', '자신의 역할이나 상태는 바꿀 수 없습니다.');
      }
      const touchesOwner = member.role === 'owner' || change.role === 'owner';
      if (touchesOwner && ctx.role !== 'owner') {
        throw new AppException(
          'OWNER_ONLY',
          '대표 관리자 지정·변경은 대표 관리자만 할 수 있습니다.',
          HttpStatus.FORBIDDEN,
        );
      }
      const [updated] = await tx
        .update(companyMembers)
        .set(change)
        .where(and(eq(companyMembers.id, id)))
        .returning();
      await this.audit.record(
        {
          action: 'member.update',
          entity: 'company_member',
          entityId: id,
          before: { role: member.role, status: member.status },
          after: { role: updated!.role, status: updated!.status },
        },
        tx,
      );
      return updated!;
    });
  }
}
