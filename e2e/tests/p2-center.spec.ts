import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

test('증빙: 잔액 대사로 통장·장부를 맞춰 보고, 증빙센터에서 모든 증빙을 한눈에', async ({
  page,
}) => {
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '증빙 메뉴' }).getByRole('link', { name, exact: true });
  await signupWithCompany(page, 'p2-center', '대사상사');

  // ── 준비(API): 계좌, 잔액이 있는 통장 파일 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  const bank = await api.post('/api/bank-accounts', {
    data: {
      bankCode: '0004',
      alias: '운영자금',
      accountNo: '12345678901234',
      ledgerAccountId: acc['103'],
    },
  });
  expect(bank.status()).toBe(201);
  const uploaded = await api.post('/api/evidence/uploads/commit', {
    multipart: {
      options: JSON.stringify({ kind: 'bank', sourceId: (await bank.json()).id }),
      file: {
        name: 'bank.csv',
        mimeType: 'text/csv',
        buffer: csv([
          ['거래일시', '적요', '보낸분/받는분', '출금액(원)', '입금액(원)', '잔액(원)'],
          [`${daysAgo(5)} 09:00:00`, '타행입금', '(주)한빛상사', '0', '"1,000,000"', '"1,000,000"'],
          [`${daysAgo(4)} 09:00:00`, '임대료', '(주)강남빌딩', '"300,000"', '0', '"700,000"'],
          [`${daysAgo(3)} 09:00:00`, '개인사용', '편의점', '"50,000"', '0', '"650,000"'],
        ]),
      },
    },
  });
  expect(uploaded.status(), await uploaded.text()).toBe(200);

  // ── 잔액 대사: 분개 전에는 모두 미반영 거래로 설명된다 ──
  await page.getByRole('link', { name: '증빙·자동분개' }).click();
  await expect(page).toHaveURL(/\/evidence\/review/);
  await tab('잔액 대사').click();
  await expect(page).toHaveURL(/\/evidence\/reconcile/);
  const ledger = page.getByTestId('reconcile-103 보통예금');
  await expect(ledger).toContainText('일치');
  await expect(ledger.getByLabel('대사 결과')).toContainText('650,000');
  await expect(ledger.getByLabel('대사 결과')).toContainText('미반영 거래 3건');

  // ── 임대료만 전표로 ──
  await tab('자동분개 검토함').click();
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(page.getByText('자동분개: 매칭 0건, 자동 전기 0건, 검토 3건')).toBeVisible();
  await page
    .getByRole('table', { name: '자동분개 검토함' })
    .getByRole('row', { name: '(주)강남빌딩 임대료' })
    .getByRole('button', { name: '승인' })
    .click();
  await expect(page.getByText('1건을 전표로 만들었습니다.')).toBeVisible();

  // ── 증빙센터 ──
  await tab('증빙센터').click();
  await expect(page).toHaveURL(/\/evidence\/center/);
  const statuses = page.getByRole('group', { name: '처리 상태' });
  await expect(statuses.getByRole('button', { name: '전체 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(statuses.getByRole('button', { name: '검토 필요 2' })).toBeVisible();
  await statuses.getByRole('button', { name: '전표 연결 1' }).click();
  const table = page.getByRole('table', { name: '증빙센터' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  const rent = table.getByRole('row', { name: /강남빌딩/ });
  await expect(rent).toContainText('819 지급임차료');
  await expect(rent).toContainText('−300,000');
  await expect(rent.getByRole('link', { name: new RegExp(`^${daysAgo(4)}-\\d+$`) })).toBeVisible();
  await statuses.getByRole('button', { name: '전체 3' }).click();
  await page.getByLabel('검색').fill('편의점');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.getByRole('link', { name: '검토함에서 처리' })).toBeVisible();
  await snap(page, 'p2-28-center');

  // ── 잔액 대사: 여전히 일치, 통장에 없는 수기 전표를 넣으면 불일치 ──
  await tab('잔액 대사').click();
  await expect(ledger).toContainText('일치');
  await expect(ledger.getByLabel('대사 결과')).toContainText('미반영 거래 2건');
  const manual = await api.post('/api/journals', {
    data: {
      entry: {
        entryDate: daysAgo(2),
        lines: [
          { accountId: acc['103'], debit: 100_000, credit: 0 },
          { accountId: acc['101'], debit: 0, credit: 100_000 },
        ],
      },
      status: 'posted',
    },
  });
  expect(manual.status(), await manual.text()).toBe(201);
  await page.reload();
  await expect(ledger).toContainText('불일치');
  await expect(ledger.getByLabel('대사 결과')).toContainText('−100,000');
  await snap(page, 'p2-26-reconcile');
});
