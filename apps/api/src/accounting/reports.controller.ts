import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { RequirePermission } from '../auth/decorators.js';
import { todayKst } from '../common/dates.js';
import { buildReportWorkbook, sendXlsx, XLSX_MIME } from '../common/xlsx.js';
import { ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import {
  AccountLedgerSchema,
  AgingQuerySchema,
  AgingSchema,
  BalanceSheetSchema,
  DailySummarySchema,
  DashboardSchema,
  DateQuerySchema,
  GeneralLedgerQuerySchema,
  GeneralLedgerSchema,
  IncomeStatementSchema,
  LedgerQuerySchema,
  OptionalDateQuerySchema,
  PartnerBalancesQuerySchema,
  PartnerBalancesSchema,
  RangeQuerySchema,
  ReportExportSchema,
  TrialBalanceSchema,
} from './report.schemas.js';
import { ReportsService } from './reports.service.js';

type Q<T extends z.ZodType> = z.infer<T>;

/** 장부·보고서 (전기·역분개된 전표만 집계) */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('accounting', 'read')
  @Get('daily-summary')
  @ZodResponse(DailySummarySchema, { description: '일계표·월계표(현금·대체 구분)' })
  dailySummary(@ZodQuery(RangeQuerySchema) q: Q<typeof RangeQuerySchema>) {
    return this.reports.dailySummary(q.from, q.to);
  }

  @RequirePermission('accounting', 'read')
  @Get('account-ledger')
  @ZodResponse(AccountLedgerSchema, {
    description: '계정별원장(partnerId 를 주면 거래처원장, 현금 계정이면 현금출납장)',
  })
  accountLedger(@ZodQuery(LedgerQuerySchema) q: Q<typeof LedgerQuerySchema>) {
    return this.reports.accountLedger(q);
  }

  @RequirePermission('accounting', 'read')
  @Get('general-ledger')
  @ZodResponse(GeneralLedgerSchema, { description: '총계정원장(회계연도 월별)' })
  generalLedger(@ZodQuery(GeneralLedgerQuerySchema) q: Q<typeof GeneralLedgerQuerySchema>) {
    return this.reports.generalLedger(q.accountId, q.date);
  }

  @RequirePermission('accounting', 'read')
  @Get('partner-balances')
  @ZodResponse(PartnerBalancesSchema, { description: '거래처별 잔액(계정 하나)' })
  partnerBalances(@ZodQuery(PartnerBalancesQuerySchema) q: Q<typeof PartnerBalancesQuerySchema>) {
    return this.reports.partnerBalances(q.accountId, q.from, q.to);
  }

  @RequirePermission('accounting', 'read')
  @Get('trial-balance')
  @ZodResponse(TrialBalanceSchema, { description: '합계잔액시산표(회계연도 누적)' })
  trialBalance(@ZodQuery(DateQuerySchema) q: Q<typeof DateQuerySchema>) {
    return this.reports.trialBalance(q.date);
  }

  @RequirePermission('accounting', 'read')
  @Get('income-statement')
  @ZodResponse(IncomeStatementSchema, { description: '손익계산서(기간)' })
  incomeStatement(@ZodQuery(RangeQuerySchema) q: Q<typeof RangeQuerySchema>) {
    return this.reports.incomeStatement(q.from, q.to);
  }

  @RequirePermission('accounting', 'read')
  @Get('balance-sheet')
  @ZodResponse(BalanceSheetSchema, { description: '재무상태표(기준일)' })
  balanceSheet(@ZodQuery(DateQuerySchema) q: Q<typeof DateQuerySchema>) {
    return this.reports.balanceSheet(q.date);
  }

  @RequirePermission('accounting', 'read')
  @Get('aging')
  @ZodResponse(AgingSchema, { description: '채권·채무 잔액과 연령분석' })
  aging(@ZodQuery(AgingQuerySchema) q: Q<typeof AgingQuerySchema>) {
    return this.reports.aging(q.kind, q.date);
  }

  @RequirePermission('accounting', 'read')
  @Get('dashboard')
  @ZodResponse(DashboardSchema, { description: '대시보드 지표(현금·예금·채권·채무·월별 손익)' })
  dashboard(@ZodQuery(OptionalDateQuerySchema) q: Q<typeof OptionalDateQuerySchema>) {
    return this.reports.dashboard(q.date);
  }

  /** 화면에 보이는 보고서 표를 엑셀로 내려받는다 */
  @RequirePermission('accounting', 'read')
  @Post('export')
  @HttpCode(200)
  @ApiProduces(XLSX_MIME)
  async export(
    @ZodBody(ReportExportSchema) body: Q<typeof ReportExportSchema>,
    @Res() res: Response,
  ) {
    const buffer = await buildReportWorkbook(body);
    await this.audit.record({
      action: 'report.export',
      entity: 'report',
      after: { title: body.title, rows: body.rows.length },
    });
    sendXlsx(res, `${body.title}_${todayKst()}.xlsx`, buffer);
  }
}
