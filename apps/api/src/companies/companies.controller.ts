import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type CreateCompanyInput, CreateCompanySchema } from '@wellbuddy/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { setAuthCookies, wantsTokenMode } from '../auth/auth.cookies.js';
import { AllowNoCompany, Public, RequirePermission } from '../auth/decorators.js';
import { TokenService } from '../auth/token.service.js';
import { requireContext } from '../common/request-context.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import {
  BusinessPlaceInputSchema,
  BusinessPlaceSchema,
  CompanySchema,
  CreateCompanyResultSchema,
  CreateInvitationSchema,
  InvitationLookupSchema,
  InvitationSchema,
  TokenBodySchema,
  UpdateCompanySchema,
} from './companies.schemas.js';
import { CompaniesService } from './companies.service.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('companies')
@Controller()
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly invitations: InvitationsService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ── 회사 ──────────────────────────────────────────────

  @AllowNoCompany()
  @Post('companies')
  @ZodResponse(CreateCompanyResultSchema, { status: 201, description: '만든 회사로 바로 전환된다' })
  async create(
    @ZodBody(CreateCompanySchema) body: CreateCompanyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId } = requireContext();
    const company = await this.companies.create(userId, body);
    return { company, ...(await this.switchTo(req, res, userId, company.id)) };
  }

  @RequirePermission('settings.company', 'read')
  @Get('companies/current')
  @ZodResponse(CompanySchema)
  current() {
    return this.companies.getCurrent();
  }

  @RequirePermission('settings.company', 'write')
  @Patch('companies/current')
  @ZodResponse(CompanySchema)
  update(@ZodBody(UpdateCompanySchema) body: z.infer<typeof UpdateCompanySchema>) {
    return this.companies.updateCurrent(body);
  }

  // ── 사업장 ────────────────────────────────────────────

  @RequirePermission('settings.company', 'read')
  @Get('business-places')
  @ZodResponse(z.array(BusinessPlaceSchema))
  listPlaces() {
    return this.companies.listPlaces();
  }

  @RequirePermission('settings.company', 'write')
  @Post('business-places')
  @ZodResponse(BusinessPlaceSchema, { status: 201 })
  createPlace(@ZodBody(BusinessPlaceInputSchema) body: z.infer<typeof BusinessPlaceInputSchema>) {
    return this.companies.createPlace(body);
  }

  @RequirePermission('settings.company', 'write')
  @Patch('business-places/:id')
  @ZodResponse(BusinessPlaceSchema)
  updatePlace(
    @UuidParam('id') id: string,
    @ZodBody(BusinessPlaceInputSchema.partial())
    body: Partial<z.infer<typeof BusinessPlaceInputSchema>>,
  ) {
    return this.companies.updatePlace(id, body);
  }

  @RequirePermission('settings.company', 'write')
  @Delete('business-places/:id')
  @HttpCode(204)
  async removePlace(@UuidParam('id') id: string): Promise<void> {
    await this.companies.removePlace(id);
  }

  // ── 초대 ──────────────────────────────────────────────

  @RequirePermission('settings.users', 'read')
  @Get('invitations')
  @ZodResponse(z.array(InvitationSchema))
  listInvitations() {
    return this.invitations.listPending();
  }

  @RequirePermission('settings.users', 'write')
  @Post('invitations')
  @ZodResponse(InvitationSchema, { status: 201, description: '초대 메일을 보낸다' })
  invite(@ZodBody(CreateInvitationSchema) body: z.infer<typeof CreateInvitationSchema>) {
    return this.invitations.create(body.email, body.role);
  }

  @RequirePermission('settings.users', 'write')
  @Delete('invitations/:id')
  @HttpCode(204)
  async revokeInvitation(@UuidParam('id') id: string): Promise<void> {
    await this.invitations.revoke(id);
  }

  @Public()
  @Get('invitations/lookup')
  @ZodResponse(InvitationLookupSchema)
  lookupInvitation(@ZodQuery(TokenBodySchema) query: z.infer<typeof TokenBodySchema>) {
    return this.invitations.lookup(query.token);
  }

  @AllowNoCompany()
  @Post('invitations/accept')
  @HttpCode(200)
  @ZodResponse(z.object({ companyId: z.uuid(), accessToken: z.string().optional() }))
  async acceptInvitation(
    @ZodBody(TokenBodySchema) body: z.infer<typeof TokenBodySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId } = requireContext();
    const companyId = await this.invitations.accept(userId, body.token);
    return { companyId, ...(await this.switchTo(req, res, userId, companyId)) };
  }

  /** 새 회사로 전환한 액세스 토큰을 쿠키(웹) 또는 응답 본문(모바일)으로 돌려준다. */
  private async switchTo(req: Request, res: Response, userId: string, companyId: string) {
    const accessToken = await this.tokens.signAccessToken({ userId, companyId });
    if (wantsTokenMode(req)) return { accessToken };
    setAuthCookies(res, { accessToken }, this.config);
    return {};
  }
}
