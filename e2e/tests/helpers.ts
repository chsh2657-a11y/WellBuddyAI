import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'abcd1234';

export async function snap(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
}

/** 새 사용자로 가입하고 회사를 만든 뒤 대시보드까지 들어간다. */
export async function signupWithCompany(page: Page, prefix: string, company: string) {
  const email = `${prefix}-${Date.now()}@wellbuddy.test`;
  await page.goto('/signup');
  await page.getByLabel('이름').fill('김경리');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/company/);
  await page.getByLabel('회사명').fill(company);
  await page.getByLabel('사업자등록번호').fill('124-81-00998');
  await page.getByRole('button', { name: '회사 만들고 시작하기' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}
