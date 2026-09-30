import {
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
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  type ReceiptListQuery,
  ReceiptListQuerySchema,
  type ReceiptUpdateInput,
  ReceiptUpdateSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { AppException } from '../common/errors.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { MAX_FILE_BYTES } from '../files/files.service.js';
import { ReceiptResultSchema, ReceiptSchema, ReceiptUploadSchema } from './evidence.schemas.js';
import { ReceiptsService } from './receipts.service.js';

/** 영수증 업로드 → OCR → 증빙 등록, 사업자번호 확인(P2-18) */
@ApiTags('evidence')
@Controller('evidence/receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @RequirePermission('evidence', 'write')
  @Post()
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES + 1, files: 1 } }))
  @ZodResponse(ReceiptUploadSchema, {
    description: '영수증 사진·PDF 를 저장하고 OCR 로 읽어 등록한다(같은 파일은 기존 것을 돌려준다)',
  })
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppException('FILE_REQUIRED', '파일을 선택해 주세요.');
    return this.receipts.upload({
      buffer: file.buffer,
      originalname: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    });
  }

  @RequirePermission('evidence', 'read')
  @Get()
  @ZodResponse(z.array(ReceiptSchema), { description: '영수증(최근 500건)' })
  list(@ZodQuery(ReceiptListQuerySchema) q: ReceiptListQuery) {
    return this.receipts.list(q);
  }

  @RequirePermission('evidence', 'read')
  @Get(':id')
  @ZodResponse(ReceiptSchema)
  get(@UuidParam('id') id: string) {
    return this.receipts.get(id);
  }

  @RequirePermission('evidence', 'write')
  @Patch(':id')
  @ZodResponse(ReceiptResultSchema, { description: '인식값 수정(사업자번호가 바뀌면 다시 확인)' })
  update(@UuidParam('id') id: string, @ZodBody(ReceiptUpdateSchema) body: ReceiptUpdateInput) {
    return this.receipts.update(id, body);
  }

  @RequirePermission('evidence', 'write')
  @Post(':id/verify-biz-no')
  @HttpCode(200)
  @ZodResponse(ReceiptResultSchema, { description: '사업자번호 상태를 다시 조회' })
  verifyBizNo(@UuidParam('id') id: string) {
    return this.receipts.verifyBizNo(id);
  }

  @RequirePermission('evidence', 'write')
  @Delete(':id')
  @HttpCode(204)
  async remove(@UuidParam('id') id: string): Promise<void> {
    await this.receipts.remove(id);
  }
}
