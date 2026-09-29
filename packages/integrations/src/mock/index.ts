import { ProviderRegistry } from '../registry.js';
import { MockBankProvider } from './bank.js';
import { MockCardProvider } from './card.js';
import { MockHometaxProvider } from './hometax.js';

export { bizNo } from './catalog.js';
export { MockBankProvider, MockCardProvider, MockHometaxProvider };

/** 모의 공급자 등록(연동관리에서 '모의 데이터'를 고른 채널) */
export function registerMockProviders(registry: ProviderRegistry): ProviderRegistry {
  return registry
    .register('bank', 'mock', () => new MockBankProvider())
    .register('card', 'mock', () => new MockCardProvider())
    .register('hometax', 'mock', (_, ctx) => new MockHometaxProvider(ctx));
}

/** 수집 공급자 레지스트리. 실연동(CODEF·팝빌)은 P2-10~13 에서 여기에 더한다 */
export function createProviderRegistry(): ProviderRegistry {
  return registerMockProviders(new ProviderRegistry());
}
