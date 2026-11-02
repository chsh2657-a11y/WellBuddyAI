// Real photos from Wikimedia Commons, with license and author metadata.
// Only freely reusable licenses are kept (CC0 / public domain / CC BY / CC BY-SA).

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'BogardSEOBlogAssistant/1.0 (Chrome extension; blog image search)';

export const PHOTO_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['plans'],
  properties: {
    plans: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'purpose', 'queries'],
        properties: {
          heading: { type: 'string' },
          purpose: { type: 'string' },
          queries: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export const PHOTO_SELECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['selections'],
  properties: {
    selections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'candidate_id', 'caption', 'alt', 'reason'],
        properties: {
          heading: { type: 'string' },
          candidate_id: { type: 'string' },
          caption: { type: 'string' },
          alt: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

function stripHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

const FREE_LICENSE = /(cc0|public domain|^pd\b|^pd-|cc[- ]by(?:-sa)?(?:[ -]\d|$| ))/i;
const NOT_FREE = /\b(nc|nd)\b|non-?commercial|no ?deriv/i;

export function isReusableLicense(name) {
  const n = String(name || '').trim();
  return FREE_LICENSE.test(n) && !NOT_FREE.test(n);
}

function toCandidate(page) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const m = info.extmetadata || {};
  const v = (k) => m[k]?.value ?? '';
  const mime = info.mime || '';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
  if (String(v('NonFree')).toLowerCase() === 'true') return null;
  const license = stripHtml(v('LicenseShortName'));
  if (!isReusableLicense(license)) return null;
  if ((info.width || 0) < 800) return null;
  return {
    title: page.title.replace(/^File:/, ''),
    pageUrl: info.descriptionurl,
    displayUrl: info.thumburl || info.url,
    width: info.width,
    height: info.height,
    license,
    licenseUrl: v('LicenseUrl') || '',
    artist: stripHtml(v('Artist')) || stripHtml(v('Credit')) || '작성자 미상',
    date: stripHtml(v('DateTimeOriginal')) || stripHtml(v('DateTime')),
    description: stripHtml(v('ImageDescription')).slice(0, 300),
    restrictions: stripHtml(v('Restrictions')),
    attributionRequired: String(v('AttributionRequired')).toLowerCase() !== 'false',
  };
}

export async function searchCommons(query, { limit = 8, signal } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1280',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|DateTimeOriginal|DateTime|ImageDescription|Restrictions|AttributionRequired|NonFree',
  });
  const res = await fetch(`${API}?${params}`, { headers: { 'Api-User-Agent': UA }, signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`위키미디어 검색 실패 (HTTP ${res.status})`);
  const json = await res.json();
  const pages = Object.values(json?.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map(toCandidate).filter(Boolean);
}

/** Collects up to `perHeading` distinct candidates for each planned heading. */
export async function gatherCandidates(plans, { perHeading = 4, signal, onStatus } = {}) {
  const seen = new Set();
  const out = [];
  let counter = 0;
  for (const plan of plans) {
    const list = [];
    for (const q of plan.queries.slice(0, 3)) {
      if (list.length >= perHeading) break;
      onStatus?.(`실사진 검색: ${q}`);
      try {
        for (const c of await searchCommons(q, { signal })) {
          if (list.length >= perHeading) break;
          if (seen.has(c.pageUrl)) continue;
          seen.add(c.pageUrl);
          list.push({ ...c, id: `c${++counter}` });
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        onStatus?.(`검색 실패: ${q} (${err.message})`);
      }
    }
    out.push({ heading: plan.heading, purpose: plan.purpose, candidates: list });
  }
  return out;
}

function previewUrl(url) {
  // Commons serves standard thumbnail widths; 500px is enough to check content.
  return /\/\d+px-/.test(url) ? url.replace(/\/\d+px-/, '/500px-') : url;
}

export async function fetchImageBase64(url, signal) {
  const res = await fetch(url, { signal, credentials: 'omit', headers: { 'Api-User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new Error(`지원하지 않는 형식 ${type}`);
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return { media_type: type, data };
}

/** Builds the multimodal user content for the selection request. */
export async function buildSelectionContent(intro, groups, signal) {
  const content = [{ type: 'text', text: intro }];
  for (const g of groups) {
    content.push({ type: 'text', text: `\n## 소제목: ${g.heading}\n보여줄 내용: ${g.purpose}\n후보 ${g.candidates.length}개` });
    for (const c of g.candidates) {
      content.push({
        type: 'text',
        text: `- candidate_id: ${c.id}\n  파일명: ${c.title}\n  설명: ${c.description || '(없음)'}\n  촬영일: ${c.date || '(정보 없음)'}\n  작성자: ${c.artist}\n  라이선스: ${c.license}${c.restrictions ? `\n  추가 제한: ${c.restrictions}` : ''}`,
      });
      try {
        const img = await fetchImageBase64(previewUrl(c.displayUrl), signal);
        content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
      } catch {
        content.push({ type: 'text', text: '  (미리보기를 불러오지 못했습니다. 파일 정보만으로 판단해 주세요.)' });
      }
    }
  }
  return content;
}

export function photoCredit(c) {
  return { artist: c.artist, license: c.license, licenseUrl: c.licenseUrl, pageUrl: c.pageUrl, source: 'Wikimedia Commons' };
}
