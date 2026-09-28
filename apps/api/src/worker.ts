/**
 * 백그라운드 작업 워커: pnpm --filter @wellbuddy/api worker
 * API 와 같은 모듈(설정·DB·메일 등)을 HTTP 서버 없이 띄우고 BullMQ 큐를 처리한다.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { JobsService, QUEUES } from './jobs/jobs.service.js';

const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
  logger: ['log', 'warn', 'error'],
});
app.enableShutdownHooks();
app.get(JobsService).startWorkers(QUEUES);
Logger.log('워커 실행 중 (종료: Ctrl+C)', 'Worker');
