import { Injectable, UnauthorizedException } from '@nestjs/common';
import { companies, companyMembers, companySettings, users } from '@wellbuddy/db';
import type { Session } from '@wellbuddy/shared';
import { and, asc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { MembershipService } from './membership.service.js';

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    private readonly memberships: MembershipService,
  ) {}

  /** 로그인·토큰 갱신 시 들어갈 회사: 마지막 선택 회사(여전히 활성 구성원이면) → 첫 번째 소속 회사 */
  async pickCompany(userId: string, preferred: string | null): Promise<string | null> {
    if (preferred && (await this.memberships.resolve(userId, preferred))) return preferred;
    const list = await this.listCompanies(userId);
    return list[0]?.id ?? null;
  }

  listCompanies(userId: string) {
    return this.db.as({ userId }, (tx) =>
      tx
        .select({ id: companies.id, name: companies.name, role: companyMembers.role })
        .from(companyMembers)
        .innerJoin(companies, eq(companies.id, companyMembers.companyId))
        .where(and(eq(companyMembers.userId, userId), eq(companyMembers.status, 'active')))
        .orderBy(asc(companyMembers.createdAt)),
    );
  }

  async getSession(userId: string, companyId: string | null): Promise<Session> {
    const [user] = await this.db.db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new UnauthorizedException();

    const companyList = await this.listCompanies(userId);
    const membership = companyId ? await this.memberships.resolve(userId, companyId) : null;
    if (!companyId || !membership) {
      return {
        user,
        company: null,
        role: null,
        companies: companyList,
        permissions: {},
        enabledModules: {},
      };
    }

    const [company, settings] = await this.db.as({ userId, companyId }, async (tx) => [
      (
        await tx
          .select({
            id: companies.id,
            name: companies.name,
            bizRegNo: companies.bizRegNo,
            journalApprovalRequired: companies.journalApprovalRequired,
          })
          .from(companies)
          .where(eq(companies.id, companyId))
      )[0],
      (
        await tx
          .select({ enabledModules: companySettings.enabledModules })
          .from(companySettings)
          .where(eq(companySettings.companyId, companyId))
      )[0],
    ]);

    return {
      user,
      company: company ?? null,
      role: membership.role,
      companies: companyList,
      permissions: membership.permissions,
      enabledModules: settings?.enabledModules ?? {},
    };
  }
}
