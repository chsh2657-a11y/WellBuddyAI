import { z } from 'zod';
import { isValidBizRegNo, normalizeBizRegNo } from './biz-reg-no.js';
import { ROLES } from './roles.js';

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: '올바른 이메일 주소를 입력해 주세요.' }));

/** 비밀번호 정책: 8~72자, 영문과 숫자를 모두 포함 */
export const PasswordSchema = z
  .string()
  .min(8, { error: '비밀번호는 8자 이상이어야 합니다.' })
  .max(72, { error: '비밀번호는 72자 이하여야 합니다.' })
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
    error: '비밀번호에는 영문과 숫자가 모두 들어가야 합니다.',
  });

export const SignupSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().trim().min(1, { error: '이름을 입력해 주세요.' }).max(50),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, { error: '비밀번호를 입력해 주세요.' }),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const BizRegNoSchema = z
  .string()
  .trim()
  .transform(normalizeBizRegNo)
  .refine(isValidBizRegNo, { error: '올바른 사업자등록번호가 아닙니다.' });

export const CreateCompanySchema = z.object({
  name: z.string().trim().min(1, { error: '회사명을 입력해 주세요.' }).max(100),
  bizRegNo: BizRegNoSchema,
  representative: z.string().trim().max(50).optional(),
  businessType: z.string().trim().max(50).optional(),
  businessItem: z.string().trim().max(100).optional(),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

export const SwitchCompanySchema = z.object({ companyId: z.uuid() });

export const PermissionLevelSchema = z.enum(['none', 'read', 'write']);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

/** 로그인한 사용자의 현재 세션(GET /auth/me) */
export const SessionSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), name: z.string() }),
  company: z.object({ id: z.uuid(), name: z.string(), bizRegNo: z.string() }).nullable(),
  role: z.enum(ROLES).nullable(),
  companies: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.enum(ROLES) })),
  permissions: z.record(z.string(), PermissionLevelSchema),
  enabledModules: z.record(z.string(), z.boolean()),
});
export type Session = z.infer<typeof SessionSchema>;
