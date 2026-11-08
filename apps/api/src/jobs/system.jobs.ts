import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MailService, type MailMessage } from '../mail/mail.service.js';
import { JobsService } from './jobs.service.js';

/** 기본 작업 핸들러: 메일 발송, 워커 상태 확인(ping) */
@Injectable()
export class SystemJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.jobs.register<MailMessage>('mail', 'send', (message) => this.mail.send(message));
    this.jobs.register<{ at: string }>('system', 'ping', async (data) => ({ pong: data.at }));
  }
}
