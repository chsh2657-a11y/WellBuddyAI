import ExcelJS from 'exceljs';

/**
 * 엑셀(xlsx)·CSV 파일을 2차원 문자열 배열로 읽는다.
 * 국내 은행·카드사·홈택스 CSV 는 EUC-KR(CP949)인 경우가 많아 UTF-8 이 아니면 EUC-KR 로 해석한다.
 */
export type Table = string[][];

export class TabularParseError extends Error {}

export async function parseTabular(buffer: Buffer, filename: string): Promise<Table> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCsv(decodeText(buffer));
  if (lower.endsWith('.xlsx')) return parseXlsx(buffer);
  if (lower.endsWith('.xls')) {
    throw new TabularParseError(
      '예전 엑셀 형식(.xls)은 지원하지 않습니다. .xlsx 로 다시 저장해 주세요.',
    );
  }
  throw new TabularParseError('엑셀(.xlsx) 또는 CSV 파일만 올릴 수 있습니다.');
}

export function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

/** RFC 4180 CSV(따옴표 안의 쉼표·줄바꿈·"" 이스케이프 지원) */
export function parseCsv(text: string): Table {
  const rows: Table = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function parseXlsx(buffer: Buffer): Promise<Table> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new TabularParseError(
      '엑셀 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.',
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: Table = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const values: string[] = [];
    for (let c = 1; c <= r.cellCount; c++) values.push(cellText(r.getCell(c)));
    if (values.some((v) => v.trim() !== '')) rows.push(values);
  });
  return rows;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return String(v.result ?? '');
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

/** 헤더 행의 라벨로 열 위치를 찾아 행을 객체로 바꾼다(열 순서가 달라도 된다). */
export function mapRows(
  table: Table,
  columns: { key: string; header: string }[],
): { rowNumber: number; values: Record<string, string> }[] {
  const [header, ...body] = table;
  if (!header) return [];
  const normalized = header.map((h) => h.replace(/[\s*]/g, ''));
  const index = new Map(
    columns.map((c) => [c.key, normalized.indexOf(c.header.replace(/[\s*]/g, ''))]),
  );
  return body.map((cells, i) => ({
    rowNumber: i + 2,
    values: Object.fromEntries(
      columns.map((c) => {
        const at = index.get(c.key)!;
        return [c.key, at >= 0 ? (cells[at] ?? '').trim() : ''];
      }),
    ),
  }));
}

export function missingHeaders(table: Table, columns: { header: string; required: boolean }[]) {
  const header = (table[0] ?? []).map((h) => h.replace(/[\s*]/g, ''));
  return columns
    .filter((c) => c.required && !header.includes(c.header.replace(/[\s*]/g, '')))
    .map((c) => c.header);
}

/** 양식·내보내기용 xlsx 생성 */
export async function buildWorkbook(
  sheets: { name: string; columns: { header: string; width?: number }[]; rows: unknown[][] }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WellBuddy ERP';
  for (const s of sheets) {
    const sheet = workbook.addWorksheet(s.name);
    sheet.columns = s.columns.map((c) => ({ header: c.header, width: c.width ?? 18 }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FD' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of s.rows) sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
