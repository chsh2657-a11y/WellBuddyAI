import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('증빙: 은행 계좌·법인카드 등록(번호는 끝 4자리만 표시)', async ({ page }) => {
  await signupWithCompany(page, 'p2-sources', '수집상사');
  await page.getByRole('link', { name: '증빙·자동분개' }).click();
  await expect(page).toHaveURL(/\/evidence\/sources/);

  await page.getByLabel('은행', { exact: true }).selectOption({ label: '신한은행' });
  await page.getByLabel('계좌 별칭').fill('운영자금');
  await page.getByLabel('계좌번호').fill('110-123-456789');
  await expect(page.getByRole('combobox', { name: '계좌 장부 계정' })).toHaveValue('103 보통예금');
  await page.getByRole('button', { name: '계좌 등록' }).click();
  await expect(page.getByText('신한은행 ****6789 계좌를 등록했습니다.')).toBeVisible();
  await expect(page.getByRole('row', { name: /운영자금/ })).toContainText('****6789');
  await expect(page.getByText('456789', { exact: true })).toHaveCount(0);

  await page.getByLabel('카드사').selectOption({ label: '삼성카드' });
  await page.getByLabel('카드 별칭').fill('대표 카드');
  await page.getByLabel('카드번호').fill('5310-1234-5678-4321');
  await page.getByLabel('사용자').fill('김대표');
  await expect(page.getByRole('combobox', { name: '카드대금 계정' })).toHaveValue('253 미지급금');
  await page.getByRole('button', { name: '카드 등록' }).click();
  await expect(page.getByText('삼성카드 ****4321 카드를 등록했습니다.')).toBeVisible();
  const card = page.getByRole('row', { name: /대표 카드/ });
  await expect(card).toContainText('김대표');
  await snap(page, 'p2-01-sources');

  // 사용 중지
  await page.getByRole('switch', { name: '대표 카드 사용' }).click();
  await expect(page.getByRole('switch', { name: '대표 카드 사용' })).not.toBeChecked();
});
