import { expect, type Page, test } from '@playwright/test';

/**
 * P0 완료 기준 시나리오:
 * 회원가입 → 회사 생성(사업자번호) → 로그아웃 → 로그인 → 대시보드 → 설정 > 연동관리에서
 * 은행 채널을 모의 데이터로 켜고 연결 테스트 성공.
 */
const email = `e2e-${Date.now()}@wellbuddy.test`;
const password = 'abcd1234';

async function snap(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });
}

test.describe.configure({ mode: 'serial' });

test('회원가입 후 회사를 만들면 대시보드로 들어간다', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await snap(page, '01-login');

  await page.getByRole('link', { name: '회원가입' }).click();
  await page.getByLabel('이름').fill('김경리');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '가입하기' }).click();

  await expect(page).toHaveURL(/\/onboarding\/company/);
  await page.getByLabel('회사명').fill('이투이상사');
  await page.getByLabel('사업자등록번호').fill('123-45-67890');
  await page.getByRole('button', { name: '회사 만들고 시작하기' }).click();
  await expect(page.getByText('올바른 사업자등록번호가 아닙니다.')).toBeVisible();
  await snap(page, '02-onboarding-invalid');

  await page.getByLabel('사업자등록번호').fill('124-81-00998');
  await page.getByLabel('대표자명').fill('홍길동');
  await page.getByRole('button', { name: '회사 만들고 시작하기' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: '안녕하세요, 김경리님' })).toBeVisible();
  await expect(page.getByTestId('company-switcher')).toContainText('이투이상사');
  await snap(page, '03-dashboard');
});

test('로그아웃 후 다시 로그인하면 같은 회사 대시보드로 들어간다', async ({ page }) => {
  await login(page);
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('비밀번호').fill('wrong-pass1');
  await page.getByLabel('이메일').fill(email);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeVisible();

  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId('company-switcher')).toContainText('이투이상사');
});

test('설정 > 연동관리에서 은행 채널을 모의 데이터로 켜고 연결 테스트에 성공한다', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: '설정' }).click();
  await expect(page).toHaveURL(/\/settings\/company/);
  await snap(page, '04-settings-company');

  await page.getByRole('link', { name: '연동관리' }).click();
  const bank = page.getByTestId('integration-bank');
  await expect(bank).toBeVisible();
  await bank.getByLabel('연동 방식').selectOption('mock');
  await bank.getByRole('switch', { name: '은행 입출금 사용' }).click();
  await bank.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('은행 입출금 연동 설정을 저장했습니다.')).toBeVisible();

  const savedBank = page.getByTestId('integration-bank');
  await expect(savedBank.getByText('사용 중')).toBeVisible();
  await savedBank.getByRole('button', { name: '연결 테스트' }).click();
  await expect(page.getByTestId('integration-bank-result')).toContainText(
    '모의 데이터 공급자가 준비되었습니다.',
  );
  await snap(page, '05-settings-integrations');

  await page.getByRole('link', { name: '사용자·권한' }).click();
  await expect(page.getByRole('heading', { name: '역할별 권한' })).toBeVisible();
  await snap(page, '06-settings-users');

  await page.getByRole('link', { name: '감사로그' }).click();
  await expect(page.getByRole('cell', { name: '연동 설정 변경' }).first()).toBeVisible();
  await snap(page, '07-settings-audit');
});

test('사업장을 엑셀로 일괄 등록한다(미리보기에서 오류 행 확인 후 제외하고 등록)', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings/company');
  await page.getByRole('button', { name: '엑셀 업로드' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: '양식 내려받기' })).toHaveAttribute(
    'href',
    '/api/imports/business-places/template',
  );
  const csv =
    '사업장명,사업자등록번호,주소\n부산지점,220-81-12341,부산\n잘못된지점,123-45-67890,서울\n';
  await dialog.getByLabel('엑셀 파일 선택').setInputFiles({
    name: '사업장.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(dialog.getByText('정상 1행')).toBeVisible();
  await expect(dialog.getByText('오류 1행')).toBeVisible();
  await expect(dialog.getByText('올바른 사업자등록번호가 아닙니다.')).toBeVisible();
  await snap(page, '08-excel-import-preview');

  await dialog.getByRole('button', { name: '오류 행 제외하고 1건 등록' }).click();
  await expect(page.getByText('1건 추가, 0건 수정, 1건 제외')).toBeVisible();
  await expect(page.getByRole('cell', { name: '부산지점', exact: true })).toBeVisible();
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
