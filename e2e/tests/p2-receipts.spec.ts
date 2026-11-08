import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** 1×1 PNG 뒤에 표시를 붙여 파일마다 내용을 다르게 한다 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const png = (mark: string) => Buffer.concat([PNG, Buffer.from(mark)]);
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const compact = today.replaceAll('-', '');

test('영수증: 올리면 모의 OCR 로 읽고, 사업자번호를 확인하고, 자동분개 때 카드 승인과 짝짓는다', async ({
  page,
}) => {
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '증빙 메뉴' }).getByRole('link', { name, exact: true });
  await signupWithCompany(page, 'p2-receipt', '영수증상사');

  // ── 설정: OCR 을 모의 데이터로 켠다, 사업자 상태 조회 채널이 있다 ──
  await page.goto('/settings/integrations');
  const ocr = page.getByTestId('integration-ocr');
  await ocr.getByLabel('연동 방식').selectOption('mock');
  await ocr.getByRole('switch', { name: '영수증 인식(OCR) 사용' }).click();
  await ocr.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('영수증 인식(OCR) 연동 설정을 저장했습니다.')).toBeVisible();
  await expect(page.getByTestId('integration-bizcheck')).toContainText('사업자 상태 조회');

  // ── 영수증 두 장 올리기 ──
  await page.getByRole('link', { name: '증빙·자동분개' }).click();
  await tab('영수증').click();
  await expect(page).toHaveURL(/\/evidence\/receipts/);
  await expect(page.getByText('올린 영수증이 없습니다.')).toBeVisible();
  await page.getByLabel('영수증 파일').setInputFiles([
    { name: `${compact}_스타벅스 역삼점_11000.png`, mimeType: 'image/png', buffer: png('a') },
    {
      name: `${compact}_동네식당_8000_1234567890.png`,
      mimeType: 'image/png',
      buffer: png('b'),
    },
  ]);
  await expect(page.getByText('영수증 2장을 올렸습니다(검토 필요 1장).')).toBeVisible();

  const table = page.getByRole('table', { name: '영수증' });
  const starbucks = table.getByRole('row', { name: '스타벅스 역삼점' });
  await expect(starbucks).toContainText(today);
  await expect(starbucks).toContainText('11,000');
  await expect(starbucks).toContainText('1,000');
  await expect(starbucks).toContainText('번호 확인');
  await expect(starbucks).toContainText('모의 데이터95%');
  await expect(starbucks).toContainText('미처리');
  const diner = table.getByRole('row', { name: '동네식당' });
  await expect(diner).toContainText('123-45-67890');
  await expect(diner).toContainText('번호 오류');
  await expect(diner).toContainText('검토 필요');

  // 같은 파일을 다시 올리면 등록하지 않는다
  await page
    .getByLabel('영수증 파일')
    .setInputFiles([{ name: 'again.png', mimeType: 'image/png', buffer: png('a') }]);
  await expect(page.getByText('영수증 0장을 올렸습니다(이미 올린 영수증 1장).')).toBeVisible();
  await expect(table.getByRole('row', { name: '스타벅스 역삼점' })).toHaveCount(1);

  // ── 사업자번호를 고치면 다시 확인한다 ──
  await diner.getByRole('button', { name: '동네식당 수정' }).click();
  const dialog = page.getByRole('dialog', { name: '영수증 수정' });
  await expect(dialog.getByLabel('합계(부가세 포함)')).toHaveValue('8000');
  await dialog.getByLabel('사업자번호').fill('124-81-00998');
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('영수증을 고쳤습니다.')).toBeVisible();
  await expect(diner).toContainText('124-81-00998');
  await expect(diner).toContainText('번호 확인');
  await expect(diner).toContainText('미처리');
  await snap(page, 'p2-18-receipts');

  // ── 카드 승인과 짝짓기 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const card = await api.post('/api/corporate-cards', {
    data: {
      cardCompany: '0306',
      alias: '법인카드',
      cardNo: '4518123456789012',
      ledgerAccountId: accounts.find((a) => a.code === '253')!.id,
    },
  });
  expect(card.status()).toBe(201);
  const upload = await api.post('/api/evidence/uploads/commit', {
    multipart: {
      options: JSON.stringify({ kind: 'card', sourceId: (await card.json()).id }),
      file: {
        name: 'card.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          [
            '승인일자,승인시간,가맹점명,업종,승인금액,승인번호,승인구분',
            `${today},12:30,스타벅스 역삼점,커피전문점,"11,000",30010001,승인`,
          ].join('\n'),
        ),
      },
    },
  });
  expect(upload.status(), await upload.text()).toBe(200);

  await tab('자동분개 검토함').click();
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(page.getByText(/^자동분개: /)).toBeVisible();
  await tab('영수증').click();
  await expect(starbucks).toContainText('카드와 짝지음');
  await expect(starbucks).toContainText('승인 30010001');
  await expect(starbucks.getByRole('button', { name: '스타벅스 역삼점 수정' })).toBeDisabled();
  await expect(starbucks.getByRole('button', { name: '스타벅스 역삼점 삭제' })).toBeDisabled();

  // 상태로 거르기
  await page.getByRole('button', { name: '매칭됨 1' }).click();
  await expect(table.getByRole('row', { name: '동네식당' })).toHaveCount(0);
  await expect(starbucks).toBeVisible();
});
