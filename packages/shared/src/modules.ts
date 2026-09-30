import { z } from 'zod';

/**
 * 업무 모듈(사이드 메뉴 최상위). 회사는 설정 > 메뉴 사용 여부에서 모듈을 켜고 끌 수 있다.
 * phase 는 개발 체크리스트 단계이며, available 이 false 인 모듈은 "준비 중"으로 표시한다.
 */
export const MODULES = [
  { key: 'dashboard', label: '대시보드', phase: 'P0', available: true, required: true },
  { key: 'accounting', label: '회계', phase: 'P1', available: true, required: false },
  { key: 'evidence', label: '증빙·자동분개', phase: 'P2', available: true, required: false },
  { key: 'sales', label: '영업·구매·재고', phase: 'P3', available: false, required: false },
  { key: 'production', label: '생산', phase: 'P4', available: false, required: false },
  { key: 'approval', label: '전자결재', phase: 'P5', available: false, required: false },
  { key: 'hr', label: '인사·그룹웨어', phase: 'P5', available: false, required: false },
  { key: 'attendance', label: '근태', phase: 'P6', available: false, required: false },
  { key: 'payroll', label: '급여', phase: 'P7', available: false, required: false },
  { key: 'tax', label: '부가세·결산', phase: 'P8', available: false, required: false },
  { key: 'settings', label: '설정', phase: 'P0', available: true, required: true },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

/** 회사 설정(enabledModules)에 값이 없으면 모든 모듈을 켠 것으로 본다. 필수 모듈은 끌 수 없다. */
export function isModuleEnabled(
  key: ModuleKey,
  enabledModules: Partial<Record<string, boolean>> | null | undefined,
): boolean {
  const mod = MODULES.find((m) => m.key === key);
  if (!mod) return false;
  if (mod.required) return true;
  return enabledModules?.[key] ?? true;
}

export const UpdateModulesSchema = z.object({
  enabledModules: z.record(z.string(), z.boolean()),
});
export type UpdateModulesInput = z.infer<typeof UpdateModulesSchema>;
