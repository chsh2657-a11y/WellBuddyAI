import { describe, expect, it } from 'vitest';
import type { BankProvider } from './providers.js';
import { ProviderError, ProviderRegistry } from './registry.js';

const ctx = { companyId: 'c1', companyName: '테스트', bizNo: null };

const fakeBank = (label: string): BankProvider => ({
  testConnection: async () => ({ ok: true, message: label }),
  fetchTransactions: async () => [],
});

describe('ProviderRegistry', () => {
  const registry = new ProviderRegistry()
    .register('bank', 'mock', () => fakeBank('mock'))
    .register('bank', 'codef', (credentials) => fakeBank(`codef:${credentials.clientId}`));

  it('회사 설정의 공급자와 자격증명으로 구현체를 만든다', async () => {
    const bank = registry.resolve(
      'bank',
      {
        provider: 'codef',
        enabled: true,
        credentials: { clientId: 'abc' },
      },
      ctx,
    );
    expect(await bank.testConnection()).toEqual({ ok: true, message: 'codef:abc' });
    expect(registry.has('bank', 'mock')).toBe(true);
    expect(registry.has('card', 'mock')).toBe(false);
  });

  it('꺼진 채널, 모르는 공급자, 파일 업로드는 수집 공급자를 만들지 않는다', () => {
    const resolve =
      (provider: string, enabled = true) =>
      () =>
        registry.resolve('bank', { provider, enabled, credentials: {} }, ctx);
    expect(resolve('mock', false)).toThrow(ProviderError);
    try {
      resolve('mock', false)();
    } catch (e) {
      expect((e as ProviderError).code).toBe('CHANNEL_DISABLED');
    }
    expect(resolve('file')).toThrow(/파일을 올려/);
    expect(resolve('nope')).toThrow(/지원하지 않는/);
  });
});
