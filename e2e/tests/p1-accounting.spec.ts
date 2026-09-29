import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('회계 기초정보: 표준 계정과목 확인, 거래처·부서 등록', async ({ page }) => {
  await signupWithCompany(page, 'p1', '회계상사');
  await page.getByRole('link', { name: '회계' }).click();
  await expect(page).toHaveURL(/\/accounting\/journals\/new/);
  await page.getByRole('link', { name: '계정과목' }).click();
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

test('회계기간: 기초잔액 입력, 월 마감·해제', async ({ page }) => {
  const year = new Date().getFullYear();
  await signupWithCompany(page, 'p1-periods', '기간상사');
  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '회계기간·마감' }).click();
  await expect(page).toHaveURL(/\/accounting\/periods/);
  await expect(page.getByRole('cell', { name: `${year}-12`, exact: true })).toBeVisible();

  // 기초잔액: 차대가 다르면 저장할 수 없다
  await page.getByLabel('1행 계정과목').selectOption({ label: '101 현금' });
  await page.getByLabel('1행 차변').fill('5000000');
  await page.getByLabel('2행 계정과목').selectOption({ label: '331 자본금' });
  await page.getByLabel('2행 대변').fill('4,000,000');
  await expect(page.getByText('차액 1,000,000원')).toBeVisible();
  await expect(page.getByRole('button', { name: '기초잔액 저장' })).toBeDisabled();
  await page.getByLabel('2행 대변').fill('5000000');
  await page.getByLabel('2행 대변').blur();
  await expect(page.getByLabel('2행 대변')).toHaveValue('5,000,000');
  await page.getByRole('button', { name: '기초잔액 저장' }).click();
  await expect(page.getByText('기초잔액을 저장했습니다.')).toBeVisible();
  await snap(page, 'p1-03-opening-balances');

  // 1월 마감 → 기초잔액도 잠긴다 → 해제
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: `${year}-01까지 마감` }).click();
  await expect(page.getByText(`${year}-01까지 마감했습니다`)).toBeVisible();
  await expect(page.getByText('첫 달 마감됨')).toBeVisible();
  await expect(page.getByRole('button', { name: '기초잔액 저장' })).toHaveCount(0);
  await snap(page, 'p1-04-period-locked');

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: `${year}-01부터 마감 해제` }).click();
  await expect(page.getByText(`${year}-01부터 마감을 해제했습니다`)).toBeVisible();
  await expect(page.getByRole('button', { name: '기초잔액 저장' })).toBeVisible();
});
