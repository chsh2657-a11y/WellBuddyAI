import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, companyMembers, invitations, users } from '@wellbuddy/db';
import { ROLE_LABELS, type Role } from '@wellbuddy/shared';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { TokenService } from '../auth/token.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DbService } from '../db/db.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { MailMessage } from '../mail/mail.service.js';
import { renderMail } from '../mail/templates.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface InvitationRow {
  id: string;
  company_id: string;
  company_name: string;
  email: string;
  role: Role;
  expires_at: Date | string;
  accepted_at: Date | string | null;
  revoked_at: Date | string | null;
}

type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

function statusOf(row: InvitationRow): InvitationStatus {
  if (row.revoked_at) return 'revoked';
  if (row.accepted_at) return 'accepted';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'pending';
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokenService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listPending() {
    const rows = await this.db.tenant((tx) =>
      tx
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(
          and(
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(invitations.createdAt)),
    );
    return rows.map((r) => ({
      ...r,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** 초대 메일을 보낸다. 같은 이메일로 대기 중인 초대는 취소하고 새로 만든다. */
  async create(email: string, role: Exclude<Role, 'owner'>) {
    const ctx = requireCompanyContext();
    const token = randomBytes(24).toString('base64url');

    const { invitation, companyName } = await this.db.tenant(async (tx) => {
      const [member] = await tx
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId))
        .where(and(eq(companyMembers.status, 'active'), sql`lower(${users.email}) = ${email}`));
      if (member) {
        throw new AppException('ALREADY_MEMBER', '이미 회사 구성원입니다.', HttpStatus.CONFLICT);
      }
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.email, email),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        );
      const [created] = await tx
        .insert(invitations)
        .values({
          companyId: ctx.companyId,
          email,
          role,
          tokenHash: this.tokens.hash(token),
          invitedBy: ctx.userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        });
      const [company] = await tx
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, ctx.companyId));
      await this.audit.record(
        {
          action: 'invitation.create',
          entity: 'invitation',
          entityId: created!.id,
          after: { email, role },
        },
        tx,
      );
      return { invitation: created!, companyName: company?.name ?? '' };
    });

    const link = `${this.config.webOrigin}/invite/${token}`;
    const body = renderMail({
      title: `${companyName}에서 초대했습니다`,
      paragraphs: [
        `${companyName}에서 WellBuddy ERP에 ${ROLE_LABELS[role]}(으)로 초대했습니다.`,
        '아래 버튼을 눌러 가입하거나 로그인한 뒤 초대를 수락해 주세요.',
      ],
      action: { label: '초대 수락하기', url: link },
      footnote: '이 링크는 7일 동안 유효합니다. 요청하지 않은 초대라면 이 메일을 무시해 주세요.',
    });
    await this.jobs.enqueue('mail', 'send', {
      to: email,
      subject: `[WellBuddy] ${companyName}에서 초대했습니다`,
      ...body,
    } satisfies MailMessage);

    return {
      ...invitation,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  async revoke(id: string) {
    await this.db.tenant(async (tx) => {
      const updated = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id, email: invitations.email });
      if (updated.length === 0) throw new NotFoundException();
      await this.audit.record(
        { action: 'invitation.revoke', entity: 'invitation', entityId: id, before: updated[0] },
        tx,
      );
    });
  }

  /** 토큰으로 초대를 조회한다(로그인 전 화면에서 사용). */
  async lookup(token: string) {
    const row = await this.findByToken(token);
    return {
      companyName: row.company_name,
      email: row.email,
      role: row.role,
      status: statusOf(row),
    };
  }

  /** 초대를 수락해 회사 구성원이 된다. 초대받은 이메일로 로그인한 경우에만 가능하다. */
  async accept(userId: string, token: string): Promise<string> {
    const row = await this.findByToken(token);
    const status = statusOf(row);
    if (status !== 'pending') {
      const message = {
        accepted: '이미 수락한 초대입니다.',
        expired: '초대 기간이 지났습니다. 관리자에게 다시 요청해 주세요.',
        revoked: '취소된 초대입니다.',
      }[status];
      throw new AppException('INVITATION_NOT_PENDING', message, HttpStatus.GONE);
    }

    const [user] = await this.db.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.email.toLowerCase() !== row.email.toLowerCase()) {
      throw new AppException(
        'INVITATION_EMAIL_MISMATCH',
        `초대받은 이메일(${row.email})로 로그인해야 수락할 수 있습니다.`,
        HttpStatus.FORBIDDEN,
      );
    }

    await this.db.as({ userId, companyId: row.company_id }, async (tx) => {
      await tx
        .insert(companyMembers)
        .values({ companyId: row.company_id, userId, role: row.role })
        .onConflictDoUpdate({
          target: [companyMembers.companyId, companyMembers.userId],
          set: { role: row.role, status: 'active' },
        });
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, row.id));
      await this.audit.record(
        {
          action: 'invitation.accept',
          entity: 'invitation',
          entityId: row.id,
          companyId: row.company_id,
          after: { email: row.email, role: row.role },
        },
        tx,
      );
    });
    await this.db.db
      .update(users)
      .set({ lastCompanyId: row.company_id })
      .where(eq(users.id, userId));
    return row.company_id;
  }

  private async findByToken(token: string): Promise<InvitationRow> {
    const { rows } = await this.db.db.execute<Record<string, unknown>>(
      sql`select * from find_invitation_by_token_hash(${this.tokens.hash(token)})`,
    );
    const row = rows[0] as InvitationRow | undefined;
    if (!row) {
      throw new AppException(
        'INVITATION_NOT_FOUND',
        '초대를 찾을 수 없습니다.',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }
}
