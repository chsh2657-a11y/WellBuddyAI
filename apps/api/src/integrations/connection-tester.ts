import { Injectable } from '@nestjs/common';
import { ProviderRegistry } from '@wellbuddy/integrations';
import { type ConnectionTestResult, getProvider, type IntegrationChannel } from '@wellbuddy/shared';
import { requireCompanyContext } from '../common/request-context.js';

/**
 * 공급자별 연결 테스트.
 * 파일 업로드·모의 데이터·내장 규칙은 바로 준비되고, 외부 API 는 구현체가 있으면(Claude AI 분류,
 * 영수증 OCR, 국세청 사업자 상태조회 등) 실제로 호출해 본다. 아직 구현체가 없는 외부 API(CODEF·팝빌)는
 * P2-10~16 에서 더한다.
 */
@Injectable()
export class ConnectionTester {
  constructor(private readonly registry: ProviderRegistry) {}

  async test(
    channel: IntegrationChannel,
    provider: string,
    credentials: Record<string, string>,
  ): Promise<ConnectionTestResult> {
    const def = getProvider(channel, provider);
    if (!def) return { ok: false, message: '알 수 없는 공급자입니다.' };

    const missing = def.credentials.filter((f) => f.required && !credentials[f.key]);
    if (missing.length > 0) {
      return {
        ok: false,
        message: `필수 항목을 입력해 주세요: ${missing.map((f) => f.label).join(', ')}`,
      };
    }

    switch (def.kind) {
      case 'file':
        return { ok: true, message: '파일 업로드 방식은 별도 연결이 필요 없습니다.' };
      case 'mock':
        return { ok: true, message: '모의 데이터 공급자가 준비되었습니다.' };
      case 'builtin':
        return { ok: true, message: '내장 기능이라 외부 연결이 필요 없습니다.' };
      case 'external':
        if (this.registry.has(channel, provider)) {
          const { companyId } = requireCompanyContext();
          try {
            const impl = this.registry.resolve(
              channel,
              { provider, enabled: true, credentials },
              { companyId, companyName: '', bizNo: null },
            );
            return await impl.testConnection();
          } catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
          }
        }
        return {
          ok: false,
          message: `${def.label} 실연동은 P2 단계에서 제공됩니다. 자격증명은 안전하게 저장되었습니다.`,
        };
    }
  }
}
