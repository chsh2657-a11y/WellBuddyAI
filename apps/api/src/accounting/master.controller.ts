import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AccountInput,
  AccountInputSchema,
  AccountMemoInputSchema,
  type AccountUpdateInput,
  AccountUpdateSchema,
  DimensionInputSchema,
  PARTNER_KINDS,
  type PartnerInput,
  PartnerInputSchema,
  type PartnerUpdateInput,
  PartnerUpdateSchema,
  type ProjectInput,
  ProjectInputSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { AccountsService } from './accounts.service.js';
import { DimensionsService } from './dimensions.service.js';
import {
  AccountMemoSchema,
  AccountSchema,
  DimensionSchema,
  ListQuerySchema,
  PartnerSchema,
  ProjectSchema,
} from './master.schemas.js';
import { PartnersService } from './partners.service.js';

const PartnerQuerySchema = ListQuerySchema.extend({ kind: z.enum(PARTNER_KINDS).optional() });

/** 회계 기초정보: 계정과목·적요·거래처·부서·프로젝트 */
@ApiTags('accounting-master')
@Controller()
export class MasterController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly partners: PartnersService,
    private readonly dimensions: DimensionsService,
  ) {}

  // ── 계정과목 ──────────────────────────────────────────

  @RequirePermission('accounting', 'read')
  @Get('accounts')
  @ZodResponse(z.array(AccountSchema), {
    description: '계정과목(코드순). 비어 있으면 표준 계정과목을 넣는다',
  })
  listAccounts(@ZodQuery(ListQuerySchema) query: z.infer<typeof ListQuerySchema>) {
    return this.accounts.list(query);
  }

  @RequirePermission('accounting', 'write')
  @Post('accounts')
  @ZodResponse(AccountSchema, { status: 201 })
  createAccount(@ZodBody(AccountInputSchema) body: AccountInput) {
    return this.accounts.create(body);
  }

  @RequirePermission('accounting', 'write')
  @Post('accounts/restore-standard')
  @HttpCode(200)
  @ZodResponse(z.object({ added: z.number() }), { description: '빠진 표준 계정과목 복원' })
  restoreStandard() {
    return this.accounts.restoreStandard();
  }

  @RequirePermission('accounting', 'write')
  @Patch('accounts/:id')
  @ZodResponse(AccountSchema)
  updateAccount(
    @UuidParam('id') id: string,
    @ZodBody(AccountUpdateSchema) body: AccountUpdateInput,
  ) {
    return this.accounts.update(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Delete('accounts/:id')
  @HttpCode(204)
  async removeAccount(@UuidParam('id') id: string): Promise<void> {
    await this.accounts.remove(id);
  }

  @RequirePermission('accounting', 'read')
  @Get('accounts/:id/memos')
  @ZodResponse(z.array(AccountMemoSchema))
  memos(@UuidParam('id') id: string) {
    return this.accounts.listMemos(id);
  }

  @RequirePermission('accounting', 'write')
  @Post('accounts/:id/memos')
  @ZodResponse(AccountMemoSchema, { status: 201 })
  addMemo(
    @UuidParam('id') id: string,
    @ZodBody(AccountMemoInputSchema) body: z.infer<typeof AccountMemoInputSchema>,
  ) {
    return this.accounts.addMemo(id, body.text);
  }

  @RequirePermission('accounting', 'write')
  @Delete('accounts/:id/memos/:memoId')
  @HttpCode(204)
  async removeMemo(
    @UuidParam('id') id: string,
    @UuidParam('memoId') memoId: string,
  ): Promise<void> {
    await this.accounts.removeMemo(id, memoId);
  }

  // ── 거래처 ────────────────────────────────────────────

  @RequirePermission('accounting', 'read')
  @Get('partners')
  @ZodResponse(z.array(PartnerSchema))
  listPartners(@ZodQuery(PartnerQuerySchema) query: z.infer<typeof PartnerQuerySchema>) {
    return this.partners.list(query);
  }

  @RequirePermission('accounting', 'read')
  @Get('partners/:id')
  @ZodResponse(PartnerSchema)
  getPartner(@UuidParam('id') id: string) {
    return this.partners.get(id);
  }

  @RequirePermission('accounting', 'write')
  @Post('partners')
  @ZodResponse(PartnerSchema, {
    status: 201,
    description: '코드를 비우면 00001 형식으로 자동 부여',
  })
  createPartner(@ZodBody(PartnerInputSchema) body: PartnerInput) {
    return this.partners.create(body);
  }

  @RequirePermission('accounting', 'write')
  @Patch('partners/:id')
  @ZodResponse(PartnerSchema)
  updatePartner(
    @UuidParam('id') id: string,
    @ZodBody(PartnerUpdateSchema) body: PartnerUpdateInput,
  ) {
    return this.partners.update(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Delete('partners/:id')
  @HttpCode(204)
  async removePartner(@UuidParam('id') id: string): Promise<void> {
    await this.partners.remove(id);
  }

  // ── 부서·프로젝트 ─────────────────────────────────────

  @RequirePermission('accounting', 'read')
  @Get('departments')
  @ZodResponse(z.array(DimensionSchema))
  listDepartments(@ZodQuery(ListQuerySchema) query: z.infer<typeof ListQuerySchema>) {
    return this.dimensions.list('department', query.includeInactive);
  }

  @RequirePermission('accounting', 'read')
  @Get('projects')
  @ZodResponse(z.array(ProjectSchema))
  listProjects(@ZodQuery(ListQuerySchema) query: z.infer<typeof ListQuerySchema>) {
    return this.dimensions.list('project', query.includeInactive);
  }

  @RequirePermission('accounting', 'write')
  @Post('departments')
  @ZodResponse(DimensionSchema, { status: 201 })
  createDepartment(@ZodBody(DimensionInputSchema) body: z.infer<typeof DimensionInputSchema>) {
    return this.dimensions.create('department', body);
  }

  @RequirePermission('accounting', 'write')
  @Post('projects')
  @ZodResponse(ProjectSchema, { status: 201 })
  createProject(@ZodBody(ProjectInputSchema) body: ProjectInput) {
    return this.dimensions.create('project', body);
  }

  @RequirePermission('accounting', 'write')
  @Patch('departments/:id')
  @ZodResponse(DimensionSchema)
  updateDepartment(
    @UuidParam('id') id: string,
    @ZodBody(DimensionInputSchema.partial()) body: Partial<z.infer<typeof DimensionInputSchema>>,
  ) {
    return this.dimensions.update('department', id, body);
  }

  @RequirePermission('accounting', 'write')
  @Patch('projects/:id')
  @ZodResponse(ProjectSchema)
  updateProject(
    @UuidParam('id') id: string,
    @ZodBody(
      DimensionInputSchema.partial().extend({
        startDate: z.iso.date().nullish(),
        endDate: z.iso.date().nullish(),
      }),
    )
    body: Partial<ProjectInput>,
  ) {
    return this.dimensions.update('project', id, body);
  }

  @RequirePermission('accounting', 'write')
  @Delete('departments/:id')
  @HttpCode(204)
  async removeDepartment(@UuidParam('id') id: string): Promise<void> {
    await this.dimensions.remove('department', id);
  }

  @RequirePermission('accounting', 'write')
  @Delete('projects/:id')
  @HttpCode(204)
  async removeProject(@UuidParam('id') id: string): Promise<void> {
    await this.dimensions.remove('project', id);
  }
}
