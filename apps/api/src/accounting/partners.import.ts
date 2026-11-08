import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  formatBizRegNo,
  PARTNER_KIND_LABELS,
  PARTNER_KINDS,
  type PartnerInput,
  PartnerInputSchema,
  type PartnerKind,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { ImportRegistry } from '../imports/import-registry.js';
import { PartnersService } from './partners.service.js';

const KIND_BY_LABEL = new Map<string, PartnerKind>(
  PARTNER_KINDS.map((k) => [PARTNER_KIND_LABELS[k], k]),
);

/** 엑셀의 "구분" 칸은 한글 라벨(매출처·매입처·매출·매입·기타)로 받는다. */
const RowSchema = z.preprocess((raw) => {
  const row = { ...(raw as Record<string, unknown>) };
  if (typeof row.kind === 'string') row.kind = KIND_BY_LABEL.get(row.kind.trim()) ?? row.kind;
  return row;
}, PartnerInputSchema);

@Injectable()
export class PartnersImport implements OnModuleInit {
  constructor(
    private readonly registry: ImportRegistry,
    private readonly partners: PartnersService,
  ) {}

  onModuleInit() {
    this.registry.register<PartnerInput>({
      key: 'partners',
      label: '거래처',
      permission: 'accounting',
      columns: [
        {
          key: 'code',
          header: '거래처코드',
          required: false,
          example: '',
          help: '비우면 자동으로 부여합니다.',
        },
        { key: 'name', header: '거래처명', required: true, example: '(주)한빛상사', width: 24 },
        {
          key: 'kind',
          header: '구분',
          required: false,
          example: '매출·매입',
          help: `${PARTNER_KINDS.map((k) => PARTNER_KIND_LABELS[k]).join(' / ')} 중 하나(비우면 매출·매입)`,
        },
        {
          key: 'bizRegNo',
          header: '사업자등록번호',
          required: false,
          example: '124-81-00998',
          help: '같은 번호가 이미 있으면 그 거래처를 수정합니다.',
        },
        { key: 'representative', header: '대표자', required: false, example: '김대표' },
        { key: 'businessType', header: '업태', required: false, example: '제조' },
        { key: 'businessItem', header: '종목', required: false, example: '전자부품' },
        { key: 'address', header: '주소', required: false, example: '서울특별시 중구', width: 36 },
        { key: 'phone', header: '전화', required: false, example: '02-123-4567' },
        { key: 'email', header: '이메일', required: false, example: 'tax@hanbit.co.kr', width: 24 },
        { key: 'contactName', header: '담당자', required: false, example: '이담당' },
        { key: 'bankName', header: '은행', required: false, example: '국민은행' },
        {
          key: 'bankAccount',
          header: '계좌번호',
          required: false,
          example: '123456-01-234567',
          help: '암호화해 저장합니다.',
        },
        { key: 'bankHolder', header: '예금주', required: false, example: '(주)한빛상사' },
      ],
      rowSchema: RowSchema as z.ZodType<PartnerInput>,
      uniqueBy: (row) => row.bizRegNo ?? `name:${row.name}`,
      commit: (rows) => this.partners.upsertMany(rows),
      exportRows: async () =>
        (await this.partners.list({ includeInactive: true })).map((p) => ({
          ...p,
          kind: PARTNER_KIND_LABELS[p.kind],
          bizRegNo: p.bizRegNo ? formatBizRegNo(p.bizRegNo) : '',
          bankAccount: p.bankAccountMasked ?? '',
        })),
    });
  }
}
