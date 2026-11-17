import { z } from 'zod';

export const AuthResultSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), name: z.string() }),
  companyId: z.uuid().nullable(),
  /** x-auth-mode: token 요청(모바일)에서만 포함 */
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
});

export const RefreshBodySchema = z
  .object({ refreshToken: z.string().min(10).optional() })
  .optional()
  .default({});

export const OkSchema = z.object({ ok: z.literal(true) });
