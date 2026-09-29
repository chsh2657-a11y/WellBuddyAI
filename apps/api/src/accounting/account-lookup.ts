import { accounts, ensureStandardAccounts, type Transaction } from '@wellbuddy/db';
import { eq } from 'drizzle-orm';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';

/**
 * 표준 계정 코드로 계정 ID 를 찾는다. 예전에 만든 회사라 새 표준 계정(예: 246 부도어음과수표)이
 * 없으면 표준 계정을 보충한 뒤 다시 찾는다.
 */
export async function accountIdByCode(tx: Transaction, code: string): Promise<string> {
  const find = async () =>
    (await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, code)))[0]?.id;
  let id = await find();
  if (!id) {
    await ensureStandardAccounts(tx, requireCompanyContext().companyId);
    id = await find();
  }
  if (!id) throw new AppException('ACCOUNT_NOT_FOUND', `${code} 계정이 없습니다.`);
  return id;
}
