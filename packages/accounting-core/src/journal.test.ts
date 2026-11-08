import { describe, expect, it } from 'vitest';
import { journalTotals, reverseLines, validateJournal } from './journal.js';

describe('복식부기 대차 검증', () => {
  it('차변 합계와 대변 합계가 같으면 통과한다', () => {
    expect(
      validateJournal([
        { debit: 110_000, credit: 0 },
        { debit: 0, credit: 100_000 },
        { debit: 0, credit: 10_000 },
      ]),
    ).toEqual([]);
  });

  it('대차가 다르면 차액을 알려준다', () => {
    const issues = validateJournal([
      { debit: 10_000, credit: 0 },
      { debit: 0, credit: 9_000 },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'UNBALANCED', line: null });
    expect(issues[0]!.message).toContain('1,000원');
  });

  it('줄 단위 오류(한쪽만 입력, 0원, 음수, 소수)를 찾는다', () => {
    const codes = validateJournal([
      { debit: 100, credit: 100 },
      { debit: 0, credit: 0 },
      { debit: -5, credit: 0 },
      { debit: 1.5, credit: 0 },
    ]).map((i) => [i.line, i.code]);
    expect(codes).toEqual([
      [0, 'BOTH_SIDES'],
      [1, 'ZERO_LINE'],
      [2, 'NEGATIVE_AMOUNT'],
      [3, 'INVALID_AMOUNT'],
    ]);
  });

  it('한 줄짜리 분개는 거부한다', () => {
    expect(validateJournal([{ debit: 100, credit: 0 }]).map((i) => i.code)).toContain(
      'TOO_FEW_LINES',
    );
  });

  it('합계와 역분개', () => {
    const lines = [
      { debit: 300, credit: 0, memo: 'a' },
      { debit: 0, credit: 300, memo: 'b' },
    ];
    expect(journalTotals(lines)).toEqual({ debit: 300, credit: 300, difference: 0 });
    expect(reverseLines(lines)).toEqual([
      { debit: 0, credit: 300, memo: 'a' },
      { debit: 300, credit: 0, memo: 'b' },
    ]);
  });
});
