import type { AccountConnectInput } from '../providers.js';
import { ProviderError } from '../registry.js';
import type { CodefClient } from './client.js';
import { CODEF_PRODUCTS } from './products.js';

interface AccountResult {
  connectedId?: string;
  successList?: { organization?: string; code?: string; message?: string }[];
  errorList?: { organization?: string; code?: string; message?: string; extraMessage?: string }[];
}

/**
 * 기관 계정(인터넷뱅킹·카드사·홈택스 아이디)을 CODEF 에 등록하고 Connected ID 를 받는다.
 * 이미 Connected ID 가 있으면 그 ID 에 기관을 더한다. 비밀번호는 RSA 로 암호화해 보내고 저장하지 않는다.
 */
export async function connectCodefAccount(
  client: CodefClient,
  businessType: 'BK' | 'CD' | 'NT',
  input: AccountConnectInput,
): Promise<{ connectedId: string; message: string }> {
  if (!input.organization || !input.loginId || !input.password) {
    throw new ProviderError('PROVIDER_FAILED', '기관·아이디·비밀번호를 모두 입력해 주세요.');
  }
  const existing = client.connectedId;
  const account = {
    countryCode: 'KR',
    businessType,
    clientType: 'B',
    organization: input.organization,
    loginType: '1',
    id: input.loginId,
    password: client.encrypt(input.password),
  };
  const result = await client.requestRaw<AccountResult>(
    existing ? CODEF_PRODUCTS.accountAdd : CODEF_PRODUCTS.accountCreate,
    { accountList: [account], ...(existing ? { connectedId: existing } : {}) },
  );
  const failed = result.data?.errorList?.[0];
  if (failed) {
    const detail = [failed.message, failed.extraMessage].filter(Boolean).join(' ');
    throw new ProviderError(
      'PROVIDER_FAILED',
      `CODEF 계정 연결에 실패했습니다: ${detail || result.message} (${failed.code ?? result.code})`,
    );
  }
  const connectedId = result.data?.connectedId || existing;
  if (!connectedId || (result.code !== 'CF-00000' && !result.data?.successList?.length)) {
    throw new ProviderError(
      'PROVIDER_FAILED',
      `CODEF 계정 연결에 실패했습니다: ${result.message || '응답 없음'} (${result.code})`,
    );
  }
  return {
    connectedId,
    message: existing ? '기관 계정을 더 연결했습니다.' : '기관 계정을 연결했습니다.',
  };
}
