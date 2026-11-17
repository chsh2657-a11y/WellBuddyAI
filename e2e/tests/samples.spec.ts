import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

/**
 * 테스트 안내서(docs/TESTING.md)의 샘플 파일(docs/samples)이 실제로 올라가는지 확인한다.
 * 샘플은 우리 회사 사업자번호 124-81-00998(데모 계정·E2E 가입 회사) 기준이다.
 */
const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/samples');
const sample = (name: string) => ({
  name,
  mimeType: name.endsWith('.png') ? 'image/png' : 'text/csv',
  buffer: readFileSync(path.join(SAMPLES, name)),
});

async function upload(page: Page, kind: string, file: string, count: number, direction?: string) {
  await page.goto('/evidence/upload');
  await page.getByLabel('자료 종류').selectOption({ label: kind });
  if (direction) await page.getByLabel('매출·매입').selectOption({ label: direction });
  await page.getByLabel('파일', { exact: true }).setInputFiles(sample(file));
  await page.getByRole('button', { name: '미리보기' }).click();
  const summary = page.getByLabel('미리보기 요약');
  await expect(summary).toContainText(`읽은 거래 ${count}건`);
  await expect(summary).toContainText(`새로 등록 ${count}건`);
  await expect(page.getByLabel('읽지 못한 줄')).toHaveCount(0);
  await page.getByRole('button', { name: `${count}건 등록` }).click();
  await expect(page.getByText(`${file}: ${count}건 등록, 중복 0건`)).toBeVisible();
}

test('샘플 파일: 통장·카드·홈택스·영수증을 올리고 자동분개까지', async ({ page }) => {
  test.setTimeout(90_000);
  await signupWithCompany(page, 'samples', '샘플상사');

  await page.goto('/evidence/sources');
  await page.getByLabel('은행', { exact: true }).selectOption({ label: 'KB국민은행' });
  await page.getByLabel('계좌 별칭').fill('운영자금');
  await page.getByLabel('계좌번호').fill('123456-01-234567');
  await page.getByRole('button', { name: '계좌 등록' }).click();
  await expect(page.getByText(/국민은행 \*\*\*\*4567 계좌를 등록했습니다/)).toBeVisible();
  await page.getByLabel('카드사').selectOption({ label: '신한카드' });
  await page.getByLabel('카드 별칭').fill('법인카드');
  await page.getByLabel('카드번호').fill('4518-1234-5678-9012');
  await page.getByRole('button', { name: '카드 등록' }).click();
  await expect(page.getByText('신한카드 ****9012 카드를 등록했습니다.')).toBeVisible();

  await upload(page, '통장 거래내역', 'bank-kb.csv', 8);
  await upload(page, '카드 승인내역', 'card-shinhan.csv', 6);
  await upload(page, '세금계산서·계산서', 'hometax-tax-invoices.csv', 3);
  await upload(page, '현금영수증', 'hometax-cash-receipts.csv', 2, '매입');

  // 매출·매입은 사업자번호로 갈랐다
  await page.goto('/evidence/records?kind=tax_invoice');
  const invoices = page.getByRole('table', { name: '세금계산서' });
  await expect(invoices.getByRole('row', { name: /한빛상사/ })).toContainText('매출');
  await expect(invoices.getByRole('row', { name: /대한물산/ })).toContainText('매입');

  // 영수증: 모의 OCR 이 파일 이름을 읽는다(택시 영수증은 사업자번호 오류로 검토 필요)
  await page.goto('/settings/integrations');
  const ocr = page.getByTestId('integration-ocr');
  await ocr.getByLabel('연동 방식').selectOption('mock');
  await ocr.getByRole('switch', { name: '영수증 인식(OCR) 사용' }).click();
  await ocr.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('영수증 인식(OCR) 연동 설정을 저장했습니다.')).toBeVisible();
  await page.goto('/evidence/receipts');
  await page
    .getByLabel('영수증 파일')
    .setInputFiles([
      sample('20261015_스타벅스 역삼점_5500_113-81-55305.png'),
      sample('20261016_카카오T 택시_15300_120-86-44100.png'),
    ]);
  await expect(page.getByText('영수증 2장을 올렸습니다(검토 필요 1장).')).toBeVisible();

  // 자동분개: 카드 승인·취소 상쇄와 영수증·카드 짝짓기로 매칭이 생기고, 나머지는 검토함으로
  await page.goto('/evidence/review');
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(
    page.getByText(/^자동분개: 매칭 [1-9]\d*건, 자동 전기 0건, 검토 [1-9]\d*건$/),
  ).toBeVisible();
  await snap(page, 'samples-review');

  // 세금계산서를 먼저 승인(외상 전표)한 뒤 다시 실행하면 통장 입출금에 외상 반제를 추천한다
  const api = page.request;
  const review = (await (await api.get('/api/auto-journal/review')).json()) as {
    evidenceKind: string;
    evidenceId: string;
  }[];
  const pending = review.filter((i) => i.evidenceKind === 'tax_invoice');
  expect(pending).toHaveLength(3);
  const approved = await api.post('/api/auto-journal/approve', { data: { items: pending } });
  expect((await approved.json()).failed).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(page.getByText(/^자동분개: 매칭 \d+건, 자동 전기 0건, 검토 \d+건$/)).toBeVisible();
  const rows = page.getByRole('table', { name: '자동분개 검토함' }).getByRole('row');
  await expect(rows.filter({ hasText: '한빛상사' })).toContainText('외상매출금 반제');
  await expect(rows.filter({ hasText: '대한물산' })).toContainText('외상매입금 반제');
  await snap(page, 'samples-settlement');
});
