import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** 설정 > 연동관리에서 채널을 모의 데이터로 켠다 */
async function useMock(page: Page, key: string, label: string) {
  const card = page.getByTestId(`integration-${key}`);
  await card.getByLabel('연동 방식').selectOption('mock');
  await card.getByRole('switch', { name: `${label} 사용` }).click();
  await card.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(`${label} 연동 설정을 저장했습니다.`)).toBeVisible();
  await expect(card.getByText('사용 중')).toBeVisible();
}

test('증빙: 모의 데이터로 통장·카드·홈택스를 수집하고, 다시 수집하면 중복으로 건너뛴다', async ({
  page,
}) => {
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '증빙 메뉴' }).getByRole('link', { name, exact: true });
  await signupWithCompany(page, 'p2-collect', '모의수집상사');

  await page.goto('/settings/integrations');
  await useMock(page, 'bank', '은행 입출금');
  await useMock(page, 'card', '법인카드');
  await useMock(page, 'hometax', '홈택스 증빙');

  await page.getByRole('link', { name: '증빙·자동분개' }).click();
  await expect(page).toHaveURL(/\/evidence\/review/);
  await tab('자동 수집').click();
  await expect(page).toHaveURL(/\/evidence\/collect/);
  // 계좌가 없으면 수집하지 않는다
  await page.getByRole('button', { name: '통장 지금 수집' }).click();
  await expect(page.getByText('사용 중인 계좌가 없습니다.', { exact: false })).toBeVisible();

  await tab('계좌·카드').click();
  await expect(page).toHaveURL(/\/evidence\/sources/);
  await page.getByLabel('계좌 별칭').fill('운영자금');
  await page.getByLabel('계좌번호').fill('123456-01-234567');
  await page.getByRole('button', { name: '계좌 등록' }).click();
  await expect(page.getByText('국민은행 ****4567 계좌를 등록했습니다.')).toBeVisible();
  await page.getByLabel('카드 별칭').fill('대표 카드');
  await page.getByLabel('카드번호').fill('5310-1234-5678-4321');
  await page.getByRole('button', { name: '카드 등록' }).click();
  await expect(page.getByText('****4321 카드를 등록했습니다.', { exact: false })).toBeVisible();

  await tab('자동 수집').click();
  await expect(page).toHaveURL(/\/evidence\/collect/);
  const bankCard = page.getByTestId('collect-bank');
  await expect(bankCard).toContainText('모의 데이터');
  await page.getByRole('button', { name: '통장 지금 수집' }).click();
  await expect(page.getByText(/^통장: 새로 [1-9]\d*건, 중복 0건$/)).toBeVisible();
  await expect(bankCard).toContainText('계좌 1개');
  await page.getByRole('button', { name: '통장 지금 수집' }).click();
  await expect(page.getByText(/^통장: 새로 0건, 중복 [1-9]\d*건$/)).toBeVisible();

  await page.getByRole('button', { name: '법인카드 지금 수집' }).click();
  await expect(page.getByText(/^법인카드: 새로 \d+건, 중복 0건$/)).toBeVisible();
  await page.getByRole('button', { name: '홈택스 지금 수집' }).click();
  await expect(page.getByText(/^홈택스: 새로 [1-9]\d*건, 중복 0건$/)).toBeVisible();
  await expect(page.getByTestId('collect-hometax')).toContainText('세금계산서');

  const runs = page.getByRole('table', { name: '수집 이력' });
  await expect(runs.locator('tbody tr')).toHaveCount(4);
  await expect(runs.locator('tbody tr').first()).toContainText('모의 · 수동');
  await snap(page, 'p2-09-collect');

  // 수집 내역: 통장 거래와 임대료 세금계산서(매월 5일)
  await tab('수집 내역').click();
  await expect(page).toHaveURL(/\/evidence\/records/);
  const bank = page.getByRole('table', { name: '통장 거래' });
  await expect(bank.locator('tbody tr').first()).toContainText('운영자금');
  await page.getByRole('button', { name: '세금계산서' }).click();
  const invoices = page.getByRole('table', { name: '세금계산서' });
  await expect(invoices.getByRole('row', { name: /\(주\)강남빌딩/ }).first()).toContainText('매입');
});
