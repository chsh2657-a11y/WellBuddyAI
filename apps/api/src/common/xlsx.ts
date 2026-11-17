import ExcelJS from 'exceljs';
import type { Response } from 'express';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** xlsx 파일을 내려보낸다(한글 파일 이름은 RFC 5987 로 인코딩) */
export function sendXlsx(res: Response, filename: string, buffer: Buffer) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="download.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(buffer);
}

export interface ReportTable {
  title: string;
  /** 회사명·기간 등 제목 아래 한 줄 */
  subtitle?: string | null;
  columns: { header: string; type?: 'text' | 'won'; width?: number }[];
  rows: (string | number | null)[][];
  /** 굵게 표시할 행 번호(합계·소계) */
  boldRows?: number[];
}

/** 화면의 보고서 표를 그대로 엑셀로 만든다(금액 열은 천 단위 쉼표 서식) */
export async function buildReportWorkbook(table: ReportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WellBuddy ERP';
  const sheet = workbook.addWorksheet(table.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
  const width = table.columns.length;
  sheet.addRow([table.title]).font = { bold: true, size: 14 };
  sheet.mergeCells(1, 1, 1, width);
  sheet.addRow([table.subtitle ?? '']).font = { color: { argb: 'FF666666' } };
  sheet.mergeCells(2, 1, 2, width);
  const header = sheet.addRow(table.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FD' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  table.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = c.width ?? (c.type === 'won' ? 16 : 18);
    if (c.type === 'won') column.numFmt = '#,##0;-#,##0;""';
  });
  const bold = new Set(table.boldRows ?? []);
  table.rows.forEach((row, i) => {
    const added = sheet.addRow(row.slice(0, width));
    if (bold.has(i)) added.font = { bold: true };
  });
  sheet.views = [{ state: 'frozen', ySplit: 3 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
