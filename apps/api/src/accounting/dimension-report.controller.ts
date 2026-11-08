import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { ZodQuery, ZodResponse } from '../common/zod.js';
import { DimensionReportService } from './dimension-report.service.js';
import { RangeQuerySchema } from './report.schemas.js';

const int = z.number().int();

const QuerySchema = RangeQuerySchema.extend({ dimension: z.enum(['department', 'project']) });

const DimensionPlSchema = z.object({
  from: z.string(),
  to: z.string(),
  dimension: z.enum(['department', 'project']),
  /** 부서·프로젝트(코드순), 붙이지 않은 전표 줄은 id null 인 "미지정" */
  columns: z.array(
    z.object({ id: z.uuid().nullable(), code: z.string().nullable(), name: z.string() }),
  ),
  lines: z.array(
    z.object({
      accountId: z.uuid(),
      code: z.string(),
      name: z.string(),
      category: z.enum(['revenue', 'expense']),
      amounts: z.array(int),
      total: int,
    }),
  ),
  revenue: z.array(int),
  expense: z.array(int),
  profit: z.array(int),
  totals: z.object({ revenue: int, expense: int, profit: int }),
});

/** 부서·프로젝트별 손익 */
@ApiTags('reports')
@Controller('reports')
export class DimensionReportController {
  constructor(private readonly reports: DimensionReportService) {}

  @RequirePermission('accounting', 'read')
  @Get('dimension-pl')
  @ZodResponse(DimensionPlSchema, { description: '부서·프로젝트별 손익(열 합계 = 손익계산서)' })
  report(@ZodQuery(QuerySchema) q: z.infer<typeof QuerySchema>) {
    return this.reports.report(q.from, q.to, q.dimension);
  }
}
