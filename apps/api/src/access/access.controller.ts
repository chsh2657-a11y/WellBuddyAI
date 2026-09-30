import { Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Role } from '@wellbuddy/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { UuidParam, ZodBody, ZodResponse, ZodValidationPipe } from '../common/zod.js';
import {
  MemberSchema,
  RoleParamSchema,
  RolePermissionsSchema,
  UpdateMemberSchema,
  UpdateRolePermissionsSchema,
} from './access.schemas.js';
import { AccessService } from './access.service.js';

@ApiTags('access')
@Controller()
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @RequirePermission('settings.users', 'read')
  @Get('roles')
  @ZodResponse(z.array(RolePermissionsSchema), { description: '역할별 권한 매트릭스' })
  roles() {
    return this.access.listRoles();
  }

  @RequirePermission('settings.users', 'write')
  @Put('roles/:role/permissions')
  @ZodResponse(RolePermissionsSchema)
  updateRole(
    @Param('role', new ZodValidationPipe(RoleParamSchema)) role: Role,
    @ZodBody(UpdateRolePermissionsSchema) body: z.infer<typeof UpdateRolePermissionsSchema>,
  ) {
    return this.access.updateRole(role, body.permissions);
  }

  @RequirePermission('settings.users', 'read')
  @Get('members')
  @ZodResponse(z.array(MemberSchema))
  members() {
    return this.access.listMembers();
  }

  @RequirePermission('settings.users', 'write')
  @Patch('members/:id')
  @ZodResponse(MemberSchema.pick({ id: true, role: true, status: true }))
  async updateMember(
    @UuidParam('id') id: string,
    @ZodBody(UpdateMemberSchema) body: z.infer<typeof UpdateMemberSchema>,
  ) {
    return this.access.updateMember(id, body);
  }
}
