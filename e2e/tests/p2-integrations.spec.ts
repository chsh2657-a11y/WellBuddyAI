import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('연동관리: CODEF 자격증명을 저장하면 계정 연결 창이 나오고, 비밀 값은 가려진다', async ({
  page,
}) => {
  await signupWithCompany(page, 'p2-integ', '실연동상사');
  await page.goto('/settings/integrations');

  const bank = page.getByTestId('integration-bank');
  await bank.getByLabel('연동 방식').selectOption('codef');
  // 저장하기 전에는 계정 연결 창이 없다
  await expect(bank.getByRole('form', { name: '은행 입출금 계정 연결' })).toHaveCount(0);
  await bank.getByLabel('Client ID *').fill('client-id-e2e');
  await bank.getByLabel('Client Secret *').fill('client-secret-e2e-9999');
  await bank.getByLabel('RSA 공개키 *').fill('MIIBIjANBgkq-e2e');
  await expect(bank.getByLabel('서버')).toHaveValue('development');
  await bank.getByLabel('서버').selectOption('sandbox');
  await bank.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('은행 입출금 연동 설정을 저장했습니다.')).toBeVisible();

  await expect(bank.getByLabel('서버')).toHaveValue('sandbox');
  await expect(bank.getByText(/저장됨: cl\*+99/)).toBeVisible();
  const connect = bank.getByRole('form', { name: '은행 입출금 계정 연결' });
  await expect(connect).toContainText('연결 안 됨');
  await expect(connect.getByLabel('기관')).toHaveValue('0004');
  const button = connect.getByRole('button', { name: '계정 연결' });
  await expect(button).toBeDisabled();
  await connect.getByLabel('아이디').fill('bizbank');
  await connect.getByLabel('비밀번호').fill('secret');
  await expect(button).toBeEnabled();
  await snap(page, 'p2-10-codef-settings');

  // 홈택스는 기관을 고르지 않는다
  const hometax = page.getByTestId('integration-hometax');
  await hometax.getByLabel('연동 방식').selectOption('codef');
  await hometax.getByLabel('Client ID *').fill('client-id-e2e');
  await hometax.getByLabel('Client Secret *').fill('client-secret-e2e-9999');
  await hometax.getByLabel('RSA 공개키 *').fill('MIIBIjANBgkq-e2e');
  await hometax.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('홈택스 증빙 연동 설정을 저장했습니다.')).toBeVisible();
  const hometaxConnect = hometax.getByRole('form', { name: '홈택스 증빙 계정 연결' });
  await expect(hometaxConnect).toContainText('홈택스 아이디로');
  await expect(hometaxConnect.getByLabel('기관')).toHaveCount(0);
});
