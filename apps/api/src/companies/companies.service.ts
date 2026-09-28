import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { businessPlaces, companies, companyMembers, companySettings, users } from '@wellbuddy/db';
import type { BusinessPlaceInput, CreateCompanyInput, UpdateCompanyInput } from '@wellbuddy/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

const companyColumns = {
  id: companies.id,
  name: companies.name,
  bizRegNo: companies.bizRegNo,
  representative: companies.representative,
  businessType: companies.businessType,
  businessItem: companies.businessItem,
  address: companies.address,
  phone: companies.phone,
  fiscalYearStartMonth: companies.fiscalYearStartMonth,
};

const placeColumns = {
  id: businessPlaces.id,
  name: businessPlaces.name,
  bizRegNo: businessPlaces.bizRegNo,
  representative: businessPlaces.representative,
  businessType: businessPlaces.businessType,
  businessItem: businessPlaces.businessItem,
  address: businessPlaces.address,
  isHeadquarters: businessPlaces.isHeadquarters,
};

@Injectable()
export class CompaniesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** 회사를 만들고 만든 사람을 대표 관리자로 등록한다. 본점 사업장과 기본 설정도 함께 만든다. */
  async create(userId: string, input: CreateCompanyInput) {
    const companyId = randomUUID();
    const company = await this.db.as({ userId, companyId }, async (tx) => {
      const [created] = await tx
        .insert(companies)
        .values({ id: companyId, ...input, createdBy: userId })
        .returning(companyColumns);
      await tx.insert(companyMembers).values({ companyId, userId, role: 'owner' });
      await tx.insert(companySettings).values({ companyId });
      await tx.insert(businessPlaces).values({
        companyId,
        name: '본점',
        bizRegNo: input.bizRegNo,
        representative: input.representative,
        businessType: input.businessType,
        businessItem: input.businessItem,
        address: input.address,
        isHeadquarters: true,
      });
      await this.audit.record(
        {
          action: 'company.create',
          entity: 'company',
          entityId: companyId,
          companyId,
          after: created,
        },
        tx,
      );
      return created!;
    });
    await this.db.db.update(users).set({ lastCompanyId: companyId }).where(eq(users.id, userId));
    return company;
  }

  async getCurrent() {
    const { companyId } = requireCompanyContext();
    const [company] = await this.db.tenant((tx) =>
      tx.select(companyColumns).from(companies).where(eq(companies.id, companyId)),
    );
    if (!company) throw new NotFoundException();
    return company;
  }

  async updateCurrent(input: UpdateCompanyInput) {
    const { companyId } = requireCompanyContext();
    const company = await this.db.tenant(async (tx) => {
      const [before] = await tx
        .select(companyColumns)
        .from(companies)
        .where(eq(companies.id, companyId));
      const [after] = await tx
        .update(companies)
        .set(input)
        .where(eq(companies.id, companyId))
        .returning(companyColumns);
      if (!after) throw new NotFoundException();
      await this.audit.record(
        { action: 'company.update', entity: 'company', entityId: companyId, before, after },
        tx,
      );
      return after;
    });
    return company;
  }

  listPlaces() {
    return this.db.tenant((tx) =>
      tx
        .select(placeColumns)
        .from(businessPlaces)
        .orderBy(asc(businessPlaces.createdAt), asc(businessPlaces.name)),
    );
  }

  async createPlace(input: BusinessPlaceInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        const [place] = await tx
          .insert(businessPlaces)
          .values({ ...input, companyId })
          .returning(placeColumns);
        await this.audit.record(
          {
            action: 'business_place.create',
            entity: 'business_place',
            entityId: place!.id,
            after: place,
          },
          tx,
        );
        return place!;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw this.duplicatePlace();
      throw e;
    }
  }

  async updatePlace(id: string, input: Partial<BusinessPlaceInput>) {
    try {
      const [place] = await this.db.tenant((tx) =>
        tx
          .update(businessPlaces)
          .set(input)
          .where(eq(businessPlaces.id, id))
          .returning(placeColumns),
      );
      if (!place) throw new NotFoundException();
      return place;
    } catch (e) {
      if (isUniqueViolation(e)) throw this.duplicatePlace();
      throw e;
    }
  }

  async removePlace(id: string) {
    await this.db.tenant(async (tx) => {
      const [place] = await tx
        .select(placeColumns)
        .from(businessPlaces)
        .where(eq(businessPlaces.id, id));
      if (!place) throw new NotFoundException();
      if (place.isHeadquarters) {
        throw new AppException('HEADQUARTERS_REQUIRED', '본점 사업장은 삭제할 수 없습니다.');
      }
      await tx
        .delete(businessPlaces)
        .where(and(eq(businessPlaces.id, id), eq(businessPlaces.isHeadquarters, false)));
      await this.audit.record(
        { action: 'business_place.delete', entity: 'business_place', entityId: id, before: place },
        tx,
      );
    });
  }

  private duplicatePlace() {
    return new AppException(
      'DUPLICATE_BIZ_REG_NO',
      '같은 사업자등록번호의 사업장이 이미 있습니다.',
      HttpStatus.CONFLICT,
    );
  }
}
