import type { PermissionKey } from '@wellbuddy/shared';
import type { z } from 'zod';

export interface ImportColumn {
  key: string;
  header: string;
  required: boolean;
  example?: string;
  help?: string;
  width?: number;
}

/**
 * 엑셀 일괄 등록·내보내기 대상 하나(사업장, 거래처, 품목, 사원 …).
 * 기능 모듈이 ImportRegistry 에 등록하면 공통 API·화면(양식 다운로드 → 미리보기 → 등록)을 그대로 쓴다.
 */
export interface ImportSpec<T = unknown> {
  key: string;
  label: string;
  /** 양식·내보내기는 read, 미리보기·등록은 write 권한이 필요하다 */
  permission: PermissionKey;
  columns: ImportColumn[];
  rowSchema: z.ZodType<T>;
  /** 파일 안에서 같은 값이면 중복으로 본다(예: 사업자등록번호) */
  uniqueBy?: (row: T) => string;
  commit(rows: T[]): Promise<{ created: number; updated: number }>;
  exportRows?(): Promise<Record<string, unknown>[]>;
}
