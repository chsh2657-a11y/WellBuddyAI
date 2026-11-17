import { describe, expect, it } from 'vitest';
import { AccountInputSchema, PartnerInputSchema, ProjectInputSchema } from './accounting.js';

describe('거래처 입력', () => {
  it('빈 칸은 null 로 바꾸고, 코드를 비우면 자동 부여 대상(null)이 된다', () => {
    const parsed = PartnerInputSchema.parse({
      code: '',
      name: ' 한빛 ',
      bizRegNo: '',
      email: '',
      bankAccount: '',
      phone: '  ',
    });
    expect(parsed).toMatchObject({
      code: null,
      name: '한빛',
      kind: 'both',
      bizRegNo: null,
      email: null,
      bankAccount: null,
      phone: null,
    });
  });

  it('형식이 틀린 값은 거부한다', () => {
    const result = PartnerInputSchema.safeParse({
      name: 'x',
      bizRegNo: '123-45-67890',
      email: 'bad',
      bankAccount: 'abc',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual([
      'bankAccount',
      'bizRegNo',
      'email',
    ]);
  });
});

describe('계정과목·프로젝트 입력', () => {
  it('계정코드는 숫자 3~5자리', () => {
    expect(AccountInputSchema.safeParse({ code: '849', name: 'a', group: 'sga' }).success).toBe(
      true,
    );
    expect(AccountInputSchema.safeParse({ code: '84', name: 'a', group: 'sga' }).success).toBe(
      false,
    );
    expect(AccountInputSchema.safeParse({ code: '849', name: 'a', group: 'nope' }).success).toBe(
      false,
    );
  });

  it('프로젝트 종료일은 시작일 이후', () => {
    expect(
      ProjectInputSchema.safeParse({
        code: 'P1',
        name: 'a',
        startDate: '2026-02-01',
        endDate: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(
      ProjectInputSchema.parse({ code: 'P1', name: 'a', startDate: '', endDate: '' }),
    ).toMatchObject({
      startDate: null,
      endDate: null,
    });
  });
});
