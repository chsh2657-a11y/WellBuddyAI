import { Module } from '@nestjs/common';
import { EvidenceStore } from './evidence-store.service.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';
import { UploadService } from './upload.service.js';

/** 증빙 자동수집·자동분개 */
@Module({
  controllers: [SourcesController, EvidenceController],
  providers: [SourcesService, EvidenceStore, EvidenceService, UploadService],
  exports: [SourcesService, EvidenceStore, EvidenceService],
})
export class EvidenceModule {}
