import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { SystemJobs } from './system.jobs.js';

@Global()
@Module({ providers: [JobsService, SystemJobs], exports: [JobsService] })
export class JobsModule {}
