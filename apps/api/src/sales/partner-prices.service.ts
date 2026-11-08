import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { items, partnerItemPrices, partners } from '@wellbuddy/db';
import type { PartnerPriceInput } from '@wellbuddy/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isForeignKeyViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

/** 거래처별 단가: 같은 품목이라도 거래처마다 판매·구매 단가를 다르게 둔다. */
@Injectable()
export class PartnerPricesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: { partnerId?: string; itemId?: string }) {
    return this.db.tenant((tx) =>
      tx
        .select({
          id: partnerItemPrices.id,
          partnerId: partnerItemPrices.partnerId,
          partnerName: partners.name,
          itemId: partnerItemPrices.itemId,
          itemCode: items.code,
          itemName: items.name,
          unit: items.unit,
          salesPrice: partnerItemPrices.salesPrice,
          purchasePrice: partnerItemPrices.purchasePrice,
          memo: partnerItemPrices.memo,
        })
        .from(partnerItemPrices)
        .innerJoin(partners, eq(partners.id, partnerItemPrices.partnerId))
        .innerJoin(items, eq(items.id, partnerItemPrices.itemId))
        .where(
          and(
            filter.partnerId ? eq(partnerItemPrices.partnerId, filter.partnerId) : undefined,
            filter.itemId ? eq(partnerItemPrices.itemId, filter.itemId) : undefined,
          ),
        )
        .orderBy(asc(partners.name), asc(items.code)),
    );
  }

  /** 거래처·품목마다 한 줄: 있으면 고치고 없으면 만든다. */
  async upsert(input: PartnerPriceInput) {
    const { companyId } = requireCompanyContext();
    try {
      const id = await this.db.tenant(async (tx) => {
        const values = {
          salesPrice: input.salesPrice ?? null,
          purchasePrice: input.purchasePrice ?? null,
          memo: input.memo ?? null,
        };
        const [row] = await tx
          .insert(partnerItemPrices)
          .values({ companyId, partnerId: input.partnerId, itemId: input.itemId, ...values })
          .onConflictDoUpdate({
            target: [
              partnerItemPrices.companyId,
              partnerItemPrices.partnerId,
              partnerItemPrices.itemId,
            ],
            set: { ...values, updatedAt: new Date() },
          })
          .returning({ id: partnerItemPrices.id });
        await this.audit.record(
          {
            action: 'partner_price.upsert',
            entity: 'partner_price',
            entityId: row!.id,
            after: input,
          },
          tx,
        );
        return row!.id;
      });
      const [dto] = (await this.list({ partnerId: input.partnerId, itemId: input.itemId })).filter(
        (p) => p.id === id,
      );
      return dto!;
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new AppException(
          'NOT_FOUND',
          '거래처나 품목을 찾을 수 없습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw e;
    }
  }

  async remove(id: string) {
    await this.db.tenant(async (tx) => {
      const [row] = await tx.select().from(partnerItemPrices).where(eq(partnerItemPrices.id, id));
      if (!row) throw new NotFoundException();
      await tx.delete(partnerItemPrices).where(eq(partnerItemPrices.id, id));
      await this.audit.record(
        { action: 'partner_price.delete', entity: 'partner_price', entityId: id, before: row },
        tx,
      );
    });
  }
}
