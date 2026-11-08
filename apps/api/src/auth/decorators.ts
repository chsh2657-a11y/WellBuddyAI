import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiForbiddenResponse } from '@nestjs/swagger';
import type { PermissionKey, PermissionLevel } from '@wellbuddy/shared';

export const IS_PUBLIC = 'wellbuddy:public';
export const ALLOW_NO_COMPANY = 'wellbuddy:allow-no-company';
export const REQUIRED_PERMISSION = 'wellbuddy:required-permission';

/** 로그인 없이 호출할 수 있는 엔드포인트 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** 로그인은 필요하지만 회사를 아직 선택하지 않아도 되는 엔드포인트(회사 생성·전환 등) */
export const AllowNoCompany = () => SetMetadata(ALLOW_NO_COMPANY, true);

export interface RequiredPermission {
  key: PermissionKey;
  level: PermissionLevel;
}

/** 메뉴·기능 권한 검사. 조회는 'read', 등록·수정·삭제는 'write' 를 요구한다. */
export function RequirePermission(key: PermissionKey, level: PermissionLevel = 'read') {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSION, { key, level } satisfies RequiredPermission),
    ApiCookieAuth('wb_at'),
    ApiBearerAuth(),
    ApiForbiddenResponse({ description: `권한 필요: ${key} (${level})` }),
  );
}
