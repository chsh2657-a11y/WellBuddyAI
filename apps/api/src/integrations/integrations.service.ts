import { Injectable } from '@nestjs/common';
import { integrationSettings } from '@wellbuddy/db';
import {
  getChannel,
  getProvider,
  type IntegrationChannel,
  type IntegrationStatus,
  INTEGRATIONS,
  SCHEDULE_PRESETS,
  type SchedulePreset,
  type UpdateIntegrationInput,
} from '@wellbuddy/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { FieldCrypto, maskSecret } from '../common/crypto/field-crypto.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { ConnectionTester } from './connection-tester.js';

type Row = typeof integrationSettings.$inferSelect;

function scheduleOf(cron: string | null): SchedulePreset {
  const found = (
    Object.entries(SCHEDULE_PRESETS) as [SchedulePreset, { cron: string | null }][]
  ).find(([, v]) => v.cron === cron);
  return found?.[0] ?? 'manual';
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: FieldCrypto,
    private readonly tester: ConnectionTester,
    private readonly audit: AuditService,
  ) {}

  /** 자격증명은 회사·채널에 묶어 암호화한다(다른 회사·채널 행으로 옮겨도 복호화되지 않음). */
  private purpose(companyId: string, channel: string) {
    return `integration:${companyId}:${channel}`;
  }

  async list(): Promise<IntegrationStatus[]> {
    const rows = await this.db.tenant((tx) => tx.select().from(integrationSettings));
    const byChannel = new Map(rows.map((r) => [r.channel, r]));
    return INTEGRATIONS.map((c) => this.toStatus(c.key, byChannel.get(c.key)));
  }

  async get(channel: IntegrationChannel): Promise<IntegrationStatus> {
    return this.toStatus(channel, await this.findRow(channel));
  }

  async update(
    channel: IntegrationChannel,
    input: UpdateIntegrationInput,
  ): Promise<IntegrationStatus> {
    const { companyId } = requireCompanyContext();
    const provider = getProvider(channel, input.provider);
    if (!provider) {
      throw new AppException('UNKNOWN_PROVIDER', '이 채널에서 쓸 수 없는 공급자입니다.');
    }

    const existing = await this.findRow(channel);
    const previous =
      existing?.credentialsEnc && existing.provider === input.provider
        ? this.decrypt(companyId, channel, existing.credentialsEnc)
        : {};
    // 입력한 값만 덮어쓰고, 빈 문자열은 기존 값을 유지한다. 정의되지 않은 항목은 버린다.
    const credentials: Record<string, string> = {};
    for (const field of provider.credentials) {
      const value = input.credentials?.[field.key]?.trim();
      const next = value ? value : previous[field.key];
      if (next) credentials[field.key] = next;
    }
    if (input.enabled) {
      const missing = provider.credentials.filter((f) => f.required && !credentials[f.key]);
      if (missing.length > 0) {
        throw new AppException(
          'CREDENTIALS_REQUIRED',
          `연동을 켜려면 다음 항목이 필요합니다: ${missing.map((f) => f.label).join(', ')}`,
          undefined,
          { fields: missing.map((f) => f.key) },
        );
      }
    }

    const values = {
      companyId,
      channel,
      provider: input.provider,
      enabled: input.enabled,
      credentialsEnc:
        Object.keys(credentials).length > 0
          ? this.crypto.encryptJson(credentials, this.purpose(companyId, channel))
          : null,
      scheduleCron: provider.schedulable ? SCHEDULE_PRESETS[input.schedule ?? 'manual'].cron : null,
      ...(existing?.provider !== input.provider
        ? { lastStatus: null, lastMessage: null, lastRunAt: null }
        : {}),
    };

    const row = await this.db.tenant(async (tx) => {
      const [saved] = await tx
        .insert(integrationSettings)
        .values(values)
        .onConflictDoUpdate({
          target: [integrationSettings.companyId, integrationSettings.channel],
          set: values,
        })
        .returning();
      await this.audit.record(
        {
          action: 'integration.update',
          entity: 'integration',
          entityId: channel,
          before: existing
            ? {
                enabled: existing.enabled,
                provider: existing.provider,
                scheduleCron: existing.scheduleCron,
              }
            : null,
          after: {
            enabled: values.enabled,
            provider: values.provider,
            scheduleCron: values.scheduleCron,
            credentialKeys: Object.keys(credentials),
          },
        },
        tx,
      );
      return saved!;
    });
    return this.toStatus(channel, row);
  }

  /** 수집 공급자를 만들 설정(자격증명 복호화). 저장한 적이 없으면 기본 공급자·꺼짐 */
  async providerSetting(channel: IntegrationChannel) {
    const { companyId } = requireCompanyContext();
    const row = await this.findRow(channel);
    return {
      provider: row?.provider ?? getChannel(channel)!.defaultProvider,
      enabled: row?.enabled ?? false,
      credentials: row?.credentialsEnc ? this.decrypt(companyId, channel, row.credentialsEnc) : {},
    };
  }

  /** 저장된 설정으로 연결을 시험하고 결과를 마지막 상태로 기록한다. */
  async test(channel: IntegrationChannel) {
    const { companyId } = requireCompanyContext();
    const row = await this.findRow(channel);
    const provider = row?.provider ?? getChannel(channel)!.defaultProvider;
    const credentials = row?.credentialsEnc
      ? this.decrypt(companyId, channel, row.credentialsEnc)
      : {};
    const result = await this.tester.test(channel, provider, credentials);

    const status = result.ok ? ('success' as const) : ('error' as const);
    await this.db.tenant((tx) =>
      tx
        .insert(integrationSettings)
        .values({
          companyId,
          channel,
          provider,
          enabled: row?.enabled ?? false,
          lastStatus: status,
          lastMessage: result.message,
          lastRunAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [integrationSettings.companyId, integrationSettings.channel],
          set: { lastStatus: status, lastMessage: result.message, lastRunAt: new Date() },
        }),
    );
    return result;
  }

  private async findRow(channel: string): Promise<Row | undefined> {
    const [row] = await this.db.tenant((tx) =>
      tx.select().from(integrationSettings).where(eq(integrationSettings.channel, channel)),
    );
    return row;
  }

  private decrypt(companyId: string, channel: string, payload: string): Record<string, string> {
    try {
      return this.crypto.decryptJson<Record<string, string>>(
        payload,
        this.purpose(companyId, channel),
      );
    } catch {
      return {};
    }
  }

  private toStatus(channel: IntegrationChannel, row: Row | undefined): IntegrationStatus {
    const def = getChannel(channel)!;
    if (!row) {
      return {
        channel,
        enabled: false,
        provider: def.defaultProvider,
        credentials: {},
        schedule: 'manual',
        lastStatus: null,
        lastMessage: null,
        lastRunAt: null,
      };
    }
    const { companyId } = requireCompanyContext();
    const provider = getProvider(channel, row.provider);
    const plain = row.credentialsEnc ? this.decrypt(companyId, channel, row.credentialsEnc) : {};
    const credentials = Object.fromEntries(
      Object.entries(plain).map(([k, v]) => {
        const secret = provider?.credentials.find((f) => f.key === k)?.secret ?? true;
        return [k, secret ? maskSecret(v) : v];
      }),
    );
    return {
      channel,
      enabled: row.enabled,
      provider: row.provider,
      credentials,
      schedule: scheduleOf(row.scheduleCron),
      lastStatus: row.lastStatus,
      lastMessage: row.lastMessage,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
    };
  }
}
