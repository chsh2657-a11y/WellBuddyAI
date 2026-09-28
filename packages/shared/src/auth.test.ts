import { describe, expect, it } from 'vitest';
import { CreateCompanySchema, LoginSchema, PasswordSchema, SignupSchema } from './auth.js';

describe('비밀번호 정책', () => {
  it('8자 이상, 영문과 숫자를 모두 포함해야 한다', () => {
    expect(PasswordSchema.safeParse('abcd1234').success).toBe(true);
    expect(PasswordSchema.safeParse('abc123').success).toBe(false);
    expect(PasswordSchema.safeParse('abcdefgh').success).toBe(false);
    expect(PasswordSchema.safeParse('12345678').success).toBe(false);
  });
});

describe('가입·로그인 입력', () => {
  it('이메일은 공백 제거 후 소문자로 정규화한다', () => {
    const parsed = SignupSchema.parse({
      email: '  Kim@Example.COM ',
      password: 'abcd1234',
      name: '김',
    });
    expect(parsed.email).toBe('kim@example.com');
    expect(LoginSchema.parse({ email: 'A@B.CO', password: 'x' }).email).toBe('a@b.co');
  });

  it('잘못된 이메일은 한국어 메시지로 거부한다', () => {
    const result = LoginSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('올바른 이메일 주소를 입력해 주세요.');
  });
});

describe('회사 생성 입력', () => {
  it('사업자등록번호를 숫자 10자리로 정규화하고 체크디지트를 검증한다', () => {
    expect(CreateCompanySchema.parse({ name: '웰버디', bizRegNo: '124-81-00998' }).bizRegNo).toBe(
      '1248100998',
    );
    expect(
      CreateCompanySchema.safeParse({ name: '웰버디', bizRegNo: '123-45-67890' }).success,
    ).toBe(false);
  });
});
