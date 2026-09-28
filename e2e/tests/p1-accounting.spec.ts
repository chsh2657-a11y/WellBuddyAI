import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('회계 기초정보: 표준 계정과목 확인, 거래처·부서 등록', async ({ page }) => {
  await signupWithCompany(page, 'p1', '회계상사');
  await page.getByRole('link', { name: '회계' }).click();
  await expect(page).toHaveURL(/\/accounting\/accounts/);
  await expect(page.getByRole('cell', { name: '외상매출금', exact: true })).toBeVisible();
  await page.getByLabel('계정 검색').fill('복리');
  await expect(page.getByRole('cell', { name: '복리후생비', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '외상매출금', exact: true })).toHaveCount(0);
  await snap(page, 'p1-01-accounts');

  await page.getByRole('link', { name: '거래처' }).click();
  await page.getByRole('button', { name: '거래처 추가' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('거래처명').fill('(주)한빛상사');
  await dialog.getByLabel('사업자등록번호').fill('220-81-12341');
  await dialog.getByLabel('계좌번호').fill('123456-01-234567');
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('거래처를 추가했습니다.')).toBeVisible();
  await expect(page.getByRole('cell', { name: '(주)한빛상사', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '220-81-12341' })).toBeVisible();
  await snap(page, 'p1-02-partners');

  await page.getByRole('link', { name: '부서·프로젝트' }).click();
  await page.getByLabel('부서 코드').fill('D10');
  await page.getByLabel('부서 이름').fill('영업팀');
  await page.getByRole('button', { name: '추가' }).first().click();
  await expect(page.getByRole('cell', { name: '영업팀', exact: true })).toBeVisible();
});
