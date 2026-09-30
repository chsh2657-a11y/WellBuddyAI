/** PostgreSQL 오류 코드(Drizzle 은 원래 오류를 cause 에 담는다) */
function pgCode(e: unknown): string | undefined {
  return (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
}

/** 고유 제약 위반(23505) */
export function isUniqueViolation(e: unknown): boolean {
  return pgCode(e) === '23505';
}

/** 외래키 위반(23503) — 다른 데이터가 참조 중이라 삭제할 수 없음 */
export function isForeignKeyViolation(e: unknown): boolean {
  return pgCode(e) === '23503';
}
