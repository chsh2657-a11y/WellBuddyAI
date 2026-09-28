import { MEMBER_STATUSES, PERMISSION_KEYS, PermissionLevelSchema, ROLES } from '@wellbuddy/shared';
import { z } from 'zod';

const permissionMap = z.object(
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, PermissionLevelSchema])) as Record<
    (typeof PERMISSION_KEYS)[number],
    typeof PermissionLevelSchema
  >,
);

export const RolePermissionsSchema = z.object({
  role: z.enum(ROLES),
  editable: z.boolean(),
  overridden: z.boolean(),
  permissions: permissionMap,
});

export const UpdateRolePermissionsSchema = z.object({
  permissions: permissionMap.partial(),
});

export const RoleParamSchema = z.enum(ROLES);

export const MemberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  status: z.enum(MEMBER_STATUSES),
  createdAt: z.iso.datetime(),
  isMe: z.boolean(),
});

export const UpdateMemberSchema = z
  .object({ role: z.enum(ROLES).optional(), status: z.enum(MEMBER_STATUSES).optional() })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    error: '변경할 역할 또는 상태를 지정해 주세요.',
  });
