import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { FilesModule } from '../files/files.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CenterService } from './center.service.js';
import { CollectionService } from './collection.service.js';
import { EvidenceStore } from './evidence-store.service.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';
import { ReconcileService } from './reconcile.service.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';
import { UploadService } from './upload.service.js';

/** 증빙 자동수집·자동분개 */
@Module({
  imports: [IntegrationsModule, AccountingModule, FilesModule],
  controllers: [SourcesController, ReceiptsController, EvidenceController],
  providers: [
    SourcesService,
    EvidenceStore,
    EvidenceService,
    UploadService,
    CollectionService,
    CenterService,
    ReconcileService,
    ReceiptsService,
  ],
  exports: [SourcesService, EvidenceStore, EvidenceService],
})
export class EvidenceModule {}
