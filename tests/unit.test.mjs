// Unit tests for the pure modules. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, extractHeadings, inline, normalizeHeading } from '../extension/lib/markdown.js';
import { extractTag, parseJsonLoose, parseTitles, parsePost, parseSourceCheck, stripCitationMarks } from '../extension/lib/parse.js';
import { parseGoogleSuggest, parseNaverSuggest } from '../extension/lib/keywords.js';
import { placeImages, buildPostHtml, buildMarkdownExport, bodyHeadings } from '../extension/lib/compose.js';
import { findUnsupportedNumbers } from '../extension/lib/infographic.js';
import { isReusableLicense } from '../extension/lib/photos.js';
import { formatAutocomplete } from '../extension/lib/prompts.js';
import { webTools } from '../extension/lib/claude.js';

const POST = `# 테스트 지원금 신청방법·대상·기간 총정리

테스트 지원금은 **2026년 11월 30일**까지 [공식 신청 페이지](https://example.go.kr/apply)에서 신청할 수 있습니다.

## 신청 대상과 제외 조건

| 구분 | 내용 |
|---|---|
| 대상 | 만 19세 이상 |
| 금액 | 1인당 300,000원 |

## 신청 방법

1. 공식 홈페이지 접속
2. 본인 인증
   - 휴대폰 인증
3. 신청서 제출

## 자주 묻는 질문(FAQ)

### 기한이 지나면 어떻게 하나요?

추가 신청 일정은 공식 공지를 확인해 주세요.

#테스트지원금 #신청방법

## 출처 및 확인 기준

- 기관·자료: [공지](https://example.go.kr/notice) (2026-11-02 확인 기준)
`;

test('markdown renders headings, tables, nested lists and links safely', () => {
  const html = renderMarkdown(POST);
  assert.match(html, /<h1>테스트 지원금/);
  assert.match(html, /<table><thead><tr><th>구분<\/th><th>내용<\/th><\/tr><\/thead><tbody><tr><td>대상<\/td>/);
  assert.match(html, /<ol><li>공식 홈페이지 접속<\/li><li>본인 인증<ul><li>휴대폰 인증<\/li><\/ul><\/li><li>신청서 제출<\/li><\/ol>/);
  assert.match(html, /<a href="https:\/\/example.go.kr\/apply" target="_blank" rel="noopener noreferrer">공식 신청 페이지<\/a>/);
  assert.match(html, /<strong>2026년 11월 30일<\/strong>/);
});

test('markdown escapes HTML and drops unsafe links', () => {
  const html = inline('<script>alert(1)</script> [x](javascript:alert(1)) ![a](javascript:x)');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.match(html, /&lt;script&gt;/);
});

test('bare URLs are autolinked once', () => {
  const html = inline('자세한 내용: https://example.com/a?b=1&c=2 참고');
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /href="https:\/\/example.com\/a\?b=1&amp;c=2"/);
});

test('headings extraction and body heading filter', () => {
  assert.deepEqual(extractHeadings(POST, 2), ['신청 대상과 제외 조건', '신청 방법', '자주 묻는 질문(FAQ)', '출처 및 확인 기준']);
  assert.deepEqual(bodyHeadings(POST), ['신청 대상과 제외 조건', '신청 방법']);
  assert.equal(normalizeHeading('신청 방법 · 절차?'), normalizeHeading('신청방법절차'));
});

test('tag extraction and loose JSON parsing', () => {
  assert.equal(extractTag('a <x>1</x> b <x>2</x>', 'x'), '2');
  assert.equal(extractTag('<post># 제목\n본문', 'post'), null);
  assert.equal(extractTag('<post># 제목\n본문', 'post', { allowOpen: true }), '# 제목\n본문');
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('설명 {"a":2} 끝'), { a: 2 });
  assert.equal(parseJsonLoose('not json'), null);
});

test('parseSourceCheck reads material flag and seeds', () => {
  const sc = parseSourceCheck('<source_check>{"has_material": false, "seeds": []}</source_check>');
  assert.equal(sc.hasMaterial, false);
  const ok = parseSourceCheck('<source_check>{"has_material": true, "topic": "t", "seeds": ["a b", "", "c"]}</source_check>');
  assert.deepEqual(ok.seeds, ['a b', 'c']);
});

test('parseTitles keeps 5 titles, valid evidence labels and a valid recommendation', () => {
  const titles = Array.from({ length: 6 }, (_, i) => ({ no: i + 1, title: `제목 ${i + 1}`, problem: 'p', evidence: ['자동완성 확인', '가짜 근거'] }));
  const res = parseTitles(`<titles>${JSON.stringify({ intent: '의도', titles, recommended: { no: 9, reason: 'r' } })}</titles>`);
  assert.equal(res.titles.length, 5);
  assert.deepEqual(res.titles[0].evidence, ['자동완성 확인']);
  assert.equal(res.recommended.no, 1); // invalid number falls back to the first title
});

test('parsePost extracts all sections and sanitizes thumbnail accent', () => {
  const text = `<notice>제목 전제를 바로잡았습니다.</notice>
<final_title>최종 제목</final_title>
<seo>{"main_keyword":"테스트 지원금","related_keywords":["신청방법","대상","기간","초과"],"meta_description":"설명"}</seo>
<thumbnail>{"line1":"테스트 지원금","line2":"신청방법·대상·기간","visual_brief":"x","accent":"red","alt":"썸네일"}</thumbnail>
<post>
${POST}
</post>`;
  const p = parsePost(text);
  assert.equal(p.notice, '제목 전제를 바로잡았습니다.');
  assert.equal(p.finalTitle, '최종 제목');
  assert.equal(p.seo.relatedKeywords.length, 3);
  assert.equal(p.thumbnail.accent, '#22C3A6');
  assert.match(p.markdown, /^# 테스트 지원금/);
});

test('citation marks are stripped but links kept', () => {
  assert.equal(stripCitationMarks('사실입니다【3】. 또 [1] 링크 [공지](https://a.b)'), '사실입니다. 또 [1] 링크 [공지](https://a.b)');
  assert.equal(stripCitationMarks('확인됩니다[2].'), '확인됩니다.');
});

test('autocomplete parsers', () => {
  assert.deepEqual(parseGoogleSuggest('["kt 해킹",["kt 해킹 피해 조회","kt 해킹 보상"],[],[],{}]'), ['kt 해킹 피해 조회', 'kt 해킹 보상']);
  assert.deepEqual(parseNaverSuggest('{"query":["a"],"items":[[["a 조회","0"],["a 신청","0"]]]}'), ['a 조회', 'a 신청']);
  const text = formatAutocomplete({ google: [{ seed: 's', suggestions: ['s 1'] }], naver: [{ seed: 's', suggestions: [], error: 'HTTP 500' }] });
  assert.match(text, /구글 \| 시드 "s" \| s 1/);
  assert.match(text, /네이버 \| 시드 "s" \| 조회 실패/);
});

test('images are placed under matching H2s, never under FAQ/sources', () => {
  const imgs = [
    { kind: 'infographic', heading: '신청 방법', dataUrl: 'data:image/png;base64,AAAA', alt: 'a' },
    { kind: 'infographic', heading: '없는 소제목', dataUrl: 'data:image/png;base64,BBBB', alt: 'b' },
  ];
  const placement = placeImages(POST, imgs);
  assert.deepEqual([...placement.keys()].sort(), [0, 1]);
  assert.equal(placement.get(1)[0].alt, 'a');
  assert.equal(placement.get(0)[0].alt, 'b');

  const html = buildPostHtml({ markdown: POST, thumbnail: { kind: 'thumbnail', dataUrl: 'data:image/jpeg;base64,CCCC', alt: '썸' }, images: imgs });
  const h1 = html.indexOf('</h1>');
  const thumb = html.indexOf('AI 제작 썸네일');
  const firstPara = html.indexOf('<p>');
  assert.ok(h1 < thumb && thumb < firstPara, 'thumbnail sits right under H1, before the intro');
  const h2Method = html.indexOf('<h2>신청 방법</h2>');
  assert.ok(html.indexOf('alt="a"') > h2Method && html.indexOf('alt="a"') < html.indexOf('<ol>'));
});

test('an image stays under its own heading even when that heading already has one', () => {
  const imgs = [
    { kind: 'photo', heading: '신청 방법', url: 'https://upload.wikimedia.org/a.jpg', alt: 'p' },
    { kind: 'infographic', heading: '신청 방법', dataUrl: 'data:image/png;base64,AA', alt: 'i' },
  ];
  const placement = placeImages(POST, imgs);
  assert.deepEqual([...placement.keys()], [1]);
  assert.deepEqual(placement.get(1).map((x) => x.alt), ['p', 'i']);
});

test('markdown export references image files in order', () => {
  const md = buildMarkdownExport({
    markdown: POST,
    thumbnail: { kind: 'thumbnail', dataUrl: 'data:image/jpeg;base64,AA', alt: '썸네일' },
    images: [{ kind: 'photo', heading: '신청 방법', url: 'https://upload.wikimedia.org/x/1280px-a.jpg', alt: '사진', caption: '설명', credit: { artist: '홍길동', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pageUrl: 'https://commons.wikimedia.org/wiki/File:a.jpg', source: 'Wikimedia Commons' } }],
  });
  assert.match(md, /# 테스트 지원금[^\n]*\n\n!\[썸네일\]\(images\/01-thumbnail.jpg\)\n\*AI 제작 썸네일\*/);
  assert.match(md, /## 신청 방법\n\n!\[사진\]\(images\/02-photo.jpg\)\n\*설명 · 사진: \[홍길동\]\(https:\/\/commons/);
});

test('number proofreading flags numbers missing from the post', () => {
  const spec = { title: '지원금 300,000원', question: '', points: [{ label: '마감 11월 30일', detail: '수수료 5%' }], compare: { columns: [], rows: [] } };
  assert.deepEqual(findUnsupportedNumbers(spec, POST), ['5']);
  assert.deepEqual(findUnsupportedNumbers({ ...spec, points: [] }, POST), []);
});

test('only freely reusable licenses are accepted', () => {
  for (const ok of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-US', 'CC BY-SA 3.0 de']) assert.ok(isReusableLicense(ok), ok);
  for (const bad of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'All rights reserved', 'GFDL', '']) assert.ok(!isReusableLicense(bad), bad);
});

test('web tool versions follow the model', () => {
  assert.deepEqual(webTools('claude-opus-5-5').map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
  assert.deepEqual(webTools('claude-sonnet-5-5').map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
  assert.deepEqual(webTools('claude-haiku-5-5').map((t) => t.type), ['web_search_20250305', 'web_fetch_20250910']);
});
