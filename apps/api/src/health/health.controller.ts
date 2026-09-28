import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { ZodResponse } from '../common/zod.js';
import { DbService } from '../db/db.service.js';
import { RedisService } from '../redis/redis.module.js';

const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'error']),
  redis: z.enum(['ok', 'error']),
});

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @ZodResponse(HealthSchema, { description: 'DB·Redis 연결 상태' })
  async check(@Res({ passthrough: true }) res: Response): Promise<z.infer<typeof HealthSchema>> {
    const [dbOk, redisOk] = await Promise.all([
      this.db.db.execute(sql`select 1`).then(
        () => true,
        () => false,
      ),
      this.redis.ping(),
    ]);
    const ok = dbOk && redisOk;
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
    };
  }
}
