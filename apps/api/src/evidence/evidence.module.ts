import { Module } from '@nestjs/common';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';

/** 증빙 자동수집·자동분개 */
@Module({
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class EvidenceModule {}
