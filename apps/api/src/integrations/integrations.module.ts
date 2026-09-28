import { Module } from '@nestjs/common';
import { ConnectionTester } from './connection-tester.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ConnectionTester],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
