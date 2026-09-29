import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, type ApiBodyOptions, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  type EvidenceListQuery,
  EvidenceListQuerySchema,
  EvidenceStatusUpdateSchema,
  UPLOAD_KINDS,
  type UploadKind,
  UploadOptionsSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { AppException } from '../common/errors.js';
import { UuidParam, ZodBody, ZodParam, ZodQuery, ZodResponse } from '../common/zod.js';
import {
  BankTransactionSchema,
  CardTransactionSchema,
  CashReceiptSchema,
  CollectionRunSchema,
  ImportMappingSchema,
  TaxInvoiceSchema,
  UploadCommitSchema,
  UploadPreviewSchema,
} from './evidence.schemas.js';
import { EvidenceService } from './evidence.service.js';
import { UploadService } from './upload.service.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UploadBody: ApiBodyOptions = {
  schema: {
    type: 'object',
    properties: {
      file: { type: 'string', format: 'binary' },
      options: { type: 'string', description: 'UploadOptions JSON' },
    },
    required: ['file', 'options'],
  },
};

function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) throw new AppException('FILE_REQUIRED', '파일을 선택해 주세요.');
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return file;
}

function parseOptions(raw: unknown) {
  let value: unknown;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new AppException('VALIDATION_ERROR', '업로드 옵션 형식이 잘못되었습니다.');
  }
  const parsed = UploadOptionsSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppException(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.',
      400,
      {
        issues: parsed.error.issues,
      },
    );
  }
  return parsed.data;
}

const KindSchema = z.enum(UPLOAD_KINDS);

/** 증빙 파일 업로드, 수집한 증빙 조회, 제외 처리, 수집 이력 */
@ApiTags('evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly uploads: UploadService,
  ) {}

  @RequirePermission('evidence', 'write')
  @Post('uploads/preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(UploadBody)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ZodResponse(UploadPreviewSchema, {
    description: '파일을 읽어 열 매핑·미리보기·중복 건수를 돌려준다(저장하지 않음)',
  })
  preview(@Body('options') options: unknown, @UploadedFile() file?: Express.Multer.File) {
    return this.uploads.preview(requireFile(file), parseOptions(options));
  }

  @RequirePermission('evidence', 'write')
  @Post('uploads/commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(UploadBody)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ZodResponse(UploadCommitSchema, { description: '읽은 거래를 등록(중복은 건너뜀)' })
  commit(@Body('options') options: unknown, @UploadedFile() file?: Express.Multer.File) {
    return this.uploads.commit(requireFile(file), parseOptions(options));
  }

  @RequirePermission('evidence', 'read')
  @Get('mappings')
  @ZodResponse(z.array(ImportMappingSchema), { description: '저장한 열 매핑' })
  mappings() {
    return this.uploads.listMappings();
  }

  @RequirePermission('evidence', 'write')
  @Delete('mappings/:id')
  @HttpCode(204)
  removeMapping(@UuidParam('id') id: string) {
    return this.uploads.removeMapping(id);
  }

  @RequirePermission('evidence', 'read')
  @Get('bank-transactions')
  @ZodResponse(z.array(BankTransactionSchema))
  bankTransactions(@ZodQuery(EvidenceListQuerySchema) q: EvidenceListQuery) {
    return this.evidence.bankTransactions(q);
  }

  @RequirePermission('evidence', 'read')
  @Get('card-transactions')
  @ZodResponse(z.array(CardTransactionSchema))
  cardTransactions(@ZodQuery(EvidenceListQuerySchema) q: EvidenceListQuery) {
    return this.evidence.cardTransactions(q);
  }

  @RequirePermission('evidence', 'read')
  @Get('tax-invoices')
  @ZodResponse(z.array(TaxInvoiceSchema))
  taxInvoices(@ZodQuery(EvidenceListQuerySchema) q: EvidenceListQuery) {
    return this.evidence.taxInvoices(q);
  }

  @RequirePermission('evidence', 'read')
  @Get('cash-receipts')
  @ZodResponse(z.array(CashReceiptSchema))
  cashReceipts(@ZodQuery(EvidenceListQuerySchema) q: EvidenceListQuery) {
    return this.evidence.cashReceipts(q);
  }

  @RequirePermission('evidence', 'write')
  @Patch(':kind/:id/status')
  @HttpCode(204)
  setStatus(
    @ZodParam('kind', KindSchema) kind: UploadKind,
    @UuidParam('id') id: string,
    @ZodBody(EvidenceStatusUpdateSchema) body: z.infer<typeof EvidenceStatusUpdateSchema>,
  ) {
    return this.evidence.setStatus(kind, id, body.status);
  }

  @RequirePermission('evidence', 'read')
  @Get('runs')
  @ZodResponse(z.array(CollectionRunSchema), { description: '수집 이력(최근 50건)' })
  runs() {
    return this.evidence.runs();
  }
}
