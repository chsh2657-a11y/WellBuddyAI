// Assembles the post: thumbnail under H1, body images under their H2s,
// and the export formats (HTML for editors, Markdown + image files).

import { renderMarkdown, extractHeadings, normalizeHeading, escapeHtml } from './markdown.js';

const SKIP_HEADING = /(자주\s*묻는\s*질문|faq|출처|확인\s*기준|해시태그)/i;

export function bodyHeadings(markdown) {
  return extractHeadings(markdown, 2).filter((h) => !SKIP_HEADING.test(h));
}

/**
 * Maps each image to the index (among H2 headings) it should sit under.
 * Exact (normalized) matches win, then substring matches, then the first
 * free body heading, so an image is never dropped or stacked at the end.
 */
export function placeImages(markdown, images) {
  const all = extractHeadings(markdown, 2);
  const norm = all.map(normalizeHeading);
  const used = new Set();
  const placement = new Map(); // h2 index -> images[]
  const put = (idx, img) => {
    used.add(idx);
    if (!placement.has(idx)) placement.set(idx, []);
    placement.get(idx).push(img);
  };
  const pending = [];
  for (const img of images) {
    const target = normalizeHeading(img.heading || '');
    let idx = norm.findIndex((h, i) => h === target && !used.has(i));
    if (idx === -1 && target) idx = norm.findIndex((h, i) => !used.has(i) && (h.includes(target) || target.includes(h)) && h.length > 1);
    if (idx === -1) pending.push(img);
    else put(idx, img);
  }
  for (const img of pending) {
    const idx = all.findIndex((h, i) => !used.has(i) && !SKIP_HEADING.test(h));
    if (idx !== -1) put(idx, img);
  }
  return placement;
}

function creditHtml(img, { inlineStyle = false } = {}) {
  const a = (href, text) => (href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${inlineStyle ? ' style="color:#64748b"' : ''}>${escapeHtml(text)}</a>`
    : escapeHtml(text));
  if (img.kind === 'photo' && img.credit) {
    const c = img.credit;
    return `${img.caption ? `${escapeHtml(img.caption)} · ` : ''}사진: ${a(c.pageUrl, c.artist)} / ${escapeHtml(c.source)} / ${a(c.licenseUrl, c.license)}`;
  }
  if (img.kind === 'infographic') {
    return `AI 제작 설명용 인포그래픽${img.sourceNote ? ` · ${escapeHtml(img.sourceNote)}` : ''}`;
  }
  return 'AI 제작 썸네일';
}

export function figureHtml(img, { inlineStyle = false, src } = {}) {
  const s = src || img.dataUrl || img.url;
  const figStyle = inlineStyle ? ' style="margin:24px 0;text-align:center"' : '';
  const imgStyle = inlineStyle ? ' style="max-width:100%;height:auto;border-radius:8px"' : '';
  const capStyle = inlineStyle ? ' style="font-size:13px;color:#64748b;margin-top:8px"' : '';
  return `<figure class="post-figure post-figure--${img.kind}"${figStyle}><img src="${escapeHtml(s)}" alt="${escapeHtml(img.alt || '')}"${imgStyle}><figcaption${capStyle}>${creditHtml(img, { inlineStyle })}</figcaption></figure>`;
}

/**
 * @param {{markdown: string, thumbnail?: object, images?: object[], inlineStyle?: boolean, srcFor?: (img)=>string}} p
 */
export function buildPostHtml({ markdown, thumbnail, images = [], inlineStyle = false, srcFor }) {
  const placement = placeImages(markdown, images);
  let h1Done = false;
  let h2Index = -1;
  let html = renderMarkdown(markdown, {
    afterHeading(level) {
      if (level === 1 && !h1Done) {
        h1Done = true;
        return thumbnail ? figureHtml(thumbnail, { inlineStyle, src: srcFor?.(thumbnail) }) : '';
      }
      if (level === 2) {
        h2Index++;
        return (placement.get(h2Index) || []).map((img) => figureHtml(img, { inlineStyle, src: srcFor?.(img) })).join('');
      }
      return '';
    },
  });
  if (thumbnail && !h1Done) html = figureHtml(thumbnail, { inlineStyle, src: srcFor?.(thumbnail) }) + html;
  if (inlineStyle) {
    html = html
      .replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;margin:16px 0">')
      .replace(/<th(?=[ >])/g, '<th style="border:1px solid #cbd5e1;background:#f1f5f9;padding:8px 10px;text-align:left"')
      .replace(/<td(?=[ >])/g, '<td style="border:1px solid #cbd5e1;padding:8px 10px"');
  }
  return html;
}

export function fileNameFor(img, index) {
  const n = String(index).padStart(2, '0');
  if (img.kind === 'thumbnail') return `${n}-thumbnail.jpg`;
  if (img.kind === 'infographic') return `${n}-infographic.png`;
  const ext = /\.png($|\?)/i.test(img.url || '') ? 'png' : 'jpg';
  return `${n}-photo.${ext}`;
}

/** Lists every image with its export file name (thumbnail first, then in post order). */
export function orderedImages(markdown, thumbnail, images = []) {
  const placement = placeImages(markdown, images);
  const ordered = [...placement.keys()].sort((a, b) => a - b).flatMap((k) => placement.get(k));
  const list = thumbnail ? [thumbnail, ...ordered] : ordered;
  return list.map((img, i) => ({ img, file: `images/${fileNameFor(img, i + 1)}` }));
}

/** Markdown export with images referenced as files in images/. */
export function buildMarkdownExport({ markdown, thumbnail, images = [] }) {
  const files = new Map(orderedImages(markdown, thumbnail, images).map(({ img, file }) => [img, file]));
  const placement = placeImages(markdown, images);
  const plainCaption = (img) => creditHtml(img).replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g, '[$2]($1)');
  const block = (img) => `\n![${(img.alt || '').replace(/[[\]]/g, '')}](${files.get(img)})\n*${plainCaption(img)}*\n`;
  const lines = markdown.split('\n');
  const out = [];
  let h1Done = false;
  let h2 = -1;
  for (const line of lines) {
    out.push(line);
    if (/^#\s/.test(line) && !h1Done) {
      h1Done = true;
      if (thumbnail) out.push(block(thumbnail));
    } else if (/^##\s/.test(line)) {
      h2++;
      for (const img of placement.get(h2) || []) out.push(block(img));
    }
  }
  return out.join('\n');
}

export function standaloneHtml({ title, bodyHtml, seo }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${seo?.metaDescription ? `<meta name="description" content="${escapeHtml(seo.metaDescription)}">` : ''}
<style>
body{font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.75;color:#1e293b;max-width:760px;margin:40px auto;padding:0 16px}
h1{font-size:30px;line-height:1.35}h2{font-size:23px;margin-top:40px}h3{font-size:19px}
a{color:#0f766e}figure{margin:24px 0;text-align:center}img{max-width:100%;height:auto;border-radius:8px}
figcaption{font-size:13px;color:#64748b;margin-top:8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:8px 10px}th{background:#f1f5f9}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
