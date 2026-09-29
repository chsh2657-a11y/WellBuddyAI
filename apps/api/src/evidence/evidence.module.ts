import { Module } from '@nestjs/common';
import { createProviderRegistry, ProviderRegistry } from '@wellbuddy/integrations';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CollectionService } from './collection.service.js';
import { EvidenceStore } from './evidence-store.service.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';
import { UploadService } from './upload.service.js';

/** 증빙 자동수집·자동분개 */
@Module({
  imports: [IntegrationsModule],
  controllers: [SourcesController, EvidenceController],
  providers: [
    SourcesService,
    EvidenceStore,
    EvidenceService,
    UploadService,
    CollectionService,
    { provide: ProviderRegistry, useFactory: createProviderRegistry },
  ],
  exports: [SourcesService, EvidenceStore, EvidenceService],
})
export class EvidenceModule {}
