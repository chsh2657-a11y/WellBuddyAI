import { Module } from '@nestjs/common';
import { createProviderRegistry, ProviderRegistry } from '@wellbuddy/integrations';
import { ConnectionTester } from './connection-tester.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';

@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    ConnectionTester,
    // 공급자 레지스트리(모의·실연동·AI): 증빙 수집과 자동분개가 함께 쓴다
    { provide: ProviderRegistry, useFactory: createProviderRegistry },
  ],
  exports: [IntegrationsService, ProviderRegistry],
})
export class IntegrationsModule {}
