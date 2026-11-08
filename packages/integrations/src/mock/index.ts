import { ClaudeClassifier } from '../ai/claude.js';
import { FormatBizCheckProvider, NtsBizCheckProvider } from '../bizcheck/index.js';
import { CodefBankProvider, CodefCardProvider, CodefHometaxProvider } from '../codef/index.js';
import type { CodefOptions } from '../codef/client.js';
import { PopbillHometaxProvider, PopbillTaxInvoiceIssuer } from '../popbill/index.js';
import type { PopbillOptions } from '../popbill/client.js';
import { ClaudeOcrProvider } from '../ocr/claude.js';
import { ClovaOcrProvider } from '../ocr/clova.js';
import { MockOcrProvider } from '../ocr/mock.js';
import { UpstageOcrProvider } from '../ocr/upstage.js';
import { ProviderRegistry } from '../registry.js';
import { MockBankProvider } from './bank.js';
import { MockCardProvider } from './card.js';
import { MockHometaxProvider } from './hometax.js';
import { MockTaxInvoiceIssuer } from './taxinvoice.js';

export { bizNo } from './catalog.js';
export { mockApprovalNo } from './taxinvoice.js';
export { MockBankProvider, MockCardProvider, MockHometaxProvider, MockTaxInvoiceIssuer };

/** 모의 공급자 등록(연동관리에서 '모의 데이터'를 고른 채널) */
export function registerMockProviders(registry: ProviderRegistry): ProviderRegistry {
  return registry
    .register('bank', 'mock', () => new MockBankProvider())
    .register('card', 'mock', () => new MockCardProvider())
    .register('hometax', 'mock', (_, ctx) => new MockHometaxProvider(ctx))
    .register('taxinvoice', 'mock', () => new MockTaxInvoiceIssuer())
    .register('ocr', 'mock', () => new MockOcrProvider());
}

/**
 * 공급자 레지스트리: 모의 공급자, CODEF(은행·카드·홈택스), 팝빌(홈택스 수집·전자세금계산서 발행),
 * 영수증 OCR(Claude·Upstage·CLOVA),
 * 사업자 상태 조회, AI 분류(Claude).
 */
export function createProviderRegistry(): ProviderRegistry {
  const codef = (c: Record<string, string>): CodefOptions => ({
    clientId: c.clientId ?? '',
    clientSecret: c.clientSecret ?? '',
    publicKey: c.publicKey,
    environment: c.environment,
    connectedId: c.connectedId,
  });
  const popbill = (c: Record<string, string>): PopbillOptions => ({
    linkId: c.linkId ?? '',
    secretKey: c.secretKey ?? '',
    corpNum: c.corpNum ?? '',
    environment: c.environment,
  });
  return registerMockProviders(new ProviderRegistry())
    .register('bank', 'codef', (c) => new CodefBankProvider(codef(c)))
    .register('card', 'codef', (c) => new CodefCardProvider(codef(c)))
    .register('hometax', 'codef', (c) => new CodefHometaxProvider(codef(c)))
    .register('hometax', 'popbill', (c) => new PopbillHometaxProvider(popbill(c)))
    .register('taxinvoice', 'popbill', (c, ctx) => new PopbillTaxInvoiceIssuer(popbill(c), ctx))
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
