import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';

/**
 * 로그인 계정. 한 사용자가 여러 회사에 소속될 수 있으므로 테넌트 테이블이 아니다.
 * (로그인 전에는 회사를 알 수 없어 RLS 대신 리포지토리 계층에서만 접근한다.)
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    name: text().notNull(),
    /** 마지막으로 선택한 회사(로그인·토큰 갱신 시 이 회사로 들어간다). 소속이 끊기면 무시한다. */
    lastCompanyId: uuid(),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

/**
 * 리프레시 토큰(원문은 저장하지 않고 SHA-256 해시만 저장).
 * 같은 family 안에서 이미 교체된 토큰이 다시 쓰이면 탈취로 보고 family 전체를 폐기한다.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    replacedById: uuid(),
    userAgent: text(),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);
