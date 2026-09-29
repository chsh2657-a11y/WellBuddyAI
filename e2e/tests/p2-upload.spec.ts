import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));

/** KB국민은행 거래내역 CSV */
const KB = csv([
  ['KB국민은행 거래내역'],
  [
    '거래일시',
    '적요',
    '보낸분/받는분',
    '송금메모',
    '출금액(원)',
    '입금액(원)',
    '잔액(원)',
    '거래점',
  ],
  ['2026-03-10 09:00:00', '타행이체', '한빛상사', '', '0', '"1,100,000"', '"6,100,000"', '강남'],
  ['2026-03-10 14:30:00', '카드대금', '신한카드', '', '"300,000"', '0', '"5,800,000"', '강남'],
]);

/** 처음 보는 양식(머리글 이름으로 알아볼 수 없음) */
const CUSTOM = csv([
  ['A', 'B', 'C'],
  ['2026-03-15', '사무실 월세', '"500,000"'],
]);

test('증빙: 통장 파일 올리기 → 미리보기 → 등록, 처음 보는 양식은 열을 지정해 저장', async ({
  page,
}) => {
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '증빙 메뉴' }).getByRole('link', { name, exact: true });
  await signupWithCompany(page, 'p2-upload', '업로드상사');
  await page.getByRole('link', { name: '증빙·자동분개' }).click();
  await expect(page).toHaveURL(/\/evidence\/records/);
  await expect(page.getByText('수집한 통장 자료가 없습니다.')).toBeVisible();

  await tab('계좌·카드').click();
  await expect(page).toHaveURL(/\/evidence\/sources/);
  await page.getByLabel('계좌 별칭').fill('운영자금');
  await page.getByLabel('계좌번호').fill('123456-01-234567');
  await page.getByRole('button', { name: '계좌 등록' }).click();
  await expect(page.getByText('국민은행 ****4567 계좌를 등록했습니다.')).toBeVisible();

  // 은행 양식은 저절로 알아본다
  await tab('파일 올리기').click();
  await expect(page).toHaveURL(/\/evidence\/upload/);
  await expect(page.getByLabel('계좌', { exact: true })).toContainText('운영자금');
  await page
    .getByLabel('파일', { exact: true })
    .setInputFiles({ name: 'kb.csv', mimeType: 'text/csv', buffer: KB });
  await page.getByRole('button', { name: '미리보기' }).click();
  const summary = page.getByLabel('미리보기 요약');
  await expect(summary).toContainText('읽은 거래 2건');
  await expect(summary).toContainText('새로 등록 2건');
  await expect(summary).toContainText('양식 자동 인식');
  const sample = page.getByRole('table', { name: '읽은 거래' });
  await expect(sample.getByRole('row', { name: /한빛상사/ })).toContainText('1,100,000');
  await expect(page.getByLabel('출금', { exact: true })).toHaveValue('4');
  await snap(page, 'p2-05-upload-preview');
  await page.getByRole('button', { name: '2건 등록' }).click();
  await expect(page.getByText('kb.csv: 2건 등록, 중복 0건')).toBeVisible();

  await page.getByRole('link', { name: '수집 내역 보기' }).click();
  await expect(page).toHaveURL(/\/evidence\/records\?kind=bank/);
  const bank = page.getByRole('table', { name: '통장 거래' });
  await expect(bank.getByRole('row', { name: /한빛상사/ })).toContainText('미처리');
  await expect(bank.locator('tfoot')).toContainText('1,100,000');
  await expect(bank.locator('tfoot')).toContainText('300,000');

  // 같은 파일을 다시 올리면 중복으로 알려 준다
  await tab('파일 올리기').click();
  await expect(page).toHaveURL(/\/evidence\/upload/);
  await page
    .getByLabel('파일', { exact: true })
    .setInputFiles({ name: 'kb.csv', mimeType: 'text/csv', buffer: KB });
  await page.getByRole('button', { name: '미리보기' }).click();
  await expect(summary).toContainText('새로 등록 0건');
  await expect(summary).toContainText('이미 등록 2건');

  // 처음 보는 양식: 머리글 줄과 열을 직접 고르고 저장한다
  await page
    .getByLabel('파일')
    .setInputFiles({ name: 'custom.csv', mimeType: 'text/csv', buffer: CUSTOM });
  await page.getByRole('button', { name: '미리보기' }).click();
  await expect(summary).toContainText('읽은 거래 0건');
  await expect(page.getByLabel('읽지 못한 줄')).toContainText('열을 직접 지정해 주세요');
  await page.getByLabel('머리글 줄').selectOption({ label: '1행 · A · B · C' });
  await page.getByLabel('거래일(시)').selectOption({ label: 'A열 · A' });
  await page.getByLabel('적요', { exact: true }).selectOption({ label: 'B열 · B' });
  await page.getByLabel('출금', { exact: true }).selectOption({ label: 'C열 · C' });
  await page.getByRole('button', { name: '이 열 지정으로 다시 읽기' }).click();
  await expect(summary).toContainText('읽은 거래 1건');
  await expect(summary).toContainText('직접 지정한 열 사용');
  await expect(sample.getByRole('row', { name: /사무실 월세/ })).toContainText('500,000');
  await page.getByRole('switch', { name: '이 열 지정을 저장해 같은 양식에 다시 쓰기' }).click();
  await page.getByLabel('양식 이름').fill('관리비 양식');
  await page.getByRole('button', { name: '1건 등록' }).click();
  await expect(page.getByText('custom.csv: 1건 등록, 중복 0건')).toBeVisible();
  await expect(page.getByRole('row', { name: /관리비 양식/ })).toContainText('1행');

  // 같은 양식은 저장한 열 지정을 저절로 쓴다
  await page
    .getByLabel('파일')
    .setInputFiles({ name: 'custom-2.csv', mimeType: 'text/csv', buffer: CUSTOM });
  await page.getByRole('button', { name: '미리보기' }).click();
  await expect(summary).toContainText('저장한 열 지정 ‘관리비 양식’ 사용');
  await expect(summary).toContainText('이미 등록 1건');

  // 제외 처리와 수집 이력
  await tab('수집 내역').click();
  await expect(page).toHaveURL(/\/evidence\/records/);
  const rent = bank.getByRole('row', { name: /사무실 월세/ });
  await rent.getByRole('button', { name: '제외' }).click();
  await expect(rent).toContainText('제외');
  await expect(rent.getByRole('button', { name: '되살리기' })).toBeVisible();
  await page.getByLabel('처리 상태').selectOption({ label: '제외' });
  await expect(bank.locator('tbody tr')).toHaveCount(1);
  await snap(page, 'p2-06-records');

  await tab('자동 수집').click();
  await expect(page).toHaveURL(/\/evidence\/collect/);
  const runs = page.getByRole('table', { name: '수집 이력' });
  await expect(runs.locator('tbody tr')).toHaveCount(2);
  await expect(runs.getByRole('row', { name: /custom\.csv/ })).toContainText('파일 · 업로드');
});
