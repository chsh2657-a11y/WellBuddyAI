import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type BankAccountInput,
  BankAccountInputSchema,
  type BankAccountUpdateInput,
  BankAccountUpdateSchema,
  type CorporateCardInput,
  CorporateCardInputSchema,
  type CorporateCardUpdateInput,
  CorporateCardUpdateSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodResponse } from '../common/zod.js';
import { SourcesService } from './sources.service.js';

const BankAccountSchema = z.object({
  id: z.uuid(),
  bankCode: z.string(),
  bankName: z.string(),
  alias: z.string(),
  /** 끝 4자리만(****1234) */
  accountNoMasked: z.string(),
  ledgerAccountId: z.uuid(),
  ledgerAccount: z.string(),
  isActive: z.boolean(),
});

const CorporateCardSchema = z.object({
  id: z.uuid(),
  cardCompany: z.string(),
  cardCompanyName: z.string(),
  alias: z.string(),
  cardNoMasked: z.string(),
  holderName: z.string().nullable(),
  ledgerAccountId: z.uuid(),
  ledgerAccount: z.string(),
  isActive: z.boolean(),
});

/** 수집 대상 은행 계좌·법인카드 */
@ApiTags('evidence')
@Controller()
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @RequirePermission('evidence', 'read')
  @Get('bank-accounts')
  @ZodResponse(z.array(BankAccountSchema))
  listBankAccounts() {
    return this.sources.listBankAccounts();
  }

  @RequirePermission('evidence', 'write')
  @Post('bank-accounts')
  @ZodResponse(BankAccountSchema, { status: 201 })
  createBankAccount(@ZodBody(BankAccountInputSchema) body: BankAccountInput) {
    return this.sources.createBankAccount(body);
  }

  @RequirePermission('evidence', 'write')
  @Patch('bank-accounts/:id')
  @ZodResponse(BankAccountSchema)
  updateBankAccount(
    @UuidParam('id') id: string,
    @ZodBody(BankAccountUpdateSchema) body: BankAccountUpdateInput,
  ) {
    return this.sources.updateBankAccount(id, body);
  }

  @RequirePermission('evidence', 'write')
  @Delete('bank-accounts/:id')
  @HttpCode(204)
  removeBankAccount(@UuidParam('id') id: string) {
    return this.sources.removeBankAccount(id);
  }

  @RequirePermission('evidence', 'read')
  @Get('corporate-cards')
  @ZodResponse(z.array(CorporateCardSchema))
  listCards() {
    return this.sources.listCards();
  }

  @RequirePermission('evidence', 'write')
  @Post('corporate-cards')
  @ZodResponse(CorporateCardSchema, { status: 201 })
  createCard(@ZodBody(CorporateCardInputSchema) body: CorporateCardInput) {
    return this.sources.createCard(body);
  }

  @RequirePermission('evidence', 'write')
  @Patch('corporate-cards/:id')
  @ZodResponse(CorporateCardSchema)
  updateCard(
    @UuidParam('id') id: string,
    @ZodBody(CorporateCardUpdateSchema) body: CorporateCardUpdateInput,
  ) {
    return this.sources.updateCard(id, body);
  }

  @RequirePermission('evidence', 'write')
  @Delete('corporate-cards/:id')
  @HttpCode(204)
  removeCard(@UuidParam('id') id: string) {
    return this.sources.removeCard(id);
  }
}
