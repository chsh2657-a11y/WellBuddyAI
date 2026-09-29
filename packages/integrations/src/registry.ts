import type { ChannelProviders, ProviderChannel } from './providers.js';

/** 회사 연동 설정(복호화한 자격증명 포함) */
export interface ProviderSetting {
  provider: string;
  enabled: boolean;
  credentials: Record<string, string>;
}

type Factory<C extends ProviderChannel> = (
  credentials: Record<string, string>,
) => ChannelProviders[C];

export class ProviderError extends Error {
  constructor(
    readonly code: 'CHANNEL_DISABLED' | 'PROVIDER_UNKNOWN' | 'PROVIDER_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/**
 * 채널·공급자 키 → 구현체 공장. 회사 설정(켜짐 여부·공급자·자격증명)에 따라 구현체를 만든다.
 * 파일 업로드(file)는 수집 공급자가 아니라 업로드 화면에서 처리하므로 여기서 만들지 않는다.
 */
export class ProviderRegistry {
  private readonly factories = new Map<string, Factory<ProviderChannel>>();

  register<C extends ProviderChannel>(channel: C, provider: string, factory: Factory<C>): this {
    this.factories.set(`${channel}:${provider}`, factory as Factory<ProviderChannel>);
    return this;
  }

  has(channel: ProviderChannel, provider: string): boolean {
    return this.factories.has(`${channel}:${provider}`);
  }

  resolve<C extends ProviderChannel>(channel: C, setting: ProviderSetting): ChannelProviders[C] {
    if (!setting.enabled) {
      throw new ProviderError('CHANNEL_DISABLED', '연동관리에서 이 채널이 꺼져 있습니다.');
    }
    const factory = this.factories.get(`${channel}:${setting.provider}`);
    if (!factory) {
      throw new ProviderError(
        'PROVIDER_UNKNOWN',
        setting.provider === 'file'
          ? '파일 업로드 방식은 자동 수집을 하지 않습니다. 파일을 올려 주세요.'
          : `지원하지 않는 공급자입니다(${setting.provider}).`,
      );
    }
    return factory(setting.credentials) as ChannelProviders[C];
  }
}
