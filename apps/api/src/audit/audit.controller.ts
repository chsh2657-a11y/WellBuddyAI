import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { ZodQuery, ZodResponse } from '../common/zod.js';
import { AuditService } from './audit.service.js';

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime().optional(),
});

const AuditLogSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  action: z.string(),
  entity: z.string().nullable(),
  entityId: z.string().nullable(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  statusCode: z.number().nullable(),
  ip: z.string().nullable(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
});

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermission('settings.audit', 'read')
  @Get()
  @ZodResponse(z.array(AuditLogSchema), {
    description: '최신순. 다음 페이지는 before=마지막 createdAt',
  })
  list(@ZodQuery(AuditQuerySchema) query: z.infer<typeof AuditQuerySchema>) {
    return this.audit.list(query.limit, query.before);
  }
}
