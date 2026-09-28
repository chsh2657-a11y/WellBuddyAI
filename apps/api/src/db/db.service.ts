import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createDb,
  type Database,
  type TenantContext,
  type Transaction,
  withTenant,
} from '@wellbuddy/db';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { currentContext } from '../common/request-context.js';

@Injectable()
export class DbService implements OnModuleDestroy {
  /** RLS 가 적용되는 앱 롤 연결. 테넌트 데이터는 반드시 tenant()/as() 안에서 다룬다. */
  readonly db: Database;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.db = createDb(config.databaseUrl);
  }

  /** 현재 요청의 사용자·회사 컨텍스트로 RLS 트랜잭션을 연다. */
  tenant<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const ctx = currentContext();
    return withTenant(this.db, { userId: ctx?.userId, companyId: ctx?.companyId }, fn);
  }

  /** 지정한 컨텍스트로 RLS 트랜잭션을 연다(로그인 직후, 회사 생성 등). */
  as<T>(ctx: TenantContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(this.db, ctx, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.$client.end();
  }
}
