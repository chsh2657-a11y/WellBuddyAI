// 보가드 SEO 블로그 비서 — side panel controller.
// Step 1: material → source check → real autocomplete → 5 titles (+ recommendation)
// Step 2: chosen title → research + full post (SEO, FAQ, hashtags, sources) → AI thumbnail
// Step 3: user-chosen direction → body images placed under their H2s

import { createClient, runTurn, runJson, describeError, webTools, MODELS } from './lib/claude.js';
import * as P from './lib/prompts.js';
import { parseSourceCheck, parseTitles, parsePost, extractTag } from './lib/parse.js';
import { collectAutocomplete, countSuggestions } from './lib/keywords.js';
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, loadSession, saveSession, clearSession, takePendingInput,
} from './lib/storage.js';
import { extractArticleInPage, describeInput } from './lib/extract.js';
import { renderMarkdown, escapeHtml } from './lib/markdown.js';
import { generateThumbnail, PROVIDER_LABEL } from './lib/thumbnail.js';
import { INFOGRAPHIC_SCHEMA, renderInfographic, findUnsupportedNumbers } from './lib/infographic.js';
import {
  PHOTO_PLAN_SCHEMA, PHOTO_SELECT_SCHEMA, gatherCandidates, buildSelectionContent, photoCredit,
} from './lib/photos.js';
import {
  buildPostHtml, buildMarkdownExport, standaloneHtml, orderedImages, bodyHeadings,
} from './lib/compose.js';

const $ = (sel, root = document) => root.querySelector(sel);
const VIEW = new URLSearchParams(location.search).get('view'); // 'tab' | 'settings' | null
const INSTANCE = Math.random().toString(36).slice(2);

let settings = { ...DEFAULT_SETTINGS };
let session = newSession();
let running = null; // AbortController of the current job

function newSession() {
  return {
    stage: 'input', // input | titles | post | images
    inputText: '',
    grabbed: null,
    material: null,
    messages: [],
    sourceCheck: null,
    autocomplete: null,
    titles: null,
    chosen: null,
    post: null,
    thumbnail: null,
    thumbnailNote: '',
    thumbnailError: '',
    bodyImages: [],
    imageDirection: null,
    imageNotes: [],
    shortfall: null,
    model: null,
  };
}

function persist(immediate = false) {
  session.inputText = $('#input-material').value;
  return saveSession({ ...session, instance: INSTANCE, savedAt: Date.now() }, { immediate });
}

/* ---------------- UI helpers ---------------- */

function log(text) {
  const li = document.createElement('li');
  li.textContent = text;
  $('#progress-log').append(li);
  li.scrollIntoView({ block: 'nearest' });
}

function setProgressTitle(text) {
  $('#progress-title').textContent = text;
}

function showProgress(title) {
  $('#progress-log').replaceChildren();
  $('#stream-preview').hidden = true;
  $('#stream-preview').replaceChildren();
  setProgressTitle(title);
  $('#card-progress').hidden = false;
  $('#card-progress').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function hideProgress() {
  $('#card-progress').hidden = true;
}

function addAlert(message, kind = 'info', actions = []) {
  const node = $('#tpl-alert').content.firstElementChild.cloneNode(true);
  if (kind === 'warn') node.classList.add('notice--warn');
  if (kind === 'error') node.classList.add('notice--error');
  $('.notice-body', node).textContent = message;
  const close = { label: '닫기', run: () => node.remove() };
  for (const a of [...actions, close]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    if (a.primary) b.className = 'primary';
    b.addEventListener('click', () => { node.remove(); if (a !== close) a.run(); });
    $('.notice-actions', node).append(b);
  }
  $('#alerts').append(node);
  node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return node;
}

function clearAlerts() {
  $('#alerts').replaceChildren();
}

function toast(message) {
  const node = addAlert(message, 'info');
  setTimeout(() => node.remove(), 3500);
}

function showAssistant(text) {
  const el = $('#assistant-message');
  el.textContent = text;
  el.hidden = !text;
}

function setBusy(busy) {
  document.querySelectorAll('[data-busy-disable], #btn-titles, #btn-auto, #btn-write-direct, #btn-grab, #btn-new')
    .forEach((b) => { b.disabled = busy; });
  document.querySelectorAll('#card-titles button, #card-post button[data-action]:not([data-action^="copy"]):not([data-action^="save"])')
    .forEach((b) => { b.disabled = busy; });
}

function requireKey() {
  if (settings.anthropicKey) return true;
  $('#setup-banner').hidden = false;
  openSettings(true);
  return false;
}

function download(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one job with progress UI, error reporting and cancellation. */
async function withRun(title, fn) {
  if (running) return false;
  running = new AbortController();
  const { signal } = running;
  showAssistant('');
  showProgress(title);
  setBusy(true);
  let ok = false;
  try {
    await fn(signal);
    ok = true;
  } catch (err) {
    console.error(err);
    if (signal.aborted) addAlert('작업을 중지했습니다.', 'warn');
    else addAlert(describeError(err), 'error');
  } finally {
    running = null;
    hideProgress();
    setBusy(false);
    await persist(true);
    renderAll();
  }
  return ok;
}

function makeStreamPreview() {
  const el = $('#stream-preview');
  let last = 0;
  let timer = null;
  let latest = '';
  const draw = () => {
    const md = extractTag(latest, 'post', { allowOpen: true });
    if (!md) return;
    el.hidden = false;
    el.innerHTML = renderMarkdown(md);
    el.scrollTop = el.scrollHeight;
  };
  return (full) => {
    latest = full;
    const now = Date.now();
    clearTimeout(timer);
    if (now - last > 350) { last = now; draw(); } else timer = setTimeout(draw, 350);
  };
}

/* ---------------- Material ---------------- */

function buildMaterial() {
  const text = $('#input-material').value.trim();
  const g = session.grabbed;
  if (g && text && g.text && text.slice(0, 60) === g.text.trim().slice(0, 60)) {
    return { text, pageUrl: g.pageUrl || '', pageTitle: g.pageTitle || '', publishedAt: g.publishedAt || '' };
  }
  return { text };
}

function applyGrab(r, sourceLabel = '현재 탭') {
  const text = (r.selection || r.text || '').trim();
  if (!text) {
    $('#grab-info').textContent = '페이지에서 본문을 찾지 못했습니다. 기사 내용을 복사해 붙여 넣어 주세요.';
    return;
  }
  session.grabbed = { text, pageUrl: r.pageUrl || '', pageTitle: r.pageTitle || '', publishedAt: r.publishedAt || '' };
  $('#input-material').value = text;
  $('#grab-info').textContent = `${sourceLabel}: 「${(r.pageTitle || '제목 없음').slice(0, 40)}」 ${text.length.toLocaleString()}자를 가져왔습니다.`;
  persist();
}

async function grabCurrentTab() {
  $('#grab-permission').hidden = true;
  if (VIEW === 'tab' || VIEW === 'settings') {
    $('#grab-info').textContent = '넓게 보기 화면에서는 사용할 수 없습니다. 기사 페이지의 사이드패널이나 오른쪽 클릭 메뉴를 이용해 주세요.';
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractArticleInPage });
    applyGrab(res?.result || {});
  } catch {
    const hasAll = await chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] });
    if (hasAll) {
      $('#grab-info').textContent = '이 페이지는 읽을 수 없습니다(브라우저 내부 페이지 등). 기사 내용을 복사해 붙여 넣어 주세요.';
    } else {
      $('#grab-permission').hidden = false;
    }
  }
}

/* ---------------- Step 1: titles ---------------- */

async function startTitles({ auto = false } = {}) {
  if (!requireKey()) return;
  const material = buildMaterial();
  if (!material.text) {
    showAssistant(P.NO_MATERIAL_MESSAGE);
    return;
  }
  const grabbed = session.grabbed;
  session = newSession();
  session.grabbed = grabbed;
  session.material = material;
  clearAlerts();
  renderAll();

  const ok = await withRun('입력 자료를 확인하고 있습니다', async (signal) => {
    const client = createClient(settings.anthropicKey);
    const system = await P.loadSystemPrompt();
    const today = P.todayKST();
    const { links } = describeInput(material.text);
    const useTools = links.length > 0 || material.text.length < 800;

    const m0 = { role: 'user', content: P.sourceCheckMessage({ material, settings, today }) };
    log(useTools ? '자료를 확인합니다 (링크·짧은 이슈는 원문과 검색으로 확인)' : '붙여 넣은 기사 내용을 확인합니다');
    const r0 = await runTurn({
      client, model: settings.model, effort: 'low', system, messages: [m0],
      tools: useTools ? webTools(settings.model) : undefined, onStatus: log, signal,
    });
    const sc = parseSourceCheck(r0.text);
    if (!sc) throw new Error('자료 확인 결과를 읽지 못했습니다. 다시 시도해 주세요.');
    if (!sc.hasMaterial) {
      session = newSession();
      showAssistant(P.NO_MATERIAL_MESSAGE);
      return;
    }
    session.messages.push(m0, ...r0.assistantMessages);
    session.sourceCheck = sc;
    if (sc.topic) log(`주제: ${sc.topic}`);
    if (sc.failedLinks.length) log(`읽지 못한 링크: ${sc.failedLinks.join(', ')}`);

    setProgressTitle('자동완성 검색어를 수집하고 있습니다');
    const seeds = sc.seeds.length ? sc.seeds : [sc.topic].filter(Boolean);
    log(`시드 검색어: ${seeds.join(', ')}`);
    const ac = await collectAutocomplete(seeds, settings.platform, signal);
    session.autocomplete = ac;
    const cnt = countSuggestions(ac);
    const parts = [];
    if (settings.platform !== 'naver') parts.push(`구글 ${cnt.google}개`);
    if (settings.platform !== 'google') parts.push(`네이버 ${cnt.naver}개`);
    log(`자동완성 수집: ${parts.join(' · ')}`);

    setProgressTitle('검색 의도를 분석하고 제목을 고르고 있습니다');
    const m1 = { role: 'user', content: P.titlesMessage({ autocomplete: ac, settings, today }) };
    const r1 = await runTurn({
      client, model: settings.model, effort: 'medium', system,
      messages: [...session.messages, m1], tools: webTools(settings.model), onStatus: log, signal,
    });
    const titles = parseTitles(r1.text);
    if (!titles) throw new Error('제목 추천 결과를 읽지 못했습니다. 다시 시도해 주세요.');
    session.messages.push(m1, ...r1.assistantMessages);
    session.titles = titles;
    session.model = settings.model;
    session.stage = 'titles';
  });

  if (ok && auto && session.titles) {
    const rec = session.titles.titles.find((t) => t.no === session.titles.recommended.no);
    if (rec) await startPost({ title: rec.title, how: 'auto' });
  }
}

/* ---------------- Step 2: post ---------------- */

async function startPost({ title, how }) {
  if (!requireKey()) return;
  title = String(title || '').trim();
  if (!title) return;
  if (how === 'custom' && !session.titles) {
    // Writing directly from a user-given title: start a fresh conversation.
    const material = buildMaterial();
    const grabbed = session.grabbed;
    session = newSession();
    session.grabbed = grabbed;
    session.material = material.text ? material : null;
  }
  session.chosen = { title, how };
  session.post = null;
  session.thumbnail = null;
  session.thumbnailError = '';
  session.thumbnailNote = '';
  session.bodyImages = [];
  session.imageNotes = [];
  session.shortfall = null;
  session.imageDirection = null;
  clearAlerts();
  renderAll();

  const ok = await withRun('최신 공식 정보를 확인하고 포스팅을 작성하고 있습니다', async (signal) => {
    const client = createClient(settings.anthropicKey);
    const system = await P.loadSystemPrompt();
    const today = P.todayKST();
    const material = session.messages.length === 0 ? session.material : null;
    const m = { role: 'user', content: P.postMessage({ title, how, settings, today, material }) };
    log(`선택한 제목: ${title}`);
    const preview = makeStreamPreview();
    const r = await runTurn({
      client, model: settings.model, effort: settings.effort, system,
      messages: [...session.messages, m], tools: webTools(settings.model),
      onText: (_, full) => preview(full), onStatus: log, signal,
    });
    const post = parsePost(r.text);
    if (!post) throw new Error('완성 포스팅을 읽지 못했습니다. 다시 시도해 주세요.');
    session.messages.push(m, ...r.assistantMessages);
    session.post = post;
    session.model = settings.model;
    session.stage = 'post';
    await persist(true);
    renderAll();
    await makeThumbnail({ client, system, signal });
  });

  if (ok && session.post && settings.imagePreset !== 'ask') {
    await startImages(settings.imagePreset);
  }
}

async function makeThumbnail({ client, system, signal }) {
  const spec = session.post?.thumbnail;
  if (settings.thumbnail === false || !spec) {
    session.thumbnail = null;
    return;
  }
  setProgressTitle('AI 썸네일을 만들고 있습니다');
  $('#stream-preview').hidden = true;
  try {
    const res = await generateThumbnail({ client, settings, system, spec, signal, onStatus: log });
    session.thumbnail = { kind: 'thumbnail', dataUrl: res.dataUrl, alt: spec.alt, provider: res.provider, spec: { ...spec } };
    session.thumbnailNote = res.note || '';
    session.thumbnailError = '';
  } catch (err) {
    if (signal.aborted) throw err;
    session.thumbnail = null;
    session.thumbnailError = describeError(err);
  }
  await persist(true);
  renderAll();
}

async function retryThumbnail() {
  if (!requireKey() || !session.post) return;
  await withRun('AI 썸네일을 다시 만들고 있습니다', async (signal) => {
    const client = createClient(settings.anthropicKey);
    const system = await P.loadSystemPrompt();
    await makeThumbnail({ client, system, signal });
  });
}

async function revisePost(request) {
  if (!requireKey() || !session.post || !request.trim()) return;
  await withRun('수정 요청을 반영하고 있습니다', async (signal) => {
    const client = createClient(settings.anthropicKey);
    const system = await P.loadSystemPrompt();
    const today = P.todayKST();
    const m = { role: 'user', content: P.reviseMessage({ request: request.trim(), settings, today }) };
    const preview = makeStreamPreview();
    const r = await runTurn({
      client, model: settings.model, effort: settings.effort, system,
      messages: [...session.messages, m], tools: webTools(settings.model),
      onText: (_, full) => preview(full), onStatus: log, signal,
    });
    const post = parsePost(r.text);
    if (!post) throw new Error('수정한 포스팅을 읽지 못했습니다. 다시 시도해 주세요.');
    session.messages.push(m, ...r.assistantMessages);
    const old = session.thumbnail?.spec;
    session.post = post;
    renderAll();
    const copyChanged = !old || !post.thumbnail || old.line1 !== post.thumbnail.line1 || old.line2 !== post.thumbnail.line2;
    if (copyChanged) await makeThumbnail({ client, system, signal });
    else if (session.thumbnail) session.thumbnail.alt = post.thumbnail.alt || session.thumbnail.alt;
  });
}

/* ---------------- Step 3: body images ---------------- */

function imageCount() {
  const n = Number(settings.bodyImageCount);
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.round(n)) : 4;
}

async function addInfographics(n, avoid, { client, system, signal, today }) {
  const md = session.post.markdown;
  const headings = bodyHeadings(md);
  if (!headings.length) throw new Error('이미지를 배치할 H2 소제목이 없습니다.');
  setProgressTitle(`설명형 인포그래픽 ${n}장을 설계하고 있습니다`);
  let plan = await runJson({
    client, model: settings.model, effort: 'medium', system,
    content: P.infographicPlanMessage({ markdown: md, headings, count: n, today, avoid }),
    schema: INFOGRAPHIC_SCHEMA, onStatus: log, signal,
  });
  let items = (plan.items || []).slice(0, n);

  // Proofread numbers against the post; one correction round if needed.
  const issues = items
    .map((spec, i) => ({ i, title: spec.title, missing: findUnsupportedNumbers(spec, md, [spec.basis_date, today]) }))
    .filter((x) => x.missing.length);
  if (issues.length) {
    log('인포그래픽 숫자를 본문과 대조해 수정합니다');
    plan = await runJson({
      client, model: settings.model, effort: 'medium', system,
      content: P.infographicFixMessage({ plan: { items }, issues, markdown: md, headings }),
      schema: INFOGRAPHIC_SCHEMA, onStatus: log, signal,
    });
    items = (plan.items || items).slice(0, n);
  }

  for (const [i, spec] of items.entries()) {
    log(`인포그래픽 ${i + 1}/${items.length} 그리는 중: ${spec.title}`);
    const dataUrl = await renderInfographic(spec);
    const missing = findUnsupportedNumbers(spec, md, [spec.basis_date, today]);
    if (missing.length) {
      session.imageNotes.push(`인포그래픽 「${spec.title}」의 숫자(${missing.join(', ')})가 본문에서 확인되지 않았습니다. 게시 전에 확인해 주세요.`);
    }
    session.bodyImages.push({
      kind: 'infographic', heading: spec.heading, dataUrl, alt: spec.alt || spec.title, sourceNote: spec.source_note || '', spec,
    });
    renderAll();
  }
  if (items.length < n) session.imageNotes.push(`인포그래픽 ${n}장 중 ${items.length}장만 만들었습니다.`);
  return items.length;
}

async function addPhotos(n, { client, system, signal, today }) {
  const md = session.post.markdown;
  const headings = bodyHeadings(md);
  if (!headings.length) throw new Error('이미지를 배치할 H2 소제목이 없습니다.');
  setProgressTitle(`관련 실사진 ${n}장을 찾고 있습니다`);
  const plan = await runJson({
    client, model: settings.model, effort: 'low', system,
    content: P.photoPlanMessage({ markdown: md, headings, count: n, today }),
    schema: PHOTO_PLAN_SCHEMA, onStatus: log, signal,
  });
  const groups = await gatherCandidates((plan.plans || []).slice(0, n + 2), { perHeading: 4, signal, onStatus: log });
  const withCandidates = groups.filter((g) => g.candidates.length);
  const chosen = [];
  if (withCandidates.length) {
    setProgressTitle('후보 사진의 관련성·이용 조건을 검수하고 있습니다');
    const content = await buildSelectionContent(P.photoSelectIntro({ today }), withCandidates, signal);
    const sel = await runJson({
      client, model: settings.model, effort: 'medium', system, content,
      schema: PHOTO_SELECT_SCHEMA, onStatus: log, signal,
    });
    const byId = new Map(withCandidates.flatMap((g) => g.candidates.map((c) => [c.id, { c, g }])));
    const usedHeadings = new Set();
    for (const s of sel.selections || []) {
      if (chosen.length >= n) break;
      const hit = byId.get(s.candidate_id);
      if (!hit || usedHeadings.has(hit.g.heading)) continue;
      usedHeadings.add(hit.g.heading);
      chosen.push({
        kind: 'photo', heading: hit.g.heading, url: hit.c.displayUrl, alt: s.alt || hit.c.title,
        caption: s.caption || '', credit: photoCredit(hit.c), date: hit.c.date,
      });
    }
  }
  session.bodyImages.push(...chosen);
  log(`재사용 가능한 실사진 ${chosen.length}장 확보`);
  if (chosen.length < n) {
    session.shortfall = { requested: n, found: chosen.length, missing: n - chosen.length };
  }
  renderAll();
  return chosen.length;
}

async function startImages(direction) {
  if (!requireKey() || !session.post) return;
  const total = imageCount();
  session.imageDirection = direction;
  session.bodyImages = [];
  session.imageNotes = [];
  session.shortfall = null;
  clearAlerts();
  renderAll();
  await withRun('본문 이미지를 준비하고 있습니다', async (signal) => {
    const ctx = {
      client: createClient(settings.anthropicKey),
      system: await P.loadSystemPrompt(),
      signal,
      today: P.todayKST(),
    };
    if (direction === 'photo') {
      await addPhotos(total, ctx);
    } else if (direction === 'mixed') {
      const nPhoto = Math.floor(total / 2);
      const nInfo = total - nPhoto;
      await addPhotos(nPhoto, ctx);
      await addInfographics(nInfo, session.bodyImages.map((b) => b.heading), ctx);
    } else {
      await addInfographics(total, [], ctx);
    }
    session.stage = 'images';
  });
}

async function fillShortfallWithInfographics() {
  const missing = session.shortfall?.missing;
  if (!missing || !requireKey()) return;
  await withRun(`부족한 ${missing}장을 인포그래픽으로 만들고 있습니다`, async (signal) => {
    const ctx = {
      client: createClient(settings.anthropicKey),
      system: await P.loadSystemPrompt(),
      signal,
      today: P.todayKST(),
    };
    await addInfographics(missing, session.bodyImages.map((b) => b.heading), ctx);
    session.shortfall = null;
    session.stage = 'images';
  });
}

/* ---------------- Export ---------------- */

function postParts() {
  return { markdown: session.post.markdown, thumbnail: session.thumbnail, images: session.bodyImages };
}

async function copyHtml() {
  const html = buildPostHtml({ ...postParts(), inlineStyle: true });
  const md = buildMarkdownExport(postParts());
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([md], { type: 'text/plain' }),
      }),
    ]);
    toast('서식 포함 본문을 복사했습니다. 블로그 편집기에 붙여 넣은 뒤 이미지가 모두 들어갔는지 확인해 주세요.');
  } catch (err) {
    addAlert(`복사하지 못했습니다: ${err.message}`, 'error');
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch (err) {
    addAlert(`복사하지 못했습니다: ${err.message}`, 'error');
  }
}

function seoText() {
  const s = session.post.seo;
  return `핵심 키워드: ${s.mainKeyword}\n연관·확장키워드: ${s.relatedKeywords.join(', ')}\n메타디스크립션: ${s.metaDescription}`;
}

function saveHtmlFile() {
  const title = session.post.finalTitle || session.chosen?.title || '포스팅';
  const bodyHtml = buildPostHtml({ ...postParts(), inlineStyle: false });
  const blob = new Blob([standaloneHtml({ title, bodyHtml, seo: session.post.seo })], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  download(url, 'post.html');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function saveImages() {
  const list = orderedImages(session.post.markdown, session.thumbnail, session.bodyImages);
  if (!list.length) {
    toast('저장할 이미지가 없습니다.');
    return;
  }
  for (const { img, file } of list) {
    const name = file.split('/').pop();
    try {
      if (img.dataUrl) {
        download(img.dataUrl, name);
      } else {
        const res = await fetch(img.url, { credentials: 'omit' });
        const url = URL.createObjectURL(await res.blob());
        download(url, name);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (err) {
      addAlert(`${name} 저장 실패: ${err.message}`, 'error');
    }
    await sleep(350);
  }
}

/* ---------------- Rendering ---------------- */

function renderStepper() {
  const order = { input: 0, titles: 1, post: 2, images: 3 };
  const cur = order[session.stage] ?? 0;
  document.querySelectorAll('#stepper li').forEach((li) => {
    const step = Number(li.dataset.step);
    const activeStep = cur === 0 ? 1 : cur === 1 ? 2 : cur === 2 ? 3 : 4;
    li.classList.toggle('done', step < activeStep || cur === 3);
    li.classList.toggle('active', step === activeStep && cur !== 3);
  });
}

function evidenceChips(list) {
  if (!list.length) return '<span class="chip">검색 의도 추론</span>';
  return list.map((e) => `<span class="chip${e === '검색 의도 추론' ? '' : ' chip--verified'}">${escapeHtml(e)}</span>`).join('');
}

function autocompleteDetails() {
  const ac = session.autocomplete;
  if (!ac) return '';
  const rows = [];
  for (const [engine, label] of [['google', '구글'], ['naver', '네이버']]) {
    for (const r of ac[engine] || []) {
      const body = r.error ? `조회 실패 (${escapeHtml(r.error)})` : r.suggestions.length ? escapeHtml(r.suggestions.join(' · ')) : '결과 없음';
      rows.push(`<li><b>${label}</b> “${escapeHtml(r.seed)}” — ${body}</li>`);
    }
  }
  if (!rows.length) return '';
  return `<details class="kw-evidence"><summary>직접 확인한 자동완성 보기</summary><ul>${rows.join('')}</ul></details>`;
}

function renderTitlesCard() {
  const card = $('#card-titles');
  const t = session.titles;
  if (!t || session.stage === 'input') {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const rec = t.titles.find((x) => x.no === t.recommended.no) || t.titles[0];
  const chosenTitle = session.chosen?.title;
  card.innerHTML = `
    <h2>검색형 제목 추천</h2>
    <span class="section-label">[기사에서 찾은 검색 의도]</span>
    <p class="intent">${escapeHtml(t.intent)}</p>
    <span class="section-label">[검색형 제목 ${t.titles.length}개]</span>
    <table class="title-table">
      <thead><tr><th>번호</th><th>추천 제목</th><th>해결할 문제</th><th>키워드 확인 근거</th><th></th></tr></thead>
      <tbody>
        ${t.titles.map((x) => `
          <tr class="${x.no === rec.no ? 'recommended' : ''}${x.title === chosenTitle ? ' chosen' : ''}">
            <td class="c-no"><span class="title-no">${x.no}</span></td>
            <td class="c-title">${escapeHtml(x.title)}</td>
            <td class="c-problem">${escapeHtml(x.problem)}</td>
            <td class="c-evidence"><div class="chips">${evidenceChips(x.evidence)}</div></td>
            <td class="c-action"><button type="button" data-action="write" data-no="${x.no}">이 제목으로 작성</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${autocompleteDetails()}
    <span class="section-label">[가장 추천하는 제목]</span>
    <div class="recommend-box"><b>${rec.no}번</b> ${escapeHtml(rec.title)}<div class="hint">${escapeHtml(t.recommended.reason)}</div></div>
    <p class="closing">${escapeHtml(P.TITLE_CLOSING_MESSAGE)}</p>
    <div class="row">
      <button type="button" class="primary" data-action="write-recommended">추천으로 작성</button>
      <input type="text" id="input-choice" placeholder="번호 또는 원하는 제목 입력">
      <button type="button" data-action="write-choice">선택</button>
    </div>`;
}

function imageQuestionHtml() {
  const again = session.bodyImages.length > 0;
  return `
    <div class="image-question">
      <p>${again ? '다른 방향으로 본문 이미지를 다시 만들 수 있습니다.' : escapeHtml(P.IMAGE_QUESTION_MESSAGE)}</p>
      <div class="choices">
        <button type="button" class="choice" data-action="images" data-dir="infographic"><b>①</b> 설명형 인포그래픽</button>
        <button type="button" class="choice" data-action="images" data-dir="photo"><b>②</b> 관련 실사진 (위키미디어 공용)</button>
        <button type="button" class="choice" data-action="images" data-dir="mixed"><b>③</b> 두 가지를 섞은 구성</button>
        ${again ? '' : '<button type="button" class="choice" data-action="images" data-dir="infographic"><b>✓</b> 알아서 해주세요</button>'}
      </div>
      <p class="hint">본문 이미지 개수: ${imageCount()}장 (설정에서 바꿀 수 있습니다)</p>
    </div>`;
}

function renderPostCard() {
  const card = $('#card-post');
  const post = session.post;
  if (!post) {
    card.hidden = true;
    card.replaceChildren();
    return;
  }
  card.hidden = false;
  const notices = [];
  if (post.notice) notices.push(`<div class="notice notice--warn"><b>안내</b> ${escapeHtml(post.notice)}</div>`);
  if (session.thumbnailNote) notices.push(`<div class="notice notice--warn">${escapeHtml(session.thumbnailNote)}</div>`);
  if (session.thumbnailError) {
    notices.push(`<div class="notice notice--error">썸네일을 만들지 못했습니다: ${escapeHtml(session.thumbnailError)}
      <div class="notice-actions"><button type="button" data-action="retry-thumb">썸네일 다시 만들기</button></div></div>`);
  }
  if (settings.thumbnail === false || !post.thumbnail) {
    if (!session.thumbnail && !session.thumbnailError) notices.push('<div class="notice">썸네일 생략 설정에 따라 썸네일을 만들지 않았습니다.</div>');
  }
  for (const n of session.imageNotes) notices.push(`<div class="notice notice--warn">${escapeHtml(n)}</div>`);
  if (session.shortfall) {
    const s = session.shortfall;
    notices.push(`<div class="notice notice--warn">재사용 가능한 실사진을 ${s.found}장 확보했습니다. 요청하신 ${s.requested}장 중 ${s.missing}장이 부족합니다. 부족한 ${s.missing}장을 설명형 인포그래픽으로 대체할까요?
      <div class="notice-actions"><button type="button" class="primary" data-action="fill-shortfall">인포그래픽으로 대체</button><button type="button" data-action="keep-shortfall">이대로 사용</button></div></div>`);
  }

  const s = post.seo;
  const html = buildPostHtml({ markdown: post.markdown, thumbnail: session.thumbnail, images: session.bodyImages });
  const gallery = session.bodyImages.length
    ? `<span class="section-label">[본문 이미지 ${session.bodyImages.length}장 배치]</span>
       <div class="image-gallery">${session.bodyImages.map((img) => `
         <figure><img src="${escapeHtml(img.dataUrl || img.url)}" alt="${escapeHtml(img.alt || '')}">
         <figcaption>${img.kind === 'photo' ? '실사진' : 'AI 인포그래픽'} · ${escapeHtml(img.heading || '')}</figcaption></figure>`).join('')}</div>`
    : '';

  card.innerHTML = `
    <h2>완성 포스팅</h2>
    ${notices.join('')}
    <span class="section-label">[SEO 설정]</span>
    <div class="seo-box"><dl>
      <dt>핵심 키워드</dt><dd>${escapeHtml(s.mainKeyword || '-')}</dd>
      <dt>연관·확장키워드</dt><dd>${escapeHtml(s.relatedKeywords.join(', ') || '-')}</dd>
      <dt>메타디스크립션</dt><dd>${escapeHtml(s.metaDescription || '-')}</dd>
    </dl></div>
    <div class="toolbar">
      <button type="button" data-action="copy-html">서식 포함 복사</button>
      <button type="button" data-action="copy-md">마크다운 복사</button>
      <button type="button" data-action="copy-seo">SEO 설정 복사</button>
      <button type="button" data-action="save-html">HTML 파일 저장</button>
      <button type="button" data-action="save-images">이미지 파일 저장</button>
    </div>
    <span class="section-label">[완성 포스팅]</span>
    <div class="post-frame"><article class="post">${html}</article></div>
    ${gallery}
    ${imageQuestionHtml()}
    <div class="revise">
      <span class="section-label">수정 요청</span>
      <textarea id="input-revise" placeholder="예: 도입부를 더 짧게, FAQ에 환불 관련 질문 추가"></textarea>
      <div class="actions"><button type="button" data-action="revise">수정 반영</button></div>
    </div>
    <p class="footnote">검색 노출·순위는 보장되지 않습니다. 게시 전에 공식 자료의 최신 공지를 한 번 더 확인해 주세요.${session.model ? ` · 작성 모델: ${escapeHtml(session.model)}` : ''}${session.thumbnail?.provider ? ` · 썸네일 그림: ${escapeHtml(PROVIDER_LABEL[session.thumbnail.provider] || session.thumbnail.provider)}` : ''}</p>`;
}

function renderAll() {
  renderStepper();
  renderTitlesCard();
  renderPostCard();
  $('#setup-banner').hidden = Boolean(settings.anthropicKey);
  if (running) setBusy(true);
}

/* ---------------- Settings ---------------- */

function fillSettingsForm() {
  const form = $('#settings-form');
  const modelSel = form.elements.model;
  modelSel.replaceChildren(...MODELS.map((m) => new Option(m.label, m.id)));
  if (!MODELS.some((m) => m.id === settings.model)) modelSel.append(new Option(settings.model, settings.model));
  for (const [k, v] of Object.entries(settings)) {
    const el = form.elements.namedItem(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = v;
  }
  updateProviderFields();
}

function updateProviderFields() {
  const v = $('#settings-form').elements.imageProvider.value;
  document.querySelectorAll('.provider').forEach((p) => p.classList.toggle('show', p.classList.contains(`provider-${v}`)));
}

function openSettings(open) {
  $('#view-settings').hidden = !open;
  $('#view-main').hidden = open;
  $('#btn-settings').setAttribute('aria-pressed', String(open));
  if (open) fillSettingsForm();
}

async function onSettingsSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const next = { ...settings };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const el = form.elements.namedItem(k);
    if (!el) continue;
    if (el.type === 'checkbox') next[k] = el.checked;
    else if (el.type === 'number') next[k] = Number(el.value);
    else next[k] = el.value.trim();
  }
  settings = next;
  await saveSettings(settings);
  $('#settings-saved').hidden = false;
  setTimeout(() => { $('#settings-saved').hidden = true; }, 2000);
  renderAll();
  if (settings.anthropicKey && VIEW !== 'settings') openSettings(false);
}

/* ---------------- Events ---------------- */

function choiceFromInput(value) {
  const v = String(value || '').trim();
  const t = session.titles;
  if (!v || !t) return null;
  if (/추천/.test(v)) return { title: t.titles.find((x) => x.no === t.recommended.no)?.title, how: 'recommended' };
  if (/알아서/.test(v)) return { title: t.titles.find((x) => x.no === t.recommended.no)?.title, how: 'auto' };
  const num = v.match(/^\s*(\d)\s*(번)?\s*$/);
  if (num) {
    const hit = t.titles.find((x) => x.no === Number(num[1]));
    return hit ? { title: hit.title, how: 'number' } : null;
  }
  return { title: v, how: 'custom' };
}

function bindEvents() {
  $('#btn-settings').addEventListener('click', () => openSettings($('#view-settings').hidden));
  $('#btn-settings-close').addEventListener('click', () => openSettings(false));
  $('#btn-setup').addEventListener('click', () => openSettings(true));
  $('#settings-form').addEventListener('submit', onSettingsSubmit);
  $('#settings-form').elements.imageProvider.addEventListener('change', updateProviderFields);

  $('#btn-open-tab').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html?view=tab') }));
  $('#btn-new').addEventListener('click', async () => {
    if (running) return;
    session = newSession();
    $('#input-material').value = '';
    $('#input-title').value = '';
    $('#grab-info').textContent = '';
    showAssistant('');
    clearAlerts();
    await clearSession();
    renderAll();
  });
  $('#btn-stop').addEventListener('click', () => running?.abort());
  $('#btn-grab').addEventListener('click', grabCurrentTab);
  $('#btn-grant').addEventListener('click', async () => {
    const granted = await chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] });
    $('#grab-permission').hidden = true;
    if (granted) grabCurrentTab();
  });
  $('#btn-titles').addEventListener('click', () => startTitles());
  $('#btn-auto').addEventListener('click', () => startTitles({ auto: true }));
  $('#btn-write-direct').addEventListener('click', () => {
    const title = $('#input-title').value.trim();
    if (!title) { $('#input-title').focus(); return; }
    startPost({ title, how: 'custom' });
  });
  $('#input-material').addEventListener('input', () => persist());

  $('#card-titles').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || running) return;
    const t = session.titles;
    if (btn.dataset.action === 'write') {
      const hit = t.titles.find((x) => x.no === Number(btn.dataset.no));
      if (hit) startPost({ title: hit.title, how: 'number' });
    } else if (btn.dataset.action === 'write-recommended') {
      const rec = t.titles.find((x) => x.no === t.recommended.no);
      if (rec) startPost({ title: rec.title, how: 'recommended' });
    } else if (btn.dataset.action === 'write-choice') {
      const choice = choiceFromInput($('#input-choice').value);
      if (choice?.title) startPost(choice);
    }
  });
  $('#card-titles').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'input-choice' && !running) {
      const choice = choiceFromInput(e.target.value);
      if (choice?.title) startPost(choice);
    }
  });

  $('#card-post').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'copy-html') copyHtml();
    else if (a === 'copy-md') copyText(buildMarkdownExport(postParts()), '마크다운을 복사했습니다. 이미지 경로는 ‘이미지 파일 저장’으로 받은 파일 이름(images/…)과 같습니다.');
    else if (a === 'copy-seo') copyText(seoText(), 'SEO 설정을 복사했습니다.');
    else if (a === 'save-html') saveHtmlFile();
    else if (a === 'save-images') saveImages();
    else if (running) return;
    else if (a === 'images') startImages(btn.dataset.dir);
    else if (a === 'retry-thumb') retryThumbnail();
    else if (a === 'fill-shortfall') fillShortfallWithInfographics();
    else if (a === 'keep-shortfall') { session.shortfall = null; session.stage = 'images'; persist(true); renderAll(); }
    else if (a === 'revise') revisePost($('#input-revise').value);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.pendingInput?.newValue) {
      takePendingInput().then((p) => p && applyGrab(p, '오른쪽 클릭으로 보낸 자료'));
    }
    if (changes.session && !running) {
      const v = changes.session.newValue;
      if (v && v.instance !== INSTANCE) {
        session = { ...newSession(), ...v };
        if (document.activeElement?.id !== 'input-material') $('#input-material').value = session.inputText || '';
        renderAll();
      }
    }
    if (changes.settings?.newValue) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      renderAll();
    }
  });
}

/* ---------------- Init ---------------- */

async function init() {
  if (VIEW === 'tab' || VIEW === 'settings') {
    document.body.classList.add('wide');
    $('#btn-open-tab').hidden = true;
  }
  settings = await loadSettings();
  const saved = await loadSession();
  if (saved) session = { ...newSession(), ...saved };
  $('#input-material').value = session.inputText || '';
  bindEvents();
  renderAll();
  const pending = await takePendingInput();
  if (pending) applyGrab(pending, '오른쪽 클릭으로 보낸 자료');
  if (VIEW === 'settings' || !settings.anthropicKey) openSettings(true);
}

init();
