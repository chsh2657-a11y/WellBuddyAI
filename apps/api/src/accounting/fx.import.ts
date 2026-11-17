import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CURRENCIES } from '@wellbuddy/accounting-core';
import { type ExchangeRateInput, ExchangeRateInputSchema } from '@wellbuddy/shared';
import type { z } from 'zod';
import { ImportRegistry } from '../imports/import-registry.js';
import { FxService } from './fx.service.js';

/** 환율 엑셀 일괄 등록(같은 통화·날짜는 덮어쓴다) */
@Injectable()
export class ExchangeRatesImport implements OnModuleInit {
  constructor(
    private readonly registry: ImportRegistry,
    private readonly fx: FxService,
  ) {}

  onModuleInit() {
    this.registry.register<ExchangeRateInput>({
      key: 'exchange-rates',
      label: '환율',
      permission: 'accounting',
      columns: [
        {
          key: 'currency',
          header: '통화',
          required: true,
          example: 'USD',
          help: CURRENCIES.map((c) => c.code).join(' / '),
        },
        { key: 'rateDate', header: '일자', required: true, example: '2026-12-31', width: 14 },
        {
          key: 'rate',
          header: '환율',
          required: true,
          example: '1385.20',
          help: '엔화·동·루피아는 100 단위당 원',
        },
      ],
      rowSchema: ExchangeRateInputSchema as z.ZodType<ExchangeRateInput>,
      uniqueBy: (row) => `${row.currency}:${row.rateDate}`,
      commit: (rows) => this.fx.upsertRates(rows),
      exportRows: async () =>
        (await this.fx.listRates({})).map((r) => ({
          currency: r.currency,
          rateDate: r.rateDate,
          rate: r.rate,
        })),
    });
  }
}
