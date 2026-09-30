import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { vatFromSupply } from '@wellbuddy/accounting-core';
import {
  companies,
  type EvidenceSource,
  taxInvoiceIssues,
  taxInvoices,
  type Transaction,
} from '@wellbuddy/db';
import {
  type IssuedTaxInvoice,
  ProviderError,
  ProviderRegistry,
  type TaxInvoiceIssuer,
  type TaxInvoiceRecord,
  taxInvoiceHash,
} from '@wellbuddy/integrations';
import type { TaxInvoiceCancelInput, TaxInvoiceIssueInput } from '@wellbuddy/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EvidenceStore } from './evidence-store.service.js';

type IssueRow = typeof taxInvoiceIssues.$inferSelect;

/** 공급자에 보내는 우리 쪽 관리번호: WB + 작성일 + 무작위 8자(영문·숫자 18자) */
function newMgtKey(issueDate: string) {
  return `WB${issueDate.replaceAll('-', '')}${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * 전자세금계산서 발행·취소·상태조회(P2-14). 연동관리의 '전자세금계산서 발행' 채널(모의·팝빌)로 보낸다.
 * 발행되면(승인번호가 생기면) 매출 세금계산서로도 등록해 자동분개·외상 반제로 이어지게 한다.
 */
@Injectable()
export class TaxInvoiceIssuesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly store: EvidenceStore,
    private readonly integrations: IntegrationsService,
    private readonly registry: ProviderRegistry,
  ) {}

  async list() {
    const rows = await this.db.tenant((tx) =>
      tx
        .select({ issue: taxInvoiceIssues, evidenceStatus: taxInvoices.status })
        .from(taxInvoiceIssues)
        .leftJoin(taxInvoices, eq(taxInvoices.id, taxInvoiceIssues.taxInvoiceId))
        .orderBy(desc(taxInvoiceIssues.createdAt))
        .limit(500),
    );
    return rows.map(({ issue, evidenceStatus }) => this.toDto(issue, evidenceStatus));
  }

  private async get(id: string) {
    const [row] = await this.db.tenant((tx) =>
      tx
        .select({ issue: taxInvoiceIssues, evidenceStatus: taxInvoices.status })
        .from(taxInvoiceIssues)
        .leftJoin(taxInvoices, eq(taxInvoices.id, taxInvoiceIssues.taxInvoiceId))
        .where(eq(taxInvoiceIssues.id, id)),
    );
    if (!row) throw new NotFoundException();
    return this.toDto(row.issue, row.evidenceStatus);
  }

  private toDto(row: IssueRow, evidenceStatus: string | null) {
    return {
      id: row.id,
      mgtKey: row.mgtKey,
      provider: row.provider,
      status: row.status,
      kind: row.kind,
      issueDate: row.issueDate,
      buyerBizNo: row.buyerBizNo,
      buyerName: row.buyerName,
      buyerCeoName: row.buyerCeoName,
      buyerEmail: row.buyerEmail,
      itemName: row.itemName,
      supplyAmount: row.supplyAmount,
      vatAmount: row.vatAmount,
      totalAmount: row.totalAmount,
      approvalNo: row.approvalNo,
      message: row.message,
      taxInvoiceId: row.taxInvoiceId,
      evidenceStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 켜 둔 발행 공급자와 회사 정보 */
  private async issuer() {
    const { companyId } = requireCompanyContext();
    const setting = await this.integrations.providerSetting('taxinvoice');
    if (!setting.enabled) {
      throw new AppException(
        'CHANNEL_DISABLED',
        '설정 > 연동관리에서 전자세금계산서 발행을 켜 주세요.',
      );
    }
    const [company] = await this.db.tenant((tx) =>
      tx
        .select({
          name: companies.name,
          bizRegNo: companies.bizRegNo,
          representative: companies.representative,
        })
        .from(companies)
        .where(eq(companies.id, companyId)),
    );
    try {
      const issuer = this.registry.resolve('taxinvoice', setting, {
        companyId,
        companyName: company!.name,
        bizNo: company!.bizRegNo.replace(/\D/g, '') || null,
      }) as TaxInvoiceIssuer;
      return { issuer, provider: setting.provider, company: company! };
    } catch (e) {
      if (e instanceof ProviderError) throw new AppException(e.code, e.message);
      throw e;
    }
  }

  /** 외부 호출 오류는 502 로 알린다 */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ProviderError) {
        throw new AppException(e.code, e.message, HttpStatus.BAD_GATEWAY);
      }
      throw e;
    }
  }

  /** 발행된 계산서를 매출 세금계산서(증빙)로 등록하고 그 id 를 돌려준다 */
  private async registerEvidence(
    tx: Transaction,
    row: IssueRow,
    approvalNo: string,
    company: { name: string; bizRegNo: string },
  ) {
    const record: TaxInvoiceRecord = {
      direction: 'sales',
      kind: row.kind,
      approvalNo,
      issueDate: row.issueDate,
      supplierBizNo: company.bizRegNo.replace(/\D/g, ''),
      supplierName: company.name,
      buyerBizNo: row.buyerBizNo,
      buyerName: row.buyerName,
      supplyAmount: row.supplyAmount,
      vatAmount: row.vatAmount,
      totalAmount: row.totalAmount,
      itemSummary: row.itemName,
    };
    await this.store.insertTaxInvoices(tx, [record], row.provider as EvidenceSource, null);
    const [evidence] = await tx
      .select({ id: taxInvoices.id })
      .from(taxInvoices)
      .where(eq(taxInvoices.dedupeHash, taxInvoiceHash(record)));
    return evidence?.id ?? null;
  }

  async issue(input: TaxInvoiceIssueInput) {
    const { companyId, userId } = requireCompanyContext();
    const { issuer, provider, company } = await this.issuer();
    const vatAmount =
      input.kind === 'tax' ? (input.vatAmount ?? vatFromSupply(input.supplyAmount).vat) : 0;
    const mgtKey = newMgtKey(input.issueDate);
    const result = await this.call(() =>
      issuer.issue({
        issueDate: input.issueDate,
        kind: input.kind,
        supplierCeoName: company.representative,
        buyerBizNo: input.buyerBizNo,
        buyerName: input.buyerName,
        buyerCeoName: input.buyerCeoName || null,
        buyerEmail: input.buyerEmail || null,
        supplyAmount: input.supplyAmount,
        vatAmount,
        itemName: input.itemName,
        mgtKey,
      }),
    );

    const id = await this.db.tenant(async (tx) => {
      const [row] = await tx
        .insert(taxInvoiceIssues)
        .values({
          companyId,
          mgtKey,
          provider,
          status: result.status,
          kind: input.kind,
          issueDate: input.issueDate,
          buyerBizNo: input.buyerBizNo,
          buyerName: input.buyerName,
          buyerCeoName: input.buyerCeoName || null,
          buyerEmail: input.buyerEmail || null,
          itemName: input.itemName,
          supplyAmount: input.supplyAmount,
          vatAmount,
          totalAmount: input.supplyAmount + vatAmount,
          approvalNo: result.approvalNo,
          message: result.message ?? null,
          createdBy: userId,
        })
        .returning();
      if (result.approvalNo) {
        const taxInvoiceId = await this.registerEvidence(tx, row!, result.approvalNo, company);
        await tx
          .update(taxInvoiceIssues)
          .set({ taxInvoiceId })
          .where(eq(taxInvoiceIssues.id, row!.id));
      }
      await this.audit.record(
        {
          action: 'tax_invoice.issue',
          entity: 'tax_invoice_issue',
          entityId: row!.id,
          after: {
            mgtKey,
            provider,
            buyerBizNo: input.buyerBizNo,
            totalAmount: input.supplyAmount + vatAmount,
            approvalNo: result.approvalNo,
          },
        },
        tx,
      );
      return row!.id;
    });
    return this.get(id);
  }

  private async row(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(taxInvoiceIssues)
      .where(eq(taxInvoiceIssues.id, id))
      .for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  async cancel(id: string, input: TaxInvoiceCancelInput) {
    const current = await this.db.tenant((tx) => this.row(tx, id));
    if (current.status === 'cancelled') {
      throw new AppException('ALREADY_CANCELLED', '이미 취소한 계산서입니다.', HttpStatus.CONFLICT);
    }
    const { issuer } = await this.issuer();
    const result = await this.call(() => issuer.cancel(current.mgtKey, input.reason));

    let notice: string | null = null;
    await this.db.tenant(async (tx) => {
      const row = await this.row(tx, id);
      if (row.taxInvoiceId) {
        // 아직 분개하지 않은 매출 증빙은 제외하고, 이미 전표가 있으면 역분개를 안내한다
        const [ignored] = await tx
          .update(taxInvoices)
          .set({ status: 'ignored', updatedAt: new Date() })
          .where(
            and(
              eq(taxInvoices.id, row.taxInvoiceId),
              inArray(taxInvoices.status, ['pending', 'review']),
            ),
          )
          .returning({ id: taxInvoices.id });
        if (!ignored) {
          const [linked] = await tx
            .select({ status: taxInvoices.status })
            .from(taxInvoices)
            .where(eq(taxInvoices.id, row.taxInvoiceId));
          if (linked?.status === 'posted') {
            notice = '이 계산서로 만든 전표가 있습니다. 전표를 역분개해 주세요.';
          }
        }
      }
      await tx
        .update(taxInvoiceIssues)
        .set({
          status: 'cancelled',
          message: [input.reason, result.message].filter(Boolean).join(' · '),
          updatedAt: new Date(),
        })
        .where(eq(taxInvoiceIssues.id, id));
      await this.audit.record(
        {
          action: 'tax_invoice.cancel',
          entity: 'tax_invoice_issue',
          entityId: id,
          before: { status: row.status },
          after: { status: 'cancelled', reason: input.reason },
        },
        tx,
      );
    });
    return { ...(await this.get(id)), notice };
  }

  /** 공급자에게 상태(국세청 전송 결과)를 다시 묻는다 */
  async refresh(id: string) {
    const current = await this.db.tenant((tx) => this.row(tx, id));
    if (current.status === 'cancelled') return this.get(id);
    const { issuer, company } = await this.issuer();
    const result: IssuedTaxInvoice = await this.call(() => issuer.getStatus(current.mgtKey));
    await this.db.tenant(async (tx) => {
      const row = await this.row(tx, id);
      const approvalNo = result.approvalNo ?? row.approvalNo;
      let taxInvoiceId = row.taxInvoiceId;
      if (!taxInvoiceId && approvalNo && result.status !== 'cancelled') {
        taxInvoiceId = await this.registerEvidence(tx, row, approvalNo, company);
      }
      await tx
        .update(taxInvoiceIssues)
        .set({
          status: result.status,
          approvalNo,
          taxInvoiceId,
          message: result.message ?? row.message,
          updatedAt: new Date(),
        })
        .where(eq(taxInvoiceIssues.id, id));
    });
    return this.get(id);
  }
}
