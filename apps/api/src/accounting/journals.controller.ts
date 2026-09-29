import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  JournalCreateSchema,
  type JournalCreateInput,
  type JournalEntryInput,
  JournalEntryInputSchema,
  JournalRejectSchema,
  type JournalReverseInput,
  JournalReverseSchema,
} from '@wellbuddy/shared';
import type { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import {
  AttachInputSchema,
  JournalEntrySchema,
  JournalListQuerySchema,
  JournalListSchema,
} from './journal.schemas.js';
import { JournalsService } from './journals.service.js';

/** 전표: 작성·수정·삭제, 승인요청·승인·반려·전기·역분개, 증빙 첨부 */
@ApiTags('journals')
@Controller('journals')
export class JournalsController {
  constructor(private readonly journals: JournalsService) {}

  @RequirePermission('accounting', 'read')
  @Get()
  @ZodResponse(JournalListSchema, { description: '전표 목록(줄 포함)' })
  list(@ZodQuery(JournalListQuerySchema) query: z.infer<typeof JournalListQuerySchema>) {
    return this.journals.list(query);
  }

  @RequirePermission('accounting', 'read')
  @Get(':id')
  @ZodResponse(JournalEntrySchema)
  get(@UuidParam('id') id: string) {
    return this.journals.get(id);
  }

  @RequirePermission('accounting', 'write')
  @Post()
  @ZodResponse(JournalEntrySchema, {
    status: 201,
    description: '전표 저장. status 로 바로 승인요청·전기할 수 있다',
  })
  create(@ZodBody(JournalCreateSchema) body: JournalCreateInput) {
    return this.journals.create(body);
  }

  @RequirePermission('accounting', 'write')
  @Put(':id')
  @ZodResponse(JournalEntrySchema, { description: '작성중 전표 수정' })
  update(@UuidParam('id') id: string, @ZodBody(JournalEntryInputSchema) body: JournalEntryInput) {
    return this.journals.update(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Delete(':id')
  @HttpCode(204)
  remove(@UuidParam('id') id: string) {
    return this.journals.remove(id);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/submit')
  @HttpCode(200)
  @ZodResponse(JournalEntrySchema, { description: '승인요청' })
  submit(@UuidParam('id') id: string) {
    return this.journals.submit(id);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/withdraw')
  @HttpCode(200)
  @ZodResponse(JournalEntrySchema, { description: '승인요청 회수' })
  withdraw(@UuidParam('id') id: string) {
    return this.journals.withdraw(id);
  }

  @RequirePermission('accounting', 'read')
  @Post(':id/approve')
  @HttpCode(200)
  @ZodResponse(JournalEntrySchema, { description: '승인(대표·관리자·결재권자)' })
  approve(@UuidParam('id') id: string) {
    return this.journals.approve(id);
  }

  @RequirePermission('accounting', 'read')
  @Post(':id/reject')
  @HttpCode(200)
  @ZodResponse(JournalEntrySchema, { description: '반려(대표·관리자·결재권자)' })
  reject(
    @UuidParam('id') id: string,
    @ZodBody(JournalRejectSchema) body: z.infer<typeof JournalRejectSchema>,
  ) {
    return this.journals.reject(id, body.reason);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/post')
  @HttpCode(200)
  @ZodResponse(JournalEntrySchema, { description: '바로 전기' })
  post(@UuidParam('id') id: string) {
    return this.journals.post(id);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/reverse')
  @ZodResponse(JournalEntrySchema, { status: 201, description: '역분개 전표 생성' })
  reverse(@UuidParam('id') id: string, @ZodBody(JournalReverseSchema) body: JournalReverseInput) {
    return this.journals.reverse(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/attachments')
  @HttpCode(200)
  @ZodResponse(JournalEntrySchema, { description: '증빙 파일 첨부' })
  attach(
    @UuidParam('id') id: string,
    @ZodBody(AttachInputSchema) body: z.infer<typeof AttachInputSchema>,
  ) {
    return this.journals.addAttachments(id, body.fileIds);
  }

  @RequirePermission('accounting', 'write')
  @Delete(':id/attachments/:fileId')
  @HttpCode(204)
  detach(@UuidParam('id') id: string, @UuidParam('fileId') fileId: string) {
    return this.journals.removeAttachment(id, fileId);
  }
}
