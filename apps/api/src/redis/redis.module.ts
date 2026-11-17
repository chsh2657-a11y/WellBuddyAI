import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** 앱 공용 Redis 연결. 실제 사용 시점에 연결한다(lazyConnect). */
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'wait' && this.client.status !== 'end') {
      await this.client.quit().catch(() => this.client.disconnect());
    }
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
