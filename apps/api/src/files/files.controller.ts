import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/errors.js';
import { UuidParam, ZodResponse } from '../common/zod.js';
import { FilesService, MAX_FILE_BYTES } from './files.service.js';

const FileMetaSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  createdAt: z.iso.datetime(),
});

/** 증빙·첨부 파일. 회사 구성원이면 올리고 내려받을 수 있다(회사 간 격리는 RLS). */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES + 1, files: 1 } }))
  @ZodResponse(FileMetaSchema, { status: 201 })
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppException('FILE_REQUIRED', '파일을 선택해 주세요.');
    return this.files.upload({
      buffer: file.buffer,
      originalname: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    });
  }

  @Get(':id')
  @ZodResponse(FileMetaSchema)
  async meta(@UuidParam('id') id: string) {
    return this.files.toMeta(await this.files.get(id));
  }

  @Get(':id/download')
  async download(@UuidParam('id') id: string, @Res() res: Response) {
    const { meta, body } = await this.files.download(id);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
    );
    res.send(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@UuidParam('id') id: string): Promise<void> {
    await this.files.remove(id);
  }
}
