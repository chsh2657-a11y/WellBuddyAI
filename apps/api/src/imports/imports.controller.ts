import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, type ApiBodyOptions, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/errors.js';
import { ZodResponse } from '../common/zod.js';
import { ImportsService } from './imports.service.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const FileBody: ApiBodyOptions = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

const PreviewSchema = z.object({
  total: z.number(),
  valid: z.number(),
  invalid: z.number(),
  missingHeaders: z.array(z.string()),
  rows: z.array(
    z.object({
      rowNumber: z.number(),
      values: z.record(z.string(), z.string()),
      errors: z.array(z.object({ field: z.string(), message: z.string() })),
    }),
  ),
});

const CommitSchema = z.object({ created: z.number(), updated: z.number(), skipped: z.number() });

function sendXlsx(res: Response, filename: string, buffer: Buffer) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="download.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(buffer);
}

function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) throw new AppException('FILE_REQUIRED', '파일을 선택해 주세요.');
  // multer 는 파일 이름을 latin1 로 해석하므로 한글 이름을 UTF-8 로 되돌린다
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return file;
}

/** 엑셀 일괄 등록(양식 → 미리보기 → 등록)과 내보내기. :spec 은 ImportRegistry 에 등록된 대상. */
@ApiTags('imports')
@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('imports/:spec/template')
  @ApiProduces(XLSX_MIME)
  async template(@Param('spec') key: string, @Res() res: Response) {
    const spec = this.imports.spec(key, 'read');
    sendXlsx(res, `${spec.label}_일괄등록_양식.xlsx`, await this.imports.template(spec));
  }

  @Post('imports/:spec/preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FileBody)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ZodResponse(PreviewSchema, { description: '행별 검증 결과(등록하지 않음)' })
  preview(@Param('spec') key: string, @UploadedFile() file?: Express.Multer.File) {
    const spec = this.imports.spec(key, 'write');
    return this.imports.preview(spec, requireFile(file));
  }

  @Post('imports/:spec/commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FileBody)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ZodResponse(CommitSchema, { description: 'skipInvalid=true 이면 오류 행을 건너뛰고 등록' })
  commit(
    @Param('spec') key: string,
    @Query('skipInvalid') skipInvalid?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const spec = this.imports.spec(key, 'write');
    return this.imports.commit(spec, requireFile(file), skipInvalid === 'true');
  }

  @Get('exports/:spec')
  @ApiProduces(XLSX_MIME)
  async export(@Param('spec') key: string, @Res() res: Response) {
    const spec = this.imports.spec(key, 'read');
    const today = new Date().toISOString().slice(0, 10);
    sendXlsx(res, `${spec.label}_${today}.xlsx`, await this.imports.exportFile(spec));
  }
}
