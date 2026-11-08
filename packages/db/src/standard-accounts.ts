import { accountNormalBalance, STANDARD_ACCOUNTS } from '@wellbuddy/accounting-core';
import { accounts } from './schema/index.js';
import type { Executor } from './client.js';

/**
 * 회사에 표준 계정과목을 넣는다. 이미 있는 코드는 건너뛰므로 여러 번 호출해도 안전하다
 * (회사 생성 시, 또는 "표준 계정 불러오기"로 지운·빠진 계정을 복원할 때).
 * RLS 컨텍스트가 해당 회사인 트랜잭션(또는 소유자 연결)에서 호출해야 한다.
 */
export async function ensureStandardAccounts(tx: Executor, companyId: string): Promise<number> {
  const inserted = await tx
    .insert(accounts)
    .values(
      STANDARD_ACCOUNTS.map((a) => ({
        companyId,
        code: a.code,
        name: a.name,
        group: a.group,
        normalBalance: accountNormalBalance(a),
        requiresPartner: a.requiresPartner ?? false,
        isSystem: true,
      })),
    )
    .onConflictDoNothing({ target: [accounts.companyId, accounts.code] })
    .returning({ id: accounts.id });
  return inserted.length;
}
