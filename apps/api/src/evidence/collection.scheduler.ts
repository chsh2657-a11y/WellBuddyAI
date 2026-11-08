import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { addDays, todayInKorea } from '@wellbuddy/accounting-core';
import { ProviderRegistry } from '@wellbuddy/integrations';
import {
  COLLECT_CHANNELS,
  type CollectChannel,
  isScheduleDue,
  schedulePresetOf,
} from '@wellbuddy/shared';
import { sql } from 'drizzle-orm';
import { AppException } from '../common/errors.js';
import { runWithContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { CollectionService } from './collection.service.js';

/** 예약을 확인하는 주기 */
export const COLLECT_TICK_MS = 5 * 60_000;
/** 예약 수집 기간(최근 7일). 겹치는 날은 중복 제거 해시로 건너뛴다 */
export const SCHEDULED_COLLECT_DAYS = 7;

interface ScheduledRow extends Record<string, unknown> {
  company_id: string;
  channel: string;
  provider: string;
  schedule_cron: string;
  last_run_at: Date | string | null;
}

/**
 * 예약 수집(P2-16).
 * - tick(5분마다, 워커가 반복 등록): 켜져 있고 주기가 정해진 채널 중 돌 때가 된 것을 찾아
 *   회사 컨텍스트로 run 작업을 넣는다. 같은 회사·채널·시간대는 작업 ID 로 한 번만 넣는다.
 * - run: 사용자 없이 최근 7일을 수집한다. 실패하면 수집 이력·연동 상태에 남고, 큐가 3번까지
 *   지수 간격으로 다시 시도한다(JobsService 기본값).
 */
@Injectable()
export class CollectionScheduler implements OnModuleInit {
  private readonly logger = new Logger('CollectionScheduler');

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobsService,
    private readonly collection: CollectionService,
    private readonly integrations: IntegrationsService,
    private readonly registry: ProviderRegistry,
  ) {}

  onModuleInit() {
    this.jobs.register<{ now?: string }>('collect', 'tick', (data) =>
      this.tick(data?.now ? new Date(data.now) : new Date()),
    );
    this.jobs.register<{ channel: CollectChannel }>('collect', 'run', (data) =>
      this.run(data.channel),
    );
  }

  /** 워커 시작 때 한 번: 예약 확인을 반복 작업으로 등록 */
  scheduleTicks() {
    return this.jobs.repeat('collect', 'tick', {}, COLLECT_TICK_MS);
  }

  async tick(now: Date) {
    const { rows } = await this.db.db.execute<ScheduledRow>(
      sql`select * from scheduled_collections()`,
    );
    let due = 0;
    let started = 0;
    const failures: string[] = [];
    for (const row of rows) {
      const channel = row.channel as CollectChannel;
      if (!(COLLECT_CHANNELS as readonly string[]).includes(channel)) continue;
      // 파일 업로드처럼 자동 수집이 없는 공급자는 건너뛴다
      if (!this.registry.has(channel, row.provider)) continue;
      const lastRunAt = row.last_run_at ? new Date(row.last_run_at) : null;
      if (!isScheduleDue(schedulePresetOf(row.schedule_cron), lastRunAt, now)) continue;
      due += 1;
      // 같은 시간대에 같은 작업을 두 번 넣지 않는다(재시도 중인 작업 포함)
      const slot = Math.floor(now.getTime() / COLLECT_TICK_MS);
      try {
        await runWithContext({ companyId: row.company_id }, () =>
          this.jobs.enqueue(
            'collect',
            'run',
            { channel },
            { jobId: `collect-${row.company_id}-${channel}-${slot}` },
          ),
        );
        started += 1;
      } catch (e) {
        // 인라인 실행(테스트)에서는 수집 오류가 여기로 온다. 다른 회사 수집은 계속한다
        const reason = e instanceof Error ? e.message : String(e);
        failures.push(`${row.company_id}:${channel}`);
        this.logger.warn(`예약 수집 실패 ${row.company_id}/${channel}: ${reason}`);
      }
    }
    return { checked: rows.length, due, started, failures };
  }

  /**
   * 설정 문제(계좌 없음·자격증명 오류 등)는 다시 해도 같으므로 연동 상태에 남기고 재시도하지 않는다.
   * 수집 중 오류(COLLECTION_FAILED)는 수집 이력에 남긴 뒤 다시 던져 큐가 재시도하게 한다.
   */
  async run(channel: CollectChannel) {
    const from = addDays(todayInKorea(), -(SCHEDULED_COLLECT_DAYS - 1));
    try {
      return await this.collection.collect(channel, { from }, 'schedule');
    } catch (e) {
      if (e instanceof AppException && e.code !== 'COLLECTION_FAILED') {
        await this.integrations.recordStatus(
          channel,
          'error',
          `예약 수집을 하지 못했습니다: ${e.message}`,
        );
        return null;
      }
      throw e;
    }
  }
}
