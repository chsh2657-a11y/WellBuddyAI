// Builds the system prompt and the per-step user messages.
// The system prompt is the user's spec (prompts/system-prompt.md) plus the
// extension's output contract (prompts/output-contract.md). Both are static
// files, so the system block is byte-stable and can be prompt-cached.
// Anything volatile (today's date, settings, article text) goes in the user
// messages, after the cached prefix.

let systemCache = null;

export async function loadSystemPrompt() {
  if (systemCache) return systemCache;
  const [spec, contract] = await Promise.all([
    fetch(chrome.runtime.getURL('prompts/system-prompt.md')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('prompts/output-contract.md')).then((r) => r.text()),
  ]);
  systemCache = `${spec.trim()}\n\n${contract.trim()}`;
  return systemCache;
}

export const NO_MATERIAL_MESSAGE =
  '기사 내용이나 링크를 보내주세요. 사람들이 검색할 만한 문제 해결형 제목 5개를 추천하고, 선택하시면 AI 썸네일 1장과 FAQ가 포함된 글로 완성해 드리겠습니다. 본문 이미지 4장은 글을 보신 뒤 원하는 방향으로 추가하실 수 있습니다.';

export const TITLE_CLOSING_MESSAGE =
  '원하시는 번호를 선택해 주세요. 선택이 어려우시면 ‘추천으로 작성’이라고 말씀해 주세요. AI 썸네일 1장과 FAQ를 포함한 포스팅을 먼저 완성해 드리겠습니다.';

export const IMAGE_QUESTION_MESSAGE =
  '본문에 넣을 이미지 4장도 준비해 드릴까요? 글을 이해하기 쉬운 ① 설명형 인포그래픽 ② 관련 실사진 ③ 두 가지를 섞은 구성 중 어떤 방향을 원하시나요?';

const PLATFORM_LABEL = {
  google: '구글 검색 (구글 자동완성·검색 결과 기준)',
  naver: '네이버 검색 (네이버 자동완성·검색 결과 기준)',
  both: '구글·네이버 모두',
};

export function todayKST(date = new Date()) {
  // YYYY-MM-DD in Asia/Seoul
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

function materialBlock(material) {
  const parts = [];
  if (material.pageTitle) parts.push(`페이지 제목: ${material.pageTitle}`);
  if (material.pageUrl) parts.push(`페이지 주소: ${material.pageUrl}`);
  if (material.publishedAt) parts.push(`페이지에 표시된 게시일: ${material.publishedAt}`);
  if (material.text) parts.push(material.text);
  return parts.join('\n');
}

export function sourceCheckMessage({ material, settings, today }) {
  return `[작업: 1단계 준비 — 입력 자료 확인]
오늘 날짜: ${today}
대상 플랫폼: ${PLATFORM_LABEL[settings.platform] || PLATFORM_LABEL.google}

아래 [입력 자료]를 확인해 주세요.
- 링크가 있으면 web_fetch로 원문을 읽어 주세요. 읽지 못한 링크는 failed_links에 넣어 주세요.
- 자료가 링크뿐인데 읽지 못했다면 web_search로 해당 기사·이슈를 확인해 주세요.
- 기사·자료·이슈로 볼 만한 내용이 전혀 없으면 has_material을 false로 해 주세요.

그 다음, 독자가 검색창에 입력할 만한 메인키워드 후보(시드) 3~5개를 정해 주세요. 시드는 자동완성 조회에 쓰이므로 2~4어절의 짧은 검색어로 씁니다.

출력은 아래 형식만 사용합니다.
<source_check>
{"has_material": true, "accessed_links": ["읽은 주소"], "failed_links": ["읽지 못한 주소"], "topic": "한 줄 주제", "key_facts": ["확인된 핵심 사실 3~6개"], "event_date": "사건 발생일 또는 빈 문자열", "report_date": "기사 보도일 또는 빈 문자열", "seeds": ["시드1", "시드2", "시드3"]}
</source_check>

[입력 자료]
${materialBlock(material)}`;
}

export function formatAutocomplete(data) {
  if (!data) return '(자동완성을 조회하지 않았습니다)';
  const lines = [];
  for (const engine of ['google', 'naver']) {
    const label = engine === 'google' ? '구글' : '네이버';
    for (const row of data[engine] || []) {
      if (row.error) {
        lines.push(`${label} | 시드 "${row.seed}" | 조회 실패 (${row.error})`);
      } else if (!row.suggestions.length) {
        lines.push(`${label} | 시드 "${row.seed}" | 결과 없음`);
      } else {
        lines.push(`${label} | 시드 "${row.seed}" | ${row.suggestions.join(' / ')}`);
      }
    }
  }
  return lines.length ? lines.join('\n') : '(자동완성 결과 없음)';
}

export function titlesMessage({ autocomplete, settings, today }) {
  return `[작업: 1단계 — 검색형 제목 5개 추천]
오늘 날짜: ${today}
대상 플랫폼: ${PLATFORM_LABEL[settings.platform] || PLATFORM_LABEL.google}

아래는 확장 프로그램이 이번에 직접 조회한 자동완성 결과입니다. 여기에 있는 표현만 ‘자동완성 확인’으로 표시할 수 있습니다.
<autocomplete>
${formatAutocomplete(autocomplete)}
</autocomplete>

필요하면 web_search로 실제 검색 결과를 확인해 주세요. 확인 근거는 사실대로 표시합니다.
이 단계에서는 본문과 이미지를 만들지 않습니다.

출력은 아래 형식만 사용합니다. titles는 정확히 5개입니다.
<titles>
{"intent": "독자가 해결하려는 문제 2~3문장", "titles": [{"no": 1, "title": "추천 제목", "problem": "해결할 문제", "evidence": ["자동완성 확인", "검색 결과 확인"]}], "recommended": {"no": 1, "reason": "기사 관련성·검색 의도 구체성·공식 자료 확보 여부를 기준으로 한 문장"}}
</titles>`;
}

function postFormatBlock(settings) {
  const thumb = settings.thumbnail === false
    ? '사용자가 썸네일 생략을 요청했습니다. <thumbnail>{}</thumbnail>처럼 빈 객체로 두세요.'
    : '썸네일 문구는 핵심 키워드와 정보 범위를 담은 짧은 한글 1~2줄입니다. 긴 제목 전체를 넣지 않고, 글에 없는 금액·혜택·기한은 넣지 않습니다.';
  return `옵션:
- 해시태그: ${settings.hashtagCount}개${Number(settings.hashtagCount) === 0 ? ' (생략)' : ''}
- 분량: ${settings.length || '공백 포함 약 1,800~3,000자'}
- ${thumb}

출력은 아래 태그 순서와 형식만 사용합니다.
<notice>본문 밖에서 짧게 알릴 내용(제목 전제 정정 이유, 접근하지 못한 공식 자료 등). 없으면 비워 둡니다.</notice>
<final_title>최종 H1 제목 (정정했다면 정정한 제목)</final_title>
<seo>
{"main_keyword": "메인키워드 1개", "related_keywords": ["연관·확장키워드 2~3개"], "meta_description": "자연스러운 1~2문장"}
</seo>
<thumbnail>
{"line1": "큰 글씨 문구(공백 포함 14자 이내)", "line2": "작은 글씨 문구(공백 포함 18자 이내, 없으면 빈 문자열)", "visual_brief": "글자가 없는 장면 묘사(영어 1~2문장, 핵심 대상과 해결할 문제를 상징하는 사물 중심)", "accent": "#RRGGBB 강조색", "alt": "썸네일 대체텍스트"}
</thumbnail>
<post>
# 최종 제목
(도입 → 필요한 경우 핵심 요약 → H2 중심 본문 → 짧은 마무리 → ## 자주 묻는 질문(FAQ) → 해시태그 한 줄 → ## 출처 및 확인 기준)
</post>`;
}

export function postMessage({ title, how, settings, today, material }) {
  const chosen = how === 'number'
    ? `사용자가 앞서 제안한 제목 중 하나를 선택했습니다: "${title}"`
    : how === 'recommended'
      ? `사용자가 ‘추천으로 작성’을 요청했습니다. 가장 추천한 제목으로 작성합니다: "${title}"`
      : how === 'auto'
        ? `사용자가 ‘알아서 골라서 작성’을 요청했습니다. 가장 추천한 제목으로 작성합니다: "${title}"`
        : `사용자가 제목을 직접 지정했습니다: "${title}"`;
  const materialPart = material
    ? `\n\n[입력 자료]\n${materialBlock(material)}`
    : '';
  return `[작업: 2단계 — 완성 포스팅 작성]
오늘 날짜: ${today}
대상 플랫폼: ${PLATFORM_LABEL[settings.platform] || PLATFORM_LABEL.google}
${chosen}

web_search·web_fetch로 최신 공식 정보(대상·조건·기간·비용·절차·공식 접수처·후속 발표)를 확인한 뒤 작성해 주세요. 제목의 전제가 사실과 다르면 제목을 바로잡고 <notice>에 이유를 짧게 적어 주세요.

${postFormatBlock(settings)}${materialPart}`;
}

export function reviseMessage({ request, settings, today }) {
  return `[작업: 포스팅 수정]
오늘 날짜: ${today}
사용자 요청: ${request}

요청을 반영해 수정한 전체 결과를 2단계와 같은 형식으로 다시 출력해 주세요. 필요한 사실 확인은 web_search·web_fetch로 다시 할 수 있습니다. 썸네일 문구를 바꿀 필요가 없으면 같은 값을 유지해 주세요.

${postFormatBlock(settings)}`;
}

function headingList(headings) {
  return headings.map((h) => `- ${h}`).join('\n');
}

export function infographicPlanMessage({ markdown, headings, count, today, avoid = [] }) {
  return `[작업: 3단계 — 설명형 인포그래픽 ${count}장 설계]
오늘 날짜: ${today}

아래 [완성 포스팅]을 바탕으로 서로 다른 주제의 설명형 인포그래픽 ${count}장을 설계해 주세요. 확장 프로그램이 설계 내용을 정확한 한글 글꼴로 그려 이미지로 만들고, heading으로 지정한 H2 소제목 바로 아래에 배치합니다.

규칙:
- heading은 [H2 목록]의 문구를 글자 그대로 하나 골라 씁니다. 이미지마다 서로 다른 소제목을 고릅니다.
- 이미지 하나는 질문 한 가지와 핵심 내용 3~5개에 집중합니다.
- 본문에서 확인한 사실만 씁니다. 숫자·날짜·금액·기관명은 본문 표기와 똑같이 씁니다. 미확인 보상·조건·기간·비용·절차를 만들지 않습니다.
- 권장 행동과 의무 사항, 예정과 시행 중인 내용을 구분해 씁니다.
- question: 이 이미지가 답하는 질문
- title: 짧은 한글 제목 (공백 포함 18자 이내)
- kind: summary(핵심 요약) / steps(순서) / checklist(체크리스트) / compare(비교) / caution(주의사항)
- points: kind가 compare가 아니면 3~5개. label은 14자 이내, detail은 45자 이내
- compare: kind가 compare일 때만 columns(2~3개)와 rows(3~5행, 각 행은 첫 칸 항목명 + columns 수만큼의 값)를 채우고, 아니면 빈 배열로 둡니다.
- basis_date: 변동 가능한 정보가 있으면 "${today} 확인 기준" 같은 확인 기준일, 없으면 빈 문자열
- source_note: 공식 자료를 바탕으로 했다면 "내용 근거: 기관명·자료명", 없으면 빈 문자열
- alt: 이미지 내용을 설명하는 짧은 대체텍스트 (키워드 반복 금지)
${avoid.length ? `- 다음 소제목에는 이미 실사진이 배치되어 있으니 가능하면 다른 소제목을 고릅니다: ${avoid.join(' / ')}\n` : ''}
[H2 목록]
${headingList(headings)}

[완성 포스팅]
${markdown}`;
}

export function infographicFixMessage({ plan, issues, markdown, headings }) {
  const list = issues.map((x) => `- ${x.i + 1}번째 「${x.title}」: ${x.missing.join(', ')}`).join('\n');
  return `[작업: 3단계 — 인포그래픽 검수·수정]
아래 [설계]를 본문과 대조했더니, 본문에서 확인되지 않는 숫자가 있었습니다.
${list}

본문 표기와 일치하도록 고치거나, 본문에 근거가 없는 숫자는 빼 주세요. 문제가 없는 항목은 그대로 둡니다. 같은 형식으로 설계 전체를 다시 출력해 주세요. heading은 [H2 목록]의 문구를 글자 그대로 씁니다.

[설계]
${JSON.stringify(plan)}

[H2 목록]
${headingList(headings)}

[완성 포스팅]
${markdown}`;
}

export function photoPlanMessage({ markdown, headings, count, today }) {
  return `[작업: 3단계 — 관련 실사진 ${count}장 검색 계획]
오늘 날짜: ${today}

확장 프로그램이 위키미디어 공용(Wikimedia Commons)에서 재사용 가능한 실제 촬영 사진을 검색합니다. [H2 목록] 중 실제 대상·장소·사물을 보여주면 이해를 돕는 소제목을 ${count + 2}개까지 고르고(앞쪽이 우선), 각 소제목에 맞는 검색어를 정해 주세요.

규칙:
- heading은 [H2 목록]의 문구를 글자 그대로 씁니다. FAQ·출처 소제목은 고르지 않습니다.
- queries: 위키미디어 공용 검색용 짧은 검색어 3개 (영어 2개 + 한국어 1개). 사물·장소·기관 건물처럼 사진으로 존재할 만한 대상으로 씁니다.
- purpose: 이 사진이 독자에게 보여줄 내용 한 문장
- 사람 얼굴 클로즈업, 개인정보가 보이는 화면, 사건·피해 현장은 피합니다.

[H2 목록]
${headingList(headings)}

[완성 포스팅]
${markdown}`;
}

export function photoSelectIntro({ today }) {
  return `[작업: 3단계 — 실사진 선택·검수]
오늘 날짜: ${today}

아래는 확장 프로그램이 위키미디어 공용에서 검색한 소제목별 후보 사진입니다. 각 후보에는 미리보기 이미지와 파일 정보(설명·촬영일·작성자·라이선스)가 붙어 있습니다.

각 소제목마다 가장 적합한 사진 하나의 candidate_id를 고르고, 적합한 사진이 없으면 candidate_id를 빈 문자열로 둡니다.
선택 기준:
- 본문 내용과 직접 관련된 실제 촬영 사진 (일러스트·도표·로고·지도·스크린숏 제외)
- 개인정보가 보이는 화면이나 식별 가능한 사람 얼굴 클로즈업 제외
- 같은 사진을 두 번 고르지 않음
- 촬영일이 오래되었으면 caption에 "2019년 촬영 자료 사진"처럼 과거 자료임을 표시하고, 현재 사건 현장처럼 소개하지 않음
- caption: 짧은 한국어 설명 (출처·라이선스 표기는 프로그램이 따로 붙임)
- alt: 사진 내용을 설명하는 짧은 대체텍스트
- reason: 선택 또는 제외 이유 한 문장`;
}

export function thumbnailSvgMessage({ spec }) {
  return `[작업: 썸네일 배경 일러스트 제작]
가로 1280, 세로 720 크기의 SVG 일러스트 하나를 만들어 주세요. 이 그림은 블로그 썸네일 배경이며, 확장 프로그램이 왼쪽 영역에 한글 문구를 따로 얹습니다.

조건:
- viewBox="0 0 1280 720", width="1280", height="720"
- 글자·숫자·로고·워터마크를 넣지 않습니다.
- 왼쪽 약 55% 영역은 문구가 올라가므로 단순하고 어두운 배경(진한 남색·먹색 계열 그라데이션)으로 비워 둡니다.
- 오른쪽 영역에 핵심 대상과 해결할 문제를 상징하는 깔끔한 플랫 일러스트를 크게 배치합니다.
- 장면: ${spec.visual_brief || '주제를 상징하는 사물'}
- 강조색: ${spec.accent || '#22C3A6'}
- 실제 사건 사진, 공식 공지, 기관 로고, 앱 화면처럼 보이지 않게 합니다. 공포스럽거나 과장된 표현을 피합니다.
- <script>, <foreignObject>, 외부 이미지·글꼴 참조, 이벤트 속성을 쓰지 않습니다.

SVG 코드만 출력해 주세요.`;
}

export function imageModelPrompt(spec) {
  return [
    'Wide 16:9 blog thumbnail background illustration, clean modern editorial illustration style (not a photograph).',
    `Scene: ${spec.visual_brief || 'objects that symbolize the topic'}.`,
    'Composition: place the main subject large on the right half; keep the left half calm, uncluttered and dark navy so a headline can be overlaid later.',
    `Accent color: ${spec.accent || '#22C3A6'}. Strong contrast, generous whitespace, readable at small sizes.`,
    'Absolutely no text, letters, numbers, logos, watermarks, UI screenshots, official documents or real people. Not fear-inducing.',
  ].join(' ');
}
