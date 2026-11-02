// End-to-end test: loads the unpacked extension in Chromium, mocks every
// external API (Anthropic, autocomplete, Wikimedia), and drives the full
// 3-step flow through the side panel UI.
// Run: npm run test:e2e   (screenshots go to test-results/)

const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '../extension');
const OUT = path.resolve(__dirname, '../test-results');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- Mock model outputs ---------- */

const POST_MD = `# 테스트 지원금 신청방법·대상·기간 총정리

테스트 지원금은 **2026년 11월 30일**까지 [정부24 신청 페이지](https://www.gov.kr/)에서 신청할 수 있습니다. 대상은 만 19세 이상 거주자이며, 신청 전 본인 인증 수단을 준비해 주세요.

## 핵심 요약

- 신청 기간: 2026년 11월 3일 ~ 11월 30일
- 지원 금액: 1인당 300,000원
- 신청처: 정부24 온라인 또는 주민센터 방문

## 신청 대상과 제외 조건

| 구분 | 내용 |
|---|---|
| 대상 | 만 19세 이상 거주자 |
| 제외 | 이미 같은 지원을 받은 경우 |

## 신청 방법

1. 정부24에 접속합니다.
2. 본인 인증을 진행합니다.
3. 신청서를 작성해 제출합니다.

## 준비물 체크리스트

- 신분증
- 본인 명의 계좌

## 주의사항

신청 기간이 지나면 접수할 수 없습니다. 문자로 온 링크는 누르지 말고 공식 사이트에서 직접 확인해 주세요.

## 마무리

지금 대상 여부를 확인하고 마감 전에 신청해 주세요.

## 자주 묻는 질문(FAQ)

### 기한이 지나면 어떻게 하나요?

추가 신청 일정이 발표되었는지 공식 공지를 확인해 주세요.

#테스트지원금 #지원금신청 #정부24

## 출처 및 확인 기준

- 행정안전부·공지: [정부24](https://www.gov.kr/) (2026-11-02 확인 기준)
`;

const RESPONSES = {
  source: `<source_check>{"has_material": true, "accessed_links": [], "failed_links": [], "topic": "테스트 지원금 신청 시작", "key_facts": ["11월 3일부터 신청"], "event_date": "", "report_date": "2026-11-01", "seeds": ["테스트 지원금", "테스트 지원금 신청"]}</source_check>`,
  titles: `<titles>${JSON.stringify({
    intent: '기사를 본 독자는 자신이 지원 대상인지, 어디서 어떻게 신청하는지, 마감이 언제인지 확인하려고 합니다.',
    titles: [
      { no: 1, title: '테스트 지원금 신청방법·대상·기간 총정리', problem: '신청 절차와 마감 확인', evidence: ['자동완성 확인', '검색 결과 확인'] },
      { no: 2, title: '테스트 지원금 대상 조회·제외 조건 한눈에 정리', problem: '내가 대상인지 확인', evidence: ['검색 결과 확인'] },
      { no: 3, title: '테스트 지원금 지급일·처리 기간·입금 확인 총정리', problem: '지급 시점 확인', evidence: ['검색 의도 추론'] },
      { no: 4, title: '테스트 지원금 신청 오류·접수 실패·문의처 총정리', problem: '신청이 안 될 때 해결', evidence: ['검색 의도 추론'] },
      { no: 5, title: '테스트 지원금 사칭 문자 구별법·주의사항 총정리', problem: '피싱 피해 예방', evidence: ['자동완성 확인'] },
    ],
    recommended: { no: 1, reason: '기사와 직접 연결되고 공식 신청 페이지로 확인할 수 있는 검색 의도입니다.' },
  })}</titles>`,
  post: `<notice></notice>
<final_title>테스트 지원금 신청방법·대상·기간 총정리</final_title>
<seo>{"main_keyword": "테스트 지원금", "related_keywords": ["신청방법", "대상", "기간"], "meta_description": "테스트 지원금 신청 대상과 기간, 정부24 신청 순서를 정리했습니다."}</seo>
<thumbnail>{"line1": "테스트 지원금", "line2": "신청방법·대상·기간", "visual_brief": "A smartphone showing a checklist next to a calendar and a coin.", "accent": "#2DD4BF", "alt": "테스트 지원금 신청 안내 썸네일"}</thumbnail>
<post>
${POST_MD}
</post>`,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" onload="alert(1)"><script>alert(1)</script><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1630"/><stop offset="1" stop-color="#1d3b74"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1000" cy="360" r="220" fill="#2DD4BF" opacity="0.25"/><rect x="880" y="190" width="220" height="360" rx="30" fill="#ffffff"/><rect x="910" y="250" width="160" height="22" rx="11" fill="#2DD4BF"/><rect x="910" y="300" width="130" height="22" rx="11" fill="#cbd5e1"/><rect x="910" y="350" width="150" height="22" rx="11" fill="#cbd5e1"/><text x="10" y="10">NO TEXT</text><image href="https://evil.example/x.png"/></svg>`,
  infoPlan: {
    items: [
      { heading: '신청 방법', question: '어떤 순서로 신청하나요?', kind: 'steps', title: '신청 3단계', points: [{ label: '정부24 접속', detail: '공식 사이트에서 직접 접속합니다' }, { label: '본인 인증', detail: '휴대폰 또는 인증서로 인증합니다' }, { label: '신청서 제출', detail: '작성 후 제출하면 접수가 완료됩니다' }], compare: { columns: [], rows: [] }, basis_date: '2026-11-02 확인 기준', source_note: '내용 근거: 행정안전부 공지', alt: '신청 3단계 순서' },
      { heading: '준비물 체크리스트', question: '무엇을 준비해야 하나요?', kind: 'checklist', title: '신청 준비물', points: [{ label: '신분증', detail: '본인 확인용' }, { label: '본인 명의 계좌', detail: '지원금 수령용' }, { label: '인증 수단', detail: '휴대폰 또는 인증서' }], compare: { columns: [], rows: [] }, basis_date: '', source_note: '', alt: '신청 준비물 체크리스트' },
      { heading: '신청 대상과 제외 조건', question: '내가 대상인가요?', kind: 'compare', title: '대상과 제외 비교', points: [], compare: { columns: ['대상', '제외'], rows: [['나이', '만 19세 이상', '해당 없음'], ['지원 이력', '처음 신청', '이미 받은 경우'], ['지원 금액', '1인당 300,000원', '-']] }, basis_date: '', source_note: '', alt: '지원 대상과 제외 조건 비교표' },
      { heading: '주의사항', question: '무엇을 조심해야 하나요?', kind: 'caution', title: '신청 전 주의사항', points: [{ label: '마감 후 접수 불가', detail: '11월 30일까지 신청해 주세요' }, { label: '문자 링크 주의', detail: '공식 사이트에서 직접 확인' }, { label: '수수료 요구 거절', detail: '신청 수수료 7,000원 요구는 사칭입니다' }], compare: { columns: [], rows: [] }, basis_date: '', source_note: '', alt: '신청 전 주의사항' },
    ],
  },
  photoPlan: {
    plans: [
      { heading: '신청 방법', purpose: '주민센터 창구 모습', queries: ['community service center Korea', 'government office counter', '주민센터'] },
      { heading: '준비물 체크리스트', purpose: '신분증과 통장', queries: ['bank passbook', 'identity card', '통장'] },
      { heading: '주의사항', purpose: '스마트폰 문자', queries: ['smartphone message', 'mobile phone sms', '스마트폰'] },
    ],
  },
};

function photoSelection(body) {
  // Pick the first candidate of the first two headings only -> shortfall of 2.
  const text = JSON.stringify(body.messages.at(-1).content);
  const ids = [...text.matchAll(/candidate_id: (c\d+)/g)].map((m) => m[1]);
  return {
    selections: [
      { heading: '신청 방법', candidate_id: ids[0], caption: '2019년 촬영 자료 사진 · 주민센터 민원 창구', alt: '주민센터 민원 창구', reason: '관련성 높음' },
      { heading: '준비물 체크리스트', candidate_id: ids[4] || ids[1], caption: '통장과 신분증 예시', alt: '통장과 신분증', reason: '관련성 높음' },
      { heading: '주의사항', candidate_id: '', caption: '', alt: '', reason: '개인정보가 보이는 화면' },
    ],
  };
}

/* ---------- SSE builder ---------- */

function sse(text, { withSearch = false, model = 'claude-opus-5-5' } = {}) {
  const out = [];
  const push = (type, data) => out.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  push('message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  let i = 0;
  if (withSearch) {
    push('content_block_start', { index: i, content_block: { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {} } });
    push('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: '{"query": "테스트 지원금 공식 공지"}' } });
    push('content_block_stop', { index: i });
    i++;
    push('content_block_start', { index: i, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: [] } });
    push('content_block_stop', { index: i });
    i++;
  }
  push('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
  for (let k = 0; k < text.length; k += 400) {
    push('content_block_delta', { index: i, delta: { type: 'text_delta', text: text.slice(k, k + 400) } });
  }
  push('content_block_stop', { index: i });
  push('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 500 } });
  push('message_stop', {});
  return out.join('');
}

function classify(body) {
  const last = body.messages.at(-1);
  const content = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  if (content.includes('[작업: 1단계 준비')) return 'source';
  if (content.includes('[작업: 1단계 — 검색형 제목')) return 'titles';
  if (content.includes('[작업: 2단계')) return 'post';
  if (content.includes('[작업: 썸네일 배경')) return 'svg';
  if (content.includes('인포그래픽 검수·수정')) return 'infoFix';
  if (content.includes('설명형 인포그래픽')) return 'infoPlan';
  if (content.includes('검색 계획')) return 'photoPlan';
  if (content.includes('실사진 선택·검수')) return 'photoSelect';
  return 'unknown';
}

function commonsResponse(url) {
  const q = new URL(url).searchParams.get('gsrsearch') || '';
  const base = Math.abs([...q].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 1000;
  const pages = {};
  for (let k = 0; k < 2; k++) {
    const id = base * 10 + k;
    pages[id] = {
      pageid: id, ns: 6, index: k + 1, title: `File:Sample ${q.replace(/ filetype:bitmap/, '')} ${k}.jpg`,
      imageinfo: [{
        url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/Sample_${id}.jpg`,
        thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Sample_${id}.jpg/1280px-Sample_${id}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Sample_${id}.jpg`,
        width: 3000, height: 2000, mime: 'image/jpeg',
        extmetadata: {
          LicenseShortName: { value: k === 1 && base % 2 ? 'CC BY-NC 2.0' : 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Tester">Tester</a>' },
          DateTimeOriginal: { value: '2019-05-01 10:00:00' },
          ImageDescription: { value: `<p>${q}</p>` },
        },
      }],
    };
  }
  return { batchcomplete: '', query: { pages } };
}

/* ---------- Test ---------- */

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bogard-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // the new headless mode, which can load extensions
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 440, height: 1000 },
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  console.log('extension id', extId);

  const calls = [];
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/photo.jpg'));

  await context.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const body = req.postDataJSON();
    const kind = classify(body);
    calls.push({ kind, body, headers: req.headers() });
    let text;
    if (kind === 'infoPlan' && body.messages[0].content.includes('이미 실사진이 배치되어')) {
      // Filling the photo shortfall: pick headings that have no photo yet.
      text = JSON.stringify({ items: [RESPONSES.infoPlan.items[2], { ...RESPONSES.infoPlan.items[0], heading: '핵심 요약', kind: 'summary', title: '한눈에 보는 핵심' }] });
    } else if (kind === 'infoPlan') text = JSON.stringify(RESPONSES.infoPlan);
    else if (kind === 'infoFix') {
      const fixed = JSON.parse(JSON.stringify(RESPONSES.infoPlan));
      fixed.items[3].points[2] = { label: '수수료 요구 거절', detail: '신청 수수료를 요구하면 사칭입니다' };
      text = JSON.stringify(fixed);
    } else if (kind === 'photoPlan') text = JSON.stringify(RESPONSES.photoPlan);
    else if (kind === 'photoSelect') text = JSON.stringify(photoSelection(body));
    else text = RESPONSES[kind] || 'unknown request';
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' },
      body: sse(text, { withSearch: kind === 'titles' || kind === 'post' }),
    });
  });
  await context.route('https://suggestqueries.google.com/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q').trim();
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([q, [`${q} 신청방법`, `${q} 대상`, `${q} 지급일`], [], [], {}]) });
  });
  await context.route('https://ac.search.naver.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"query":[],"items":[[]]}' }));
  await context.route('https://commons.wikimedia.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(commonsResponse(route.request().url())) }));
  await context.route('https://upload.wikimedia.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: photo }));

  const page = await context.newPage();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);

  // Settings open automatically without a key.
  await page.waitForSelector('#view-settings:not([hidden])');
  await page.fill('input[name="anthropicKey"]', 'sk-ant-test-key');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForSelector('#view-main:not([hidden])');

  // No material -> fixed guidance message, no API call.
  await page.click('#btn-titles');
  await page.waitForSelector('#assistant-message:not([hidden])');
  assert.match(await page.textContent('#assistant-message'), /기사 내용이나 링크를 보내주세요/);
  assert.equal(calls.length, 0);

  // Step 1
  await page.fill('#input-material', '정부가 11월 3일부터 테스트 지원금 신청을 받는다. 만 19세 이상 거주자가 대상이며 1인당 300,000원을 지급한다. 신청은 11월 30일까지 정부24에서 할 수 있다.');
  await page.click('#btn-titles');
  await page.waitForSelector('#card-titles:not([hidden]) .title-table', { timeout: 30000 });
  const rows = await page.$$('#card-titles tbody tr');
  assert.equal(rows.length, 5, 'five titles');
  assert.match(await page.textContent('#card-titles'), /원하시는 번호를 선택해 주세요/);
  assert.match(await page.textContent('#card-titles'), /테스트 지원금 신청방법/); // autocomplete evidence shown
  await page.screenshot({ path: path.join(OUT, '1-titles.png'), fullPage: true });

  // Request checks
  const src = calls.find((c) => c.kind === 'source');
  const tit = calls.find((c) => c.kind === 'titles');
  assert.equal(src.body.model, 'claude-opus-5-5');
  assert.equal(src.body.stream, true);
  assert.deepEqual(src.body.thinking, { type: 'adaptive' });
  assert.equal(src.body.system[0].cache_control.type, 'ephemeral');
  assert.match(src.body.system[0].text, /문제 해결형 SEO 검색 블로그 비서/);
  assert.match(src.body.system[0].text, /크롬 확장 프로그램 실행 환경/);
  assert.equal(src.body.fallbacks, 'default');
  assert.match(src.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
  assert.equal(src.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.deepEqual(tit.body.tools.map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
  assert.match(tit.body.messages.at(-1).content, /구글 \| 시드 "테스트 지원금" \| 테스트 지원금 신청방법/);
  assert.equal(tit.body.messages.length, 3, 'titles request continues the conversation');
  assert.equal(src.body.system[0].text, tit.body.system[0].text, 'system prompt is byte-stable for caching');

  // Step 2 via "추천으로 작성"
  await page.click('#card-titles [data-action="write-recommended"]');
  await page.waitForSelector('#card-post:not([hidden]) .post h1', { timeout: 30000 });
  await page.waitForSelector('#card-post .post-figure--thumbnail img', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#card-progress') || document.querySelector('#card-progress').hidden);
  const postText = await page.textContent('#card-post');
  assert.match(postText, /\[SEO 설정\]/);
  assert.match(postText, /핵심 키워드테스트 지원금/);
  assert.match(postText, /AI 제작 썸네일/);
  assert.match(postText, /본문에 넣을 이미지 4장도 준비해 드릴까요\?/);
  const order = await page.evaluate(() => {
    const post = document.querySelector('#card-post .post');
    const kids = [...post.children].map((n) => n.tagName + (n.classList.contains('post-figure') ? ':fig' : ''));
    return kids.slice(0, 3);
  });
  assert.deepEqual(order, ['H1', 'FIGURE:fig', 'P'], 'H1 → thumbnail → intro');
  const postCall = calls.find((c) => c.kind === 'post');
  assert.equal(postCall.body.output_config.effort, 'high');
  assert.equal(calls.filter((c) => c.kind === 'svg').length, 1);
  const thumbSrc = await page.getAttribute('#card-post .post-figure--thumbnail img', 'src');
  fs.writeFileSync(path.join(OUT, 'thumbnail.jpg'), Buffer.from(thumbSrc.split(',')[1], 'base64'));
  await page.screenshot({ path: path.join(OUT, '2-post.png'), fullPage: true });
  assert.equal(calls.filter((c) => /^(infoPlan|photoPlan)$/.test(c.kind)).length, 0, 'no body images before the user chooses');

  // Step 3a: infographics
  await page.click('#card-post [data-action="images"][data-dir="infographic"]');
  await page.waitForFunction(() => document.querySelectorAll('#card-post .post-figure--infographic').length === 4, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#card-progress').hidden);
  assert.equal(calls.filter((c) => c.kind === 'infoFix').length, 1, 'number proofreading triggered one fix round');
  const placed = await page.evaluate(() => [...document.querySelectorAll('#card-post .post-figure--infographic')].map((f) => f.previousElementSibling?.textContent));
  assert.deepEqual(placed.sort(), ['신청 대상과 제외 조건', '신청 방법', '주의사항', '준비물 체크리스트'].sort(), 'each image sits right under its H2');
  const infos = await page.$$eval('#card-post .post-figure--infographic img', (imgs) => imgs.map((i) => i.src));
  infos.forEach((src, i) => fs.writeFileSync(path.join(OUT, `infographic-${i + 1}.png`), Buffer.from(src.split(',')[1], 'base64')));
  await page.screenshot({ path: path.join(OUT, '3-infographics.png'), fullPage: true });

  // Step 3b: real photos with shortfall -> fill with infographics
  await page.click('#card-post [data-action="images"][data-dir="photo"]');
  await page.waitForSelector('#card-post [data-action="fill-shortfall"]', { timeout: 30000 });
  assert.match(await page.textContent('#card-post'), /실사진을 2장 확보했습니다\. 요청하신 4장 중 2장이 부족합니다/);
  const sel = calls.find((c) => c.kind === 'photoSelect');
  const imgBlocks = sel.body.messages[0].content.filter((b) => b.type === 'image');
  assert.ok(imgBlocks.length > 0, 'candidate previews sent for visual check');
  assert.ok(!JSON.stringify(sel.body).includes('BY-NC'), 'non-reusable license filtered out');
  assert.equal(await page.$$eval('#card-post .post-figure--photo', (f) => f.length), 2);
  assert.match(await page.textContent('#card-post .post-figure--photo figcaption'), /사진: Tester \/ Wikimedia Commons \/ CC BY-SA 4.0/);
  await page.click('#card-post [data-action="fill-shortfall"]');
  await page.waitForFunction(() => document.querySelectorAll('#card-post .post-figure--photo, #card-post .post-figure--infographic').length === 4, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#card-progress').hidden);
  const fillCall = calls.filter((c) => c.kind === 'infoPlan').at(-1);
  assert.match(fillCall.body.messages[0].content, /이미 실사진이 배치되어 있으니/);
  const mixedPlacement = await page.evaluate(() => [...document.querySelectorAll('#card-post .post-figure')]
    .filter((f) => !f.classList.contains('post-figure--thumbnail'))
    .map((f) => `${f.classList.contains('post-figure--photo') ? 'photo' : 'info'}@${f.previousElementSibling?.textContent}`));
  assert.deepEqual(mixedPlacement, ['info@핵심 요약', 'info@신청 대상과 제외 조건', 'photo@신청 방법', 'photo@준비물 체크리스트']);
  await page.screenshot({ path: path.join(OUT, '4-photos.png'), fullPage: true });

  // Export: markdown copy
  // Capture clipboard writes (permission grants don't apply to extension origins).
  await page.evaluate(() => {
    window.__clip = null;
    navigator.clipboard.writeText = async (t) => { window.__clip = t; };
    navigator.clipboard.write = async (items) => { window.__clipHtml = await (await items[0].getType('text/html')).text(); };
  });
  await page.click('#card-post [data-action="copy-md"]');
  await page.waitForFunction(() => typeof window.__clip === 'string');
  const clip = await page.evaluate(() => window.__clip);
  await page.click('#card-post [data-action="copy-html"]');
  await page.waitForFunction(() => typeof window.__clipHtml === 'string');
  const clipHtml = await page.evaluate(() => window.__clipHtml);
  assert.match(clipHtml, /<table style="border-collapse:collapse/);
  assert.match(clipHtml, /<figure class="post-figure post-figure--thumbnail" style=/);
  assert.match(clip, /!\[테스트 지원금 신청 안내 썸네일\]\(images\/01-thumbnail\.jpg\)/);
  assert.match(clip, /\n\*2019년 촬영 자료 사진 · [^*\n]+ · 사진: \[Tester\]\(https:\/\/commons\.wikimedia\.org/);

  // Session survives reload.
  await page.reload();
  await page.waitForSelector('#card-post:not([hidden]) .post-figure--thumbnail img');
  assert.equal(await page.$$eval('#card-post .post-figure', (f) => f.length), 5);

  // Wide view renders the table layout.
  const wide = await context.newPage();
  await wide.setViewportSize({ width: 1100, height: 900 });
  await wide.goto(`chrome-extension://${extId}/sidepanel.html?view=tab`);
  await wide.waitForSelector('#card-titles .title-table thead th');
  await wide.screenshot({ path: path.join(OUT, '5-wide.png'), fullPage: false });

  // Article extraction on a news-like page.
  const { extractArticleInPage } = await import('../extension/lib/extract.js');
  const news = await context.newPage();
  await news.setContent(`<html><head><title>뉴스</title><meta property="og:title" content="테스트 지원금 신청 시작"><meta property="article:published_time" content="2026-11-01T09:00:00+09:00"></head>
    <body><nav>메뉴 메뉴 메뉴</nav><div id="dic_area">${'정부가 테스트 지원금 신청을 받는다. '.repeat(30)}<script>var x=1</script><div class="ad">광고</div></div><footer>저작권</footer></body></html>`);
  const extracted = await news.evaluate(`(${extractArticleInPage.toString()})()`);
  assert.equal(extracted.pageTitle, '테스트 지원금 신청 시작');
  assert.equal(extracted.publishedAt, '2026-11-01T09:00:00+09:00');
  assert.ok(extracted.text.startsWith('정부가 테스트 지원금'));
  assert.ok(!extracted.text.includes('광고') && !extracted.text.includes('메뉴'));

  await context.close();
  console.log(`E2E passed. ${calls.length} mocked Claude requests. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
