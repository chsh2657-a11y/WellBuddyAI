import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, InvitationsService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
