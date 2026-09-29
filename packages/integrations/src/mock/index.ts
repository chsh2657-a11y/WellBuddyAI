import { ClaudeClassifier } from '../ai/claude.js';
import { FormatBizCheckProvider, NtsBizCheckProvider } from '../bizcheck/index.js';
import { ClaudeOcrProvider } from '../ocr/claude.js';
import { ClovaOcrProvider } from '../ocr/clova.js';
import { MockOcrProvider } from '../ocr/mock.js';
import { UpstageOcrProvider } from '../ocr/upstage.js';
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
    .register('hometax', 'mock', (_, ctx) => new MockHometaxProvider(ctx))
    .register('ocr', 'mock', () => new MockOcrProvider());
}

/**
 * 공급자 레지스트리: 모의 공급자, 영수증 OCR(Claude·Upstage·CLOVA), 사업자 상태 조회, AI 분류(Claude).
 * 실연동(CODEF·팝빌)은 P2-10~16 에서 여기에 더한다.
 */
export function createProviderRegistry(): ProviderRegistry {
  return registerMockProviders(new ProviderRegistry())
    .register('ocr', 'claude', (c) => new ClaudeOcrProvider({ apiKey: c.apiKey ?? '' }))
    .register('ocr', 'upstage', (c) => new UpstageOcrProvider({ apiKey: c.apiKey ?? '' }))
    .register(
      'ocr',
      'clova',
      (c) => new ClovaOcrProvider({ invokeUrl: c.invokeUrl ?? '', secretKey: c.secretKey ?? '' }),
    )
    .register('bizcheck', 'format', () => new FormatBizCheckProvider())
    .register('bizcheck', 'nts', (c) => new NtsBizCheckProvider({ serviceKey: c.serviceKey ?? '' }))
    .register('ai', 'claude', (c) => new ClaudeClassifier({ apiKey: c.apiKey ?? '' }));
}
