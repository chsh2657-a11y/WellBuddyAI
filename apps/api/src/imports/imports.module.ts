import { Global, Module } from '@nestjs/common';
import { ImportRegistry } from './import-registry.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

@Global()
@Module({
  controllers: [ImportsController],
  providers: [ImportRegistry, ImportsService],
  exports: [ImportRegistry],
})
export class ImportsModule {}
