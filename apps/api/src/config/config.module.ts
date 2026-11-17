import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, loadConfig } from './env.js';

@Global()
@Module({})
export class ConfigModule {
  /** 테스트에서는 config 를 직접 넘겨 환경변수 없이도 앱을 띄울 수 있다. */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => config ?? loadConfig() }],
      exports: [APP_CONFIG],
    };
  }
}
