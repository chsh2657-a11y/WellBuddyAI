import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { appRole, tenantIsolationPolicy } from './_rls.js';
import { users } from './auth.js';
import { companies } from './companies.js';

/**
 * 외부 연동 설정(채널별 ON/OFF 스위치 + 공급자 선택).
 * 자격증명은 필드 암호화한 문자열(credentials_enc)로만 저장한다.
 */
export const integrationSettings = pgTable(
  'integration_settings',
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    channel: text().notNull(),
    provider: text().notNull(),
    enabled: boolean().notNull().default(false),
    credentialsEnc: text(),
    options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    scheduleCron: text(),
    lastStatus: text().$type<'success' | 'error'>(),
    lastMessage: text(),
    lastRunAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('integration_settings_company_channel_uq').on(t.companyId, t.channel),
    tenantIsolationPolicy(),
  ],
);

/**
 * 감사로그. 앱 롤은 INSERT·SELECT 만 가능하다(UPDATE/DELETE 권한은 마이그레이션에서 회수).
 * 로그인처럼 회사가 정해지기 전의 이벤트는 company_id 가 비어 있다.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    companyId: uuid().references(() => companies.id, { onDelete: 'set null' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entity: text(),
    entityId: text(),
    method: text(),
    path: text(),
    statusCode: integer(),
    ip: text(),
    userAgent: text(),
    before: jsonb(),
    after: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_company_created_idx').on(t.companyId, t.createdAt),
    pgPolicy('audit_logs_select', {
      for: 'select',
      to: appRole,
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('audit_logs_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`company_id is null or company_id = current_company_id()`,
    }),
  ],
);

/** 업로드 파일 메타데이터. 실제 파일은 StorageDriver(local/S3)에 저장한다. */
export const fileObjects = pgTable(
  'file_objects',
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    storageKey: text().notNull().unique(),
    filename: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    sha256: text().notNull(),
    uploadedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('file_objects_company_idx').on(t.companyId), tenantIsolationPolicy()],
);
