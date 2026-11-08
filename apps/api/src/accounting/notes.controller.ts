import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type NoteDiscountInput,
  NoteDiscountSchema,
  type NoteDishonorInput,
  NoteDishonorSchema,
  type NoteEndorseInput,
  NoteEndorseSchema,
  type NoteListQuery,
  NoteListQuerySchema,
  type NoteRegisterInput,
  NoteRegisterSchema,
  type NoteSettleInput,
  NoteSettleSchema,
} from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodQuery, ZodResponse } from '../common/zod.js';
import { NoteDetailSchema, NoteSchema, NoteUndoResultSchema } from './notes.schemas.js';
import { NotesService } from './notes.service.js';

/** 받을어음·지급어음: 수취·발행, 만기 결제, 할인, 배서양도, 부도, 마지막 처리 취소 */
@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @RequirePermission('accounting', 'read')
  @Get()
  @ZodResponse(z.array(NoteSchema), { description: '어음 목록(만기일순)' })
  list(@ZodQuery(NoteListQuerySchema) q: NoteListQuery) {
    return this.notes.list(q);
  }

  @RequirePermission('accounting', 'read')
  @Get(':id')
  @ZodResponse(NoteDetailSchema, { description: '어음과 처리 이력' })
  get(@UuidParam('id') id: string) {
    return this.notes.get(id);
  }

  @RequirePermission('accounting', 'write')
  @Post()
  @ZodResponse(NoteDetailSchema, {
    status: 201,
    description: '받을어음 수취·지급어음 발행(전표 자동 전기, createEntry=false 면 대장만)',
  })
  register(@ZodBody(NoteRegisterSchema) body: NoteRegisterInput) {
    return this.notes.register(body);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/settle')
  @HttpCode(200)
  @ZodResponse(NoteDetailSchema, { description: '만기 결제' })
  settle(@UuidParam('id') id: string, @ZodBody(NoteSettleSchema) body: NoteSettleInput) {
    return this.notes.settle(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/discount')
  @HttpCode(200)
  @ZodResponse(NoteDetailSchema, { description: '받을어음 할인(할인료는 매출채권처분손실)' })
  discount(@UuidParam('id') id: string, @ZodBody(NoteDiscountSchema) body: NoteDiscountInput) {
    return this.notes.discount(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/endorse')
  @HttpCode(200)
  @ZodResponse(NoteDetailSchema, { description: '받을어음 배서양도' })
  endorse(@UuidParam('id') id: string, @ZodBody(NoteEndorseSchema) body: NoteEndorseInput) {
    return this.notes.endorse(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/dishonor')
  @HttpCode(200)
  @ZodResponse(NoteDetailSchema, { description: '받을어음 부도(부도어음과수표로 대체)' })
  dishonor(@UuidParam('id') id: string, @ZodBody(NoteDishonorSchema) body: NoteDishonorInput) {
    return this.notes.dishonor(id, body);
  }

  @RequirePermission('accounting', 'write')
  @Post(':id/undo')
  @HttpCode(200)
  @ZodResponse(NoteUndoResultSchema, {
    description: '마지막 처리 취소(역분개). 등록만 남았으면 어음을 지운다',
  })
  undo(@UuidParam('id') id: string) {
    return this.notes.undo(id);
  }
}
