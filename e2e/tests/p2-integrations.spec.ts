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

test('전자세금계산서: 모의 발행 → 매출 세금계산서로 등록 → 상태 확인 → 발행 취소', async ({
  page,
}) => {
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '증빙 메뉴' }).getByRole('link', { name, exact: true });
  await signupWithCompany(page, 'p2-issue', '발행상사');

  // 꺼져 있으면 발행하지 않는다
  await page.getByRole('link', { name: '증빙·자동분개' }).click();
  await tab('세금계산서 발행').click();
  await expect(page).toHaveURL(/\/evidence\/issue/);
  const form = page.getByRole('form', { name: '세금계산서 발행' });
  await form.getByLabel('공급받는자 사업자번호').fill('220-81-12341');
  await form.getByLabel('상호').fill('(주)한빛상사');
  await form.getByLabel('품목').fill('제품 납품');
  await form.getByLabel('공급가액').fill('1,000,000');
  await expect(page.getByTestId('issue-total')).toHaveText('세액 100,000 · 합계 1,100,000');
  await form.getByRole('button', { name: '발행' }).click();
  await expect(form.getByRole('alert')).toContainText('전자세금계산서 발행을 켜 주세요');

  await page.goto('/settings/integrations');
  const channel = page.getByTestId('integration-taxinvoice');
  await channel.getByLabel('연동 방식').selectOption('mock');
  await channel.getByRole('switch', { name: '전자세금계산서 발행 사용' }).click();
  await channel.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('전자세금계산서 발행 연동 설정을 저장했습니다.')).toBeVisible();

  await page.goto('/evidence/issue');
  await form.getByLabel('공급받는자 사업자번호').fill('220-81-12341');
  await form.getByLabel('상호').fill('(주)한빛상사');
  await form.getByLabel('품목').fill('제품 납품');
  await form.getByLabel('공급가액').fill('1000000');
  await form.getByRole('button', { name: '발행' }).click();
  await expect(
    page.getByText(/^\(주\)한빛상사에 세금계산서를 발행했습니다 \(승인번호 \d{24}\)\.$/),
  ).toBeVisible();

  const row = page
    .getByRole('table', { name: '발행한 세금계산서' })
    .getByRole('row', { name: '(주)한빛상사 제품 납품' });
  await expect(row).toContainText('발행 완료');
  await expect(row).toContainText('220-81-12341');
  await expect(row).toContainText('1,100,000');
  await expect(row).toContainText('증빙 미처리');
  await snap(page, 'p2-14-tax-invoice-issue');

  // 매출 세금계산서로 등록되었다
  await row.getByRole('link', { name: '증빙 미처리' }).click();
  await expect(page).toHaveURL(/\/evidence\/records\?kind=tax_invoice/);
  await expect(
    page.getByRole('table', { name: '세금계산서' }).getByRole('row', { name: /\(주\)한빛상사/ }),
  ).toContainText('1,100,000');

  await tab('세금계산서 발행').click();
  await row.getByRole('button', { name: '(주)한빛상사 상태 확인' }).click();
  await expect(page.getByText('상태: 국세청 전송 완료')).toBeVisible();
  await expect(row).toContainText('국세청 전송 완료');

  page.once('dialog', (dialog) => void dialog.accept('금액 오류'));
  await row.getByRole('button', { name: '(주)한빛상사 발행 취소' }).click();
  await expect(page.getByText('발행을 취소했습니다.')).toBeVisible();
  await expect(row).toContainText('발행 취소');
  await expect(row).toContainText('증빙 제외');
  await expect(row.getByRole('button', { name: '(주)한빛상사 발행 취소' })).toBeDisabled();
});
