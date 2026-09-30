import { Injectable, type OnModuleInit } from '@nestjs/common';
import { businessPlaces } from '@wellbuddy/db';
import {
  type BusinessPlaceInput,
  BusinessPlaceInputSchema,
  formatBizRegNo,
} from '@wellbuddy/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { ImportRegistry } from '../imports/import-registry.js';
import { CompaniesService } from './companies.service.js';

/** 사업장 엑셀 일괄 등록: 같은 사업자등록번호가 있으면 수정, 없으면 추가한다. */
@Injectable()
export class BusinessPlacesImport implements OnModuleInit {
  constructor(
    private readonly registry: ImportRegistry,
    private readonly db: DbService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.registry.register<BusinessPlaceInput>({
      key: 'business-places',
      label: '사업장',
      permission: 'settings.company',
      columns: [
        { key: 'name', header: '사업장명', required: true, example: '부산지점', width: 20 },
        {
          key: 'bizRegNo',
          header: '사업자등록번호',
          required: true,
          example: '000-00-00000',
          help: '하이픈은 있어도 없어도 됩니다. 이미 있는 번호면 그 사업장을 수정합니다.',
        },
        { key: 'representative', header: '대표자명', required: false, example: '홍길동' },
        { key: 'businessType', header: '업태', required: false, example: '도소매' },
        { key: 'businessItem', header: '종목', required: false, example: '사무용품' },
        {
          key: 'address',
          header: '주소',
          required: false,
          example: '부산광역시 해운대구',
          width: 40,
        },
      ],
      rowSchema: BusinessPlaceInputSchema,
      uniqueBy: (row) => row.bizRegNo,
      commit: (rows) => this.commit(rows),
      exportRows: async () =>
        (await this.companies.listPlaces()).map((p) => ({
          ...p,
          bizRegNo: formatBizRegNo(p.bizRegNo),
        })),
    });
  }

  private async commit(rows: BusinessPlaceInput[]) {
    const { companyId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const existing = await tx
        .select({ id: businessPlaces.id, bizRegNo: businessPlaces.bizRegNo })
        .from(businessPlaces);
      const byBizNo = new Map(existing.map((e) => [e.bizRegNo, e.id]));
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const id = byBizNo.get(row.bizRegNo);
        if (id) {
          await tx
            .update(businessPlaces)
            .set(row)
            .where(and(eq(businessPlaces.id, id), eq(businessPlaces.companyId, companyId)));
          updated++;
        } else {
          await tx.insert(businessPlaces).values({ ...row, companyId });
          created++;
        }
      }
      await this.audit.record(
        { action: 'business_place.import', entity: 'business_place', after: { created, updated } },
        tx,
      );
      return { created, updated };
    });
  }
}
