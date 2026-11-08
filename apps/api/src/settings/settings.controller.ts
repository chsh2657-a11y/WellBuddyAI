import { Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { companySettings } from '@wellbuddy/db';
import {
  isModuleEnabled,
  MODULE_KEYS,
  MODULES,
  type UpdateModulesInput,
  UpdateModulesSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { RequirePermission } from '../auth/decorators.js';
import { requireCompanyContext } from '../common/request-context.js';
import { ZodBody, ZodResponse } from '../common/zod.js';
import { DbService } from '../db/db.service.js';

const ModuleSettingSchema = z.object({
  key: z.string(),
  label: z.string(),
  phase: z.string(),
  available: z.boolean(),
  required: z.boolean(),
  enabled: z.boolean(),
});

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('settings.menus', 'read')
  @Get('modules')
  @ZodResponse(z.array(ModuleSettingSchema), { description: '메뉴(업무 모듈) 사용 여부' })
  async modules() {
    const enabled = await this.loadEnabledModules();
    return MODULES.map((m) => ({ ...m, enabled: isModuleEnabled(m.key, enabled) }));
  }

  @RequirePermission('settings.menus', 'write')
  @Put('modules')
  @ZodResponse(z.array(ModuleSettingSchema))
  async updateModules(@ZodBody(UpdateModulesSchema) body: UpdateModulesInput) {
    const { companyId } = requireCompanyContext();
    const before = await this.loadEnabledModules();
    // 알려진 모듈만 저장하고, 필수 모듈(대시보드·설정)은 항상 켜 둔다
    const next = Object.fromEntries(
      MODULE_KEYS.map((key) => [key, isModuleEnabled(key, { ...before, ...body.enabledModules })]),
    );
    await this.db.tenant(async (tx) => {
      await tx
        .insert(companySettings)
        .values({ companyId, enabledModules: next })
        .onConflictDoUpdate({ target: companySettings.companyId, set: { enabledModules: next } });
      await this.audit.record(
        { action: 'settings.modules.update', entity: 'company_settings', before, after: next },
        tx,
      );
    });
    return MODULES.map((m) => ({ ...m, enabled: next[m.key]! }));
  }

  private async loadEnabledModules() {
    const [row] = await this.db.tenant((tx) =>
      tx.select({ enabledModules: companySettings.enabledModules }).from(companySettings),
    );
    return row?.enabledModules ?? {};
  }
}
