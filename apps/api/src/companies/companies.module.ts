import { Module } from '@nestjs/common';
import { BusinessPlacesImport } from './business-places.import.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, InvitationsService, BusinessPlacesImport],
  exports: [CompaniesService],
})
export class CompaniesModule {}
