import { isWon } from './money.js';

/** 분개 한 줄: 차변 또는 대변 중 한쪽에만 금액이 있어야 한다. */
export interface JournalLineInput {
  debit: number;
  credit: number;
}

export interface JournalIssue {
  /** 0부터 시작하는 줄 번호(전표 전체 문제면 null) */
  line: number | null;
  code:
    | 'TOO_FEW_LINES'
    | 'INVALID_AMOUNT'
    | 'NEGATIVE_AMOUNT'
    | 'BOTH_SIDES'
    | 'ZERO_LINE'
    | 'UNBALANCED';
  message: string;
}

export interface JournalTotals {
  debit: number;
  credit: number;
  difference: number;
}

export function journalTotals(lines: readonly JournalLineInput[]): JournalTotals {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += isWon(l.debit) ? l.debit : 0;
    credit += isWon(l.credit) ? l.credit : 0;
  }
  return { debit, credit, difference: debit - credit };
}

/**
 * 복식부기 규칙 검사.
 * - 2줄 이상
 * - 줄마다 차변·대변 중 한쪽에만 0 보다 큰 원 단위 정수
 * - 차변 합계 = 대변 합계
 */
export function validateJournal(lines: readonly JournalLineInput[]): JournalIssue[] {
  const issues: JournalIssue[] = [];
  if (lines.length < 2) {
    issues.push({ line: null, code: 'TOO_FEW_LINES', message: '분개는 2줄 이상이어야 합니다.' });
  }
  lines.forEach((l, i) => {
    if (!isWon(l.debit) || !isWon(l.credit)) {
      issues.push({
        line: i,
        code: 'INVALID_AMOUNT',
        message: `${i + 1}행: 금액은 원 단위 정수여야 합니다.`,
      });
      return;
    }
    if (l.debit < 0 || l.credit < 0) {
      issues.push({
        line: i,
        code: 'NEGATIVE_AMOUNT',
        message: `${i + 1}행: 금액은 0 이상이어야 합니다.`,
      });
    } else if (l.debit > 0 && l.credit > 0) {
      issues.push({
        line: i,
        code: 'BOTH_SIDES',
        message: `${i + 1}행: 차변과 대변 중 한쪽만 입력해 주세요.`,
      });
    } else if (l.debit === 0 && l.credit === 0) {
      issues.push({ line: i, code: 'ZERO_LINE', message: `${i + 1}행: 금액을 입력해 주세요.` });
    }
  });
  const totals = journalTotals(lines);
  if (issues.length === 0 && totals.difference !== 0) {
    issues.push({
      line: null,
      code: 'UNBALANCED',
      message: `차변 합계와 대변 합계가 ${Math.abs(totals.difference).toLocaleString('ko-KR')}원 다릅니다.`,
    });
  }
  return issues;
}

/** 역분개: 차변과 대변을 서로 바꾼다. */
export function reverseLines<T extends JournalLineInput>(lines: readonly T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}
