import { normalizeHeader } from './cells.js';

/**
 * 머리글 자동 인식: 필드마다 같은 뜻의 머리글 이름(동의어)을 두고, 파일 앞부분에서 가장 많이 맞는 줄을
 * 머리글로 본다. 사용자가 고른 매핑(필드 → 열 번호)이 있으면 그것을 쓴다.
 */
export type ColumnMapping<F extends string> = Partial<Record<F, number>>;

export interface FieldSpec<F extends string> {
  key: F;
  label: string;
  required: boolean;
  synonyms: string[];
}

export function detectHeader<F extends string>(
  rows: string[][],
  fields: FieldSpec<F>[],
  scanRows = 30,
): { headerRow: number; mapping: ColumnMapping<F> } | null {
  let best: { headerRow: number; mapping: ColumnMapping<F>; score: number } | null = null;
  for (let r = 0; r < Math.min(rows.length, scanRows); r++) {
    const cells = (rows[r] ?? []).map((c) => normalizeHeader(c ?? ''));
    const mapping: ColumnMapping<F> = {};
    const used = new Set<number>();
    for (const f of fields) {
      const wanted = f.synonyms.map(normalizeHeader);
      // 정확히 같은 머리글을 먼저, 없으면 포함하는 머리글
      let idx = cells.findIndex((c, i) => !used.has(i) && wanted.includes(c));
      if (idx < 0)
        idx = cells.findIndex(
          (c, i) => !used.has(i) && c !== '' && wanted.some((w) => c.includes(w)),
        );
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
      }
    }
    const score = Object.keys(mapping).length;
    if (score >= 2 && (!best || score > best.score)) best = { headerRow: r, mapping, score };
  }
  return best ? { headerRow: best.headerRow, mapping: best.mapping } : null;
}

export function missingFields<F extends string>(
  mapping: ColumnMapping<F>,
  fields: FieldSpec<F>[],
  satisfied: (key: F) => boolean = (key) => mapping[key] !== undefined,
): FieldSpec<F>[] {
  return fields.filter((f) => f.required && !satisfied(f.key));
}

export interface ParseIssue {
  /** 파일의 줄 번호(1부터) */
  row: number;
  message: string;
}

export interface ParseResult<T, F extends string> {
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping<F>;
  records: { row: number; record: T }[];
  issues: ParseIssue[];
}
