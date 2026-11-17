import { HttpStatus, Injectable } from '@nestjs/common';
import { hasPermission, type PermissionLevel } from '@wellbuddy/shared';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { currentContext } from '../common/request-context.js';
import type { ImportSpec } from './import-spec.js';
import { ImportRegistry } from './import-registry.js';
import {
  buildWorkbook,
  mapRows,
  missingHeaders,
  parseTabular,
  TabularParseError,
} from './tabular.js';

export const MAX_IMPORT_ROWS = 5000;
const PREVIEW_ROWS = 1000;

export interface PreviewRow {
  rowNumber: number;
  values: Record<string, string>;
  errors: { field: string; message: string }[];
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly registry: ImportRegistry,
    private readonly audit: AuditService,
  ) {}

  spec(key: string, level: PermissionLevel): ImportSpec<unknown> {
    const spec = this.registry.get(key);
    if (!hasPermission(currentContext()?.permissions, spec.permission, level)) {
      throw new AppException('FORBIDDEN', '이 작업을 할 권한이 없습니다.', HttpStatus.FORBIDDEN, {
        permission: spec.permission,
        level,
      });
    }
    return spec;
  }

  async template(spec: ImportSpec<unknown>): Promise<Buffer> {
    return buildWorkbook([
      {
        name: spec.label,
        columns: spec.columns.map((c) => ({
          header: c.required ? `${c.header} *` : c.header,
          width: c.width,
        })),
        rows: [spec.columns.map((c) => c.example ?? '')],
      },
      {
        name: '작성 안내',
        columns: [
          { header: '항목', width: 20 },
          { header: '필수', width: 8 },
          { header: '설명', width: 60 },
        ],
        rows: [
          ...spec.columns.map((c) => [c.header, c.required ? '필수' : '', c.help ?? '']),
          [],
          ['※ 첫 번째 시트의 2행 예시는 지우고 입력해 주세요. 열 순서는 바꿔도 됩니다.'],
        ],
      },
    ]);
  }

  async preview(spec: ImportSpec<unknown>, file: { buffer: Buffer; originalname: string }) {
    const { rows, missing } = await this.validate(spec, file);
    const invalid = rows.filter((r) => r.errors.length > 0).length;
    return {
      total: rows.length,
      valid: rows.length - invalid,
      invalid,
      missingHeaders: missing,
      rows: rows
        .slice(0, PREVIEW_ROWS)
        .map(({ rowNumber, values, errors }) => ({ rowNumber, values, errors })),
    };
  }

  async commit(
    spec: ImportSpec<unknown>,
    file: { buffer: Buffer; originalname: string },
    skipInvalid: boolean,
  ) {
    const { rows, missing } = await this.validate(spec, file);
    const invalid = rows.filter((r) => r.errors.length > 0);
    if (missing.length > 0 || (invalid.length > 0 && !skipInvalid)) {
      throw new AppException(
        'IMPORT_INVALID',
        '오류가 있는 행이 있어 등록하지 않았습니다.',
        HttpStatus.BAD_REQUEST,
        {
          missingHeaders: missing,
          invalidRows: invalid
            .slice(0, 50)
            .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
        },
      );
    }
    const valid = rows.filter((r) => r.errors.length === 0).map((r) => r.parsed);
    const result = valid.length > 0 ? await spec.commit(valid) : { created: 0, updated: 0 };
    await this.audit.record({
      action: 'import.commit',
      entity: spec.key,
      after: { file: file.originalname, ...result, skipped: invalid.length },
    });
    return { ...result, skipped: invalid.length };
  }

  async exportFile(spec: ImportSpec<unknown>): Promise<Buffer> {
    if (!spec.exportRows)
      throw new AppException('EXPORT_UNSUPPORTED', '내보내기를 지원하지 않습니다.');
    const data = await spec.exportRows();
    return buildWorkbook([
      {
        name: spec.label,
        columns: spec.columns.map((c) => ({ header: c.header, width: c.width })),
        rows: data.map((d) => spec.columns.map((c) => d[c.key] ?? '')),
      },
    ]);
  }

  private async validate(
    spec: ImportSpec<unknown>,
    file: { buffer: Buffer; originalname: string },
  ) {
    let table;
    try {
      table = await parseTabular(file.buffer, file.originalname);
    } catch (e) {
      if (e instanceof TabularParseError) throw new AppException('IMPORT_UNREADABLE', e.message);
      throw e;
    }
    const missing = missingHeaders(table, spec.columns);
    const mapped = mapRows(table, spec.columns);
    if (mapped.length > MAX_IMPORT_ROWS) {
      throw new AppException(
        'IMPORT_TOO_LARGE',
        `한 번에 ${MAX_IMPORT_ROWS.toLocaleString()}행까지 올릴 수 있습니다.`,
      );
    }

    const seen = new Map<string, number>();
    const rows = mapped.map(({ rowNumber, values }) => {
      const input = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, v === '' ? undefined : v]),
      );
      const result = spec.rowSchema.safeParse(input);
      const errors: PreviewRow['errors'] = result.success
        ? []
        : result.error.issues.map((i) => ({
            field: spec.columns.find((c) => c.key === i.path[0])?.header ?? String(i.path[0] ?? ''),
            message: i.message.includes('expected') ? '값을 입력해 주세요.' : i.message,
          }));
      if (result.success && spec.uniqueBy) {
        const key = spec.uniqueBy(result.data);
        const first = seen.get(key);
        if (first) errors.push({ field: '', message: `${first}행과 중복됩니다.` });
        else seen.set(key, rowNumber);
      }
      return { rowNumber, values, errors, parsed: result.success ? result.data : undefined };
    });
    return { rows, missing };
  }
}
