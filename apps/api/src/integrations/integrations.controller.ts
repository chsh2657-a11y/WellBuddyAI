import { Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ConnectAccountInput,
  ConnectAccountResultSchema,
  ConnectAccountSchema,
  ConnectionTestResultSchema,
  INTEGRATION_CHANNELS,
  type IntegrationChannel,
  IntegrationStatusSchema,
  type UpdateIntegrationInput,
  UpdateIntegrationSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { ZodBody, ZodResponse, ZodValidationPipe } from '../common/zod.js';
import { IntegrationsService } from './integrations.service.js';

const ChannelParam = new ZodValidationPipe(z.enum(INTEGRATION_CHANNELS));

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @RequirePermission('settings.integrations', 'read')
  @Get()
  @ZodResponse(z.array(IntegrationStatusSchema), {
    description: '채널별 연동 상태(자격증명은 마스킹)',
  })
  list() {
    return this.integrations.list();
  }

  @RequirePermission('settings.integrations', 'write')
  @Put(':channel')
  @ZodResponse(IntegrationStatusSchema)
  update(
    @Param('channel', ChannelParam) channel: IntegrationChannel,
    @ZodBody(UpdateIntegrationSchema) body: UpdateIntegrationInput,
  ) {
    return this.integrations.update(channel, body);
  }

  @RequirePermission('settings.integrations', 'write')
  @Post(':channel/test')
  @HttpCode(200)
  @ZodResponse(ConnectionTestResultSchema, { description: '저장된 설정으로 연결 테스트' })
  test(@Param('channel', ChannelParam) channel: IntegrationChannel) {
    return this.integrations.test(channel);
  }

  @RequirePermission('settings.integrations', 'write')
  @Post(':channel/connect-account')
  @HttpCode(200)
  @ZodResponse(ConnectAccountResultSchema, {
    description: '실연동 기관 계정 연결(CODEF Connected ID 발급, 비밀번호는 저장하지 않음)',
  })
  connectAccount(
    @Param('channel', ChannelParam) channel: IntegrationChannel,
    @ZodBody(ConnectAccountSchema) body: ConnectAccountInput,
  ) {
    return this.integrations.connectAccount(channel, body);
  }
}
