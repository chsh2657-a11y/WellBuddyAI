import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { items, partners, taxInvoiceIssues, tradeDocLines, tradeDocs } from '@wellbuddy/db';
import type { TaxInvoiceDraftLine } from '@wellbuddy/integrations';
import { isValidBizRegNo, type TradeTaxInvoiceIssueInput } from '@wellbuddy/shared';
import { asc, eq } from 'drizzle-orm';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';
import { TaxInvoiceIssuesService } from '../evidence/tax-invoice-issues.service.js';

/** 팝빌 detailList 최대 줄 수 */
const MAX_DETAIL_LINES = 99;
const TAX_KIND = { taxable: 'tax', zero_rated: 'zero', exempt: 'exempt' } as const;

/**
 * 판매 → 전자세금계산서 발행(P3-08). 금액·품목 줄·공급받는자는 판매 문서와 거래처에서 가져오고,
 * 발행되면 매출 세금계산서(증빙)를 판매 전표에 이어 자동분개가 다시 분개하지 않게 한다.
 */
@Injectable()
export class TradeTaxInvoiceService {
  constructor(
    private readonly db: DbService,
    private readonly issues: TaxInvoiceIssuesService,
  ) {}

  async issue(docId: string, input: TradeTaxInvoiceIssueInput) {
    const { doc, partner, lines, attempt } = await this.db.tenant(async (tx) => {
      const [row] = await tx
        .select({ doc: tradeDocs, partner: partners })
        .from(tradeDocs)
        .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
        .where(eq(tradeDocs.id, docId));
      if (!row) throw new NotFoundException();
      const { doc, partner } = row;
      if (doc.kind !== 'sale') {
        throw new AppException('NOT_SALE', '판매에서만 전자세금계산서를 발행할 수 있습니다.');
      }
      if (doc.status !== 'posted') {
        throw new AppException(
          'DOC_CANCELLED',
          '취소한 판매는 발행할 수 없습니다.',
          HttpStatus.CONFLICT,
        );
      }
      if (doc.evidenceType && !['tax_invoice', 'invoice'].includes(doc.evidenceType)) {
        throw new AppException(
          'EVIDENCE_NOT_TAX_INVOICE',
          '증빙이 세금계산서·계산서인 판매만 발행할 수 있습니다.',
        );
      }
      if (!partner?.bizRegNo || !isValidBizRegNo(partner.bizRegNo)) {
        throw new AppException(
          'PARTNER_BIZ_NO_REQUIRED',
          '거래처의 사업자번호를 먼저 입력해 주세요.',
        );
      }
      if (doc.total <= 0) {
        throw new AppException('AMOUNT_REQUIRED', '금액이 0원인 판매는 발행할 수 없습니다.');
      }
      const issued = await tx
        .select({ status: taxInvoiceIssues.status })
        .from(taxInvoiceIssues)
        .where(eq(taxInvoiceIssues.tradeDocId, doc.id));
      if (doc.taxInvoiceId || issued.some((i) => i.status !== 'cancelled')) {
        throw new AppException(
          'TAX_INVOICE_ALREADY_LINKED',
          '이미 세금계산서와 연결된 판매입니다.',
          HttpStatus.CONFLICT,
        );
      }
      const lines = await tx
        .select({ line: tradeDocLines, vatType: items.vatType })
        .from(tradeDocLines)
        .innerJoin(items, eq(items.id, tradeDocLines.itemId))
        .where(eq(tradeDocLines.docId, doc.id))
        .orderBy(asc(tradeDocLines.lineNo));
      return {
        doc,
        partner: { ...partner, bizRegNo: partner.bizRegNo },
        lines,
        attempt: issued.length + 1,
      };
    });

    const first = lines[0]!;
    const itemName = (
      lines.length > 1 ? `${first.line.itemName} 외 ${lines.length - 1}건` : first.line.itemName
    ).slice(0, 100);
    const draftLines: TaxInvoiceDraftLine[] =
      lines.length <= MAX_DETAIL_LINES
        ? lines.map(({ line }) => ({
            itemName: line.itemName,
            spec: line.spec,
            qty: line.qty,
            unitPrice: line.unitPrice,
            supplyAmount: line.supply,
            vatAmount: line.vat,
          }))
        : [{ itemName, supplyAmount: doc.supplyTotal, vatAmount: doc.vatTotal }];

    return this.issues.issue(
      {
        issueDate: input.issueDate ?? doc.docDate,
        kind: TAX_KIND[first.vatType],
        buyerBizNo: partner.bizRegNo,
        buyerName: partner.name,
        buyerCeoName: input.buyerCeoName ?? partner.representative ?? undefined,
        buyerEmail: input.buyerEmail ?? partner.email ?? undefined,
        itemName,
        supplyAmount: doc.supplyTotal,
        vatAmount: doc.vatTotal,
      },
      // 관리번호를 판매 번호로 정해 같은 판매를 두 번 발행하지 못하게 한다(팝빌도 중복 관리번호를 거절)
      { tradeDocId: doc.id, mgtKey: `${doc.docNo}-${attempt}`, lines: draftLines },
    );
  }
}
