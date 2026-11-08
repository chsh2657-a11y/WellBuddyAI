import { Injectable } from '@nestjs/common';
import { companyMembers, rolePermissions } from '@wellbuddy/db';
import { type PermissionMap, resolvePermissions, type Role } from '@wellbuddy/shared';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';

export interface Membership {
  role: Role;
  permissions: PermissionMap;
}

@Injectable()
export class MembershipService {
  constructor(private readonly db: DbService) {}

  /** 활성 구성원이면 역할과 최종 권한을, 아니면 null 을 돌려준다(요청마다 호출되어 즉시 반영). */
  async resolve(userId: string, companyId: string): Promise<Membership | null> {
    const rows = await this.db.as({ userId, companyId }, (tx) =>
      tx
        .select({ role: companyMembers.role, overrides: rolePermissions.permissions })
        .from(companyMembers)
        .leftJoin(
          rolePermissions,
          and(
            eq(rolePermissions.companyId, companyMembers.companyId),
            eq(rolePermissions.role, companyMembers.role),
          ),
        )
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, 'active'),
          ),
        )
        .limit(1),
    );
    const row = rows[0];
    if (!row) return null;
    return { role: row.role, permissions: resolvePermissions(row.role, row.overrides) };
  }
}
