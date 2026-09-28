import { z } from 'zod';

/**
 * 외부 연동 채널과 공급자.
 * 회사는 설정 > 연동관리에서 채널마다 ON/OFF 와 공급자(파일 업로드 / 모의 데이터 / 실연동)를 고른다.
 *   kind: file     — 엑셀·CSV 를 직접 올린다(계약 불필요)
 *         mock     — 샘플 데이터를 만든다(개발·데모·교육용)
 *         external — CODEF·팝빌·AI 등 외부 API (계약·API 키 필요)
 */
export const INTEGRATION_CHANNELS = ['bank', 'card', 'hometax', 'taxinvoice', 'ocr', 'ai'] as const;
export type IntegrationChannel = (typeof INTEGRATION_CHANNELS)[number];

export type ProviderKind = 'file' | 'mock' | 'external' | 'builtin';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface ProviderDefinition {
  key: string;
  label: string;
  kind: ProviderKind;
  description: string;
  credentials: CredentialField[];
  /** 정기 수집을 지원하는지(파일 업로드·AI 분류 등은 수집 주기가 없다) */
  schedulable: boolean;
}

export interface ChannelDefinition {
  key: IntegrationChannel;
  label: string;
  description: string;
  phase: string;
  defaultProvider: string;
  providers: ProviderDefinition[];
}

const FILE: ProviderDefinition = {
  key: 'file',
  label: '파일 업로드',
  kind: 'file',
  description:
    '은행·카드사·홈택스에서 내려받은 엑셀/CSV 파일을 올립니다. 별도 계약이 필요 없습니다.',
  credentials: [],
  schedulable: false,
};

const MOCK: ProviderDefinition = {
  key: 'mock',
  label: '모의 데이터',
  kind: 'mock',
  description: '실제 연동 없이 샘플 거래를 만들어 기능을 체험합니다(개발·데모용).',
  credentials: [],
  schedulable: true,
};

const CODEF: ProviderDefinition = {
  key: 'codef',
  label: 'CODEF API',
  kind: 'external',
  description:
    '은행·카드·홈택스 데이터를 자동 수집합니다. CODEF 사업자 계약과 API 키가 필요합니다.',
  credentials: [
    { key: 'clientId', label: 'Client ID', secret: false, required: true },
    { key: 'clientSecret', label: 'Client Secret', secret: true, required: true },
    {
      key: 'publicKey',
      label: 'RSA 공개키',
      secret: true,
      required: true,
      help: '기관 로그인 비밀번호 암호화용 (CODEF 콘솔에서 발급)',
    },
  ],
  schedulable: true,
};

const POPBILL: ProviderDefinition = {
  key: 'popbill',
  label: '팝빌 API',
  kind: 'external',
  description:
    '국세청 전자세금계산서 발행·홈택스 수집을 처리합니다. 팝빌 연동회원 가입이 필요합니다.',
  credentials: [
    { key: 'linkId', label: 'LinkID', secret: false, required: true },
    { key: 'secretKey', label: 'SecretKey', secret: true, required: true },
    {
      key: 'corpNum',
      label: '사업자번호',
      secret: false,
      required: true,
      placeholder: '1234567890',
    },
  ],
  schedulable: true,
};

export const INTEGRATIONS: ChannelDefinition[] = [
  {
    key: 'bank',
    label: '은행 입출금',
    description: '통장 거래내역을 가져와 입금·출금 전표를 자동으로 만듭니다.',
    phase: 'P2',
    defaultProvider: 'file',
    providers: [FILE, MOCK, CODEF],
  },
  {
    key: 'card',
    label: '법인카드',
    description: '카드 승인·청구 내역을 가져와 비용 전표를 자동으로 만듭니다.',
    phase: 'P2',
    defaultProvider: 'file',
    providers: [FILE, MOCK, CODEF],
  },
  {
    key: 'hometax',
    label: '홈택스 증빙',
    description: '전자세금계산서·현금영수증·카드매입 내역을 국세청 홈택스에서 가져옵니다.',
    phase: 'P2',
    defaultProvider: 'file',
    providers: [FILE, MOCK, CODEF, POPBILL],
  },
  {
    key: 'taxinvoice',
    label: '전자세금계산서 발행',
    description: '매출 세금계산서를 발행하고 국세청에 전송합니다.',
    phase: 'P2',
    defaultProvider: 'mock',
    providers: [
      { ...MOCK, description: '발행을 흉내만 냅니다(국세청 전송 없음).', schedulable: false },
      { ...POPBILL, schedulable: false },
    ],
  },
  {
    key: 'ocr',
    label: '영수증 인식(OCR)',
    description: '영수증 사진에서 날짜·금액·가맹점·사업자번호를 읽어 증빙으로 등록합니다.',
    phase: 'P2',
    defaultProvider: 'mock',
    providers: [
      { ...MOCK, description: '고정된 샘플 결과를 돌려줍니다(개발·데모용).', schedulable: false },
      {
        key: 'claude',
        label: 'Claude Vision',
        kind: 'external',
        description: 'Anthropic Claude 로 영수증 이미지를 읽습니다.',
        credentials: [{ key: 'apiKey', label: 'Anthropic API Key', secret: true, required: true }],
        schedulable: false,
      },
      {
        key: 'upstage',
        label: 'Upstage Document AI',
        kind: 'external',
        description: 'Upstage Document Parse + Information Extract 로 읽습니다.',
        credentials: [{ key: 'apiKey', label: 'Upstage API Key', secret: true, required: true }],
        schedulable: false,
      },
      {
        key: 'clova',
        label: '네이버 CLOVA OCR',
        kind: 'external',
        description: 'CLOVA OCR 영수증 특화 모델로 읽습니다.',
        credentials: [
          { key: 'invokeUrl', label: 'API Gateway Invoke URL', secret: false, required: true },
          { key: 'secretKey', label: 'Secret Key', secret: true, required: true },
        ],
        schedulable: false,
      },
    ],
  },
  {
    key: 'ai',
    label: 'AI 자동분개',
    description: '규칙·과거 이력으로 분류하지 못한 거래의 계정과목을 AI 가 추천합니다.',
    phase: 'P2',
    defaultProvider: 'rules',
    providers: [
      {
        key: 'rules',
        label: '규칙·이력만 사용',
        kind: 'builtin',
        description: '회사 규칙과 과거 분개 이력만으로 분류합니다(외부 전송 없음).',
        credentials: [],
        schedulable: false,
      },
      {
        key: 'claude',
        label: 'Claude AI',
        kind: 'external',
        description: '거래 내용을 Anthropic Claude 로 보내 계정과목·부가세 처리를 추천받습니다.',
        credentials: [{ key: 'apiKey', label: 'Anthropic API Key', secret: true, required: true }],
        schedulable: false,
      },
    ],
  },
];

export function getChannel(channel: string): ChannelDefinition | undefined {
  return INTEGRATIONS.find((c) => c.key === channel);
}

export function getProvider(channel: string, provider: string): ProviderDefinition | undefined {
  return getChannel(channel)?.providers.find((p) => p.key === provider);
}

/** 수집 주기 프리셋(크론). manual 은 버튼으로만 수집한다. */
export const SCHEDULE_PRESETS = {
  manual: { label: '수동', cron: null },
  hourly: { label: '매시간', cron: '0 * * * *' },
  daily: { label: '매일 오전 6시', cron: '0 6 * * *' },
} as const;
export type SchedulePreset = keyof typeof SCHEDULE_PRESETS;

export const UpdateIntegrationSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().min(1),
  /** 입력한 항목만 바뀐다. 빈 문자열은 기존 값을 유지한다. */
  credentials: z.record(z.string(), z.string().max(4000)).optional(),
  schedule: z.enum(['manual', 'hourly', 'daily']).optional(),
});
export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationSchema>;

export const IntegrationStatusSchema = z.object({
  channel: z.enum(INTEGRATION_CHANNELS),
  enabled: z.boolean(),
  provider: z.string(),
  /** 저장된 자격증명(비밀 값은 마스킹) */
  credentials: z.record(z.string(), z.string()),
  schedule: z.enum(['manual', 'hourly', 'daily']),
  lastStatus: z.enum(['success', 'error']).nullable(),
  lastMessage: z.string().nullable(),
  lastRunAt: z.iso.datetime().nullable(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const ConnectionTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;
