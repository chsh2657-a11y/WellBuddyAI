import { describe, expect, it } from 'vitest';
import {
  columnChoices,
  columnLetter,
  formatCell,
  parseWonInput,
  receiptUploadSummary,
  rowLabel,
} from './evidence-format';

describe('증빙 화면 표시 도우미', () => {
  it('엑셀 열 이름', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });

  it('머리글 줄 이름은 앞 네 칸만 보여 준다', () => {
    expect(rowLabel(['거래일시', '', '적요', '출금', '입금', '잔액'], 1)).toBe(
      '2행 · 거래일시 · 적요 · 출금 · 입금 …',
    );
    expect(rowLabel(['KB국민은행 거래내역'], 0)).toBe('1행 · KB국민은행 거래내역');
    expect(rowLabel(['', ' '], 2)).toBe('3행 (빈 줄)');
  });

  it('열 목록은 가장 넓은 줄 기준이고 머리글이 비면 표시한다', () => {
    const rows = [['제목'], ['일자', '', '금액'], ['2026-03-01', '메모', '1,000', '초과']];
    expect(columnChoices(rows, 1)).toEqual([
      { index: 0, label: 'A열 · 일자' },
      { index: 1, label: 'B열 · (빈 머리글)' },
      { index: 2, label: 'C열 · 금액' },
      { index: 3, label: 'D열 · (빈 머리글)' },
    ]);
    expect(columnChoices([], 0)).toEqual([]);
  });

  it('값 표시', () => {
    expect(formatCell(1_100_000, 'won')).toBe('1,100,000');
    expect(formatCell(true, 'bool')).toBe('예');
    expect(formatCell(false, 'bool')).toBe('');
    expect(formatCell('purchase', 'direction')).toBe('매입');
    expect(formatCell('exempt', 'invoiceKind')).toBe('면세');
    expect(formatCell('expense_proof', 'usage')).toBe('지출증빙');
    expect(formatCell(null)).toBe('');
    expect(formatCell(3)).toBe('3');
  });

  it('금액 입력을 읽는다', () => {
    expect(parseWonInput(' 12,000원 ')).toBe(12_000);
    expect(parseWonInput('₩3300')).toBe(3_300);
    expect(parseWonInput('')).toBeNull();
    expect(parseWonInput('12.5')).toBeNaN();
    expect(parseWonInput('-100')).toBeNaN();
  });

  it('영수증 업로드 요약', () => {
    expect(
      receiptUploadSummary(
        [
          { duplicate: false, status: 'pending' },
          { duplicate: false, status: 'review' },
          { duplicate: true, status: 'matched' },
        ],
        1,
      ),
    ).toBe('영수증 2장을 올렸습니다(검토 필요 1장, 이미 올린 영수증 1장, 실패 1장).');
    expect(receiptUploadSummary([{ duplicate: false, status: 'pending' }], 0)).toBe(
      '영수증 1장을 올렸습니다.',
    );
  });
});
