import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type JobsOptions, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { currentContext, runWithContext } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

/** 큐 이름. P2 에서 수집(collect)·분류(classify) 큐가 추가된다. */
export const QUEUES = ['mail', 'system'] as const;
export type QueueName = (typeof QUEUES)[number];

type Handler = (data: unknown) => Promise<unknown>;

/** 작업을 넣은 요청의 사용자·회사 — 워커에서 같은 RLS 컨텍스트로 실행하기 위해 함께 저장한다. */
interface JobEnvelope {
  ctx: { userId: string | null; companyId: string | null };
  data: unknown;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

/**
 * BullMQ 작업 큐.
 * - API 는 enqueue() 로 작업을 넣고, 워커 프로세스(dist/worker.js)가 startWorkers() 로 처리한다.
 * - QUEUE_INLINE=true(테스트)이면 Redis 를 거치지 않고 즉시 실행한다.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, Handler>();
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  register<T>(queue: QueueName, name: string, handler: (data: T) => Promise<unknown>): void {
    this.handlers.set(`${queue}:${name}`, handler as Handler);
  }

  async enqueue(queue: QueueName, name: string, data: unknown, options: JobsOptions = {}) {
    const ctx = currentContext();
    const envelope: JobEnvelope = {
      ctx: { userId: ctx?.userId ?? null, companyId: ctx?.companyId ?? null },
      data,
    };
    if (this.config.queue.inline) {
      await this.run(queue, name, envelope);
      return;
    }
    await this.queue(queue).add(name, envelope, { ...DEFAULT_JOB_OPTIONS, ...options });
  }

  /** 워커 프로세스에서 호출: 지정한 큐의 작업을 처리한다. */
  startWorkers(queues: readonly QueueName[] = QUEUES, concurrency = 5): void {
    for (const name of queues) {
      const worker = new Worker(name, (job) => this.run(name, job.name, job.data as JobEnvelope), {
        connection: this.connection(),
        concurrency,
      });
      worker.on('failed', (job, err) =>
        this.logger.warn(`${name}:${job?.name} 실패(${job?.attemptsMade}회): ${err.message}`),
      );
      this.workers.push(worker);
    }
    this.logger.log(`워커 시작: ${queues.join(', ')}`);
  }

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private async run(queue: string, name: string, envelope: JobEnvelope): Promise<unknown> {
    const handler = this.handlers.get(`${queue}:${name}`);
    if (!handler) throw new Error(`등록되지 않은 작업: ${queue}:${name}`);
    return runWithContext(envelope.ctx, () => handler(envelope.data));
  }

  private connection(): Redis {
    // BullMQ 워커는 블로킹 명령을 쓰므로 maxRetriesPerRequest 를 null 로 둔다
    const conn = new Redis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.connections.push(conn);
    return conn;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }
}
