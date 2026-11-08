import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AssetDisposeInput,
  AssetDisposeSchema,
  DepreciationRunInputSchema,
  type FixedAssetInput,
  FixedAssetInputSchema,
  type FixedAssetUpdateInput,
  FixedAssetUpdateSchema,
  MonthSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodParam, ZodResponse } from '../common/zod.js';
import {
  AssetScheduleSchema,
  DepreciationRunResultSchema,
  DepreciationRunSchema,
  FixedAssetSchema,
} from './asset.schemas.js';
import { FixedAssetsService } from './fixed-assets.service.js';

/** 고정자산 대장, 월별 감가상각 실행·취소, 처분 */
@ApiTags('fixed-assets')
@Controller()
export class FixedAssetsController {
  constructor(private readonly assets: FixedAssetsService) {}

  @RequirePermission('accounting', 'read')
  @Get('fixed-assets')
  @ZodResponse(z.array(FixedAssetSchema), { description: '고정자산 대장(코드순)' })
  list() {
    return this.assets.list();
  }

  @RequirePermission('accounting', 'write')
  @Post('fixed-assets')
  @ZodResponse(FixedAssetSchema, { status: 201 })
  create(@ZodBody(FixedAssetInputSchema) body: FixedAssetInput) {
    return this.assets.create(body);
  }

  @RequirePermission('accounting', 'write')
  @Patch('fixed-assets/:id')
  @ZodResponse(FixedAssetSchema, {
    description: '상각 전표가 생긴 뒤에는 이름·부서·메모만 바꿀 수 있다',
  })
  update(
    @UuidParam('id') id: string,
    @ZodBody(FixedAssetUpdateSchema) body: FixedAssetUpdateInput,
  ) {
    return this.assets.update(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Delete('fixed-assets/:id')
  @HttpCode(204)
  remove(@UuidParam('id') id: string) {
    return this.assets.remove(id);
  }

  @RequirePermission('accounting', 'read')
  @Get('fixed-assets/:id/schedule')
  @ZodResponse(AssetScheduleSchema, { description: '내용연수 전체 월별 상각 일정과 반영액' })
  schedule(@UuidParam('id') id: string) {
    return this.assets.schedule(id);
  }

  @RequirePermission('accounting', 'write')
  @Post('fixed-assets/:id/dispose')
  @HttpCode(200)
  @ZodResponse(FixedAssetSchema, { description: '매각·폐기 처분 전표(처분손익 자동 계산)' })
  dispose(@UuidParam('id') id: string, @ZodBody(AssetDisposeSchema) body: AssetDisposeInput) {
    return this.assets.dispose(id, body);
  }

  @RequirePermission('accounting', 'read')
  @Get('depreciation-runs')
  @ZodResponse(z.array(DepreciationRunSchema), {
    description: '월 감가상각 실행 이력(최근 달부터)',
  })
  listRuns() {
    return this.assets.listRuns();
  }

  @RequirePermission('accounting', 'write')
  @Post('depreciation-runs')
  @ZodResponse(DepreciationRunResultSchema, {
    status: 201,
    description: '그 달의 감가상각 전표를 전기한다(달마다 한 번, 달 순서대로)',
  })
  run(@ZodBody(DepreciationRunInputSchema) body: z.infer<typeof DepreciationRunInputSchema>) {
    return this.assets.run(body.month);
  }

  @RequirePermission('accounting', 'write')
  @Delete('depreciation-runs/:month')
  @HttpCode(204)
  cancelRun(@ZodParam('month', MonthSchema) month: string) {
    return this.assets.cancelRun(month);
  }
}
