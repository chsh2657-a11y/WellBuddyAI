// Helpers to pull the tagged sections out of a model response.

/** Returns the inner text of the last <tag>…</tag> (or an unterminated one while streaming). */
export function extractTag(text, tag, { allowOpen = false } = {}) {
  if (!text) return null;
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.lastIndexOf(open);
  if (start === -1) return null;
  const from = start + open.length;
  const end = text.indexOf(close, from);
  if (end === -1) return allowOpen ? text.slice(from).trim() : null;
  return text.slice(from, end).trim();
}

/** Parses JSON that may be wrapped in code fences or surrounded by stray text. */
export function parseJsonLoose(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(s);
  } catch {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(s.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Removes inline citation markers the model may still emit, e.g. [1], 【2】. */
export function stripCitationMarks(md) {
  return md.replace(/\s?【\d+(?:[,，]\s?\d+)*】/g, '').replace(/(?<=[^\s\]])\[(\d{1,2})\](?!\()/g, '');
}

export function parseSourceCheck(text) {
  const data = parseJsonLoose(extractTag(text, 'source_check'));
  if (!data) return null;
  return {
    hasMaterial: data.has_material !== false,
    accessedLinks: Array.isArray(data.accessed_links) ? data.accessed_links : [],
    failedLinks: Array.isArray(data.failed_links) ? data.failed_links : [],
    topic: String(data.topic || ''),
    keyFacts: Array.isArray(data.key_facts) ? data.key_facts.map(String) : [],
    eventDate: String(data.event_date || ''),
    reportDate: String(data.report_date || ''),
    seeds: Array.isArray(data.seeds) ? data.seeds.map((s) => String(s).trim()).filter(Boolean).slice(0, 5) : [],
  };
}

const EVIDENCE_LABELS = ['자동완성 확인', '관련 검색어 확인', '검색 결과 확인', '검색 의도 추론'];

export function parseTitles(text) {
  const data = parseJsonLoose(extractTag(text, 'titles'));
  if (!data || !Array.isArray(data.titles)) return null;
  const titles = data.titles.slice(0, 5).map((t, i) => ({
    no: Number(t.no) || i + 1,
    title: String(t.title || '').trim(),
    problem: String(t.problem || '').trim(),
    evidence: (Array.isArray(t.evidence) ? t.evidence : [t.evidence])
      .map((e) => String(e || '').trim())
      .filter((e) => EVIDENCE_LABELS.includes(e)),
  })).filter((t) => t.title);
  if (!titles.length) return null;
  const recNo = Number(data.recommended?.no);
  return {
    intent: String(data.intent || '').trim(),
    titles,
    recommended: {
      no: titles.some((t) => t.no === recNo) ? recNo : titles[0].no,
      reason: String(data.recommended?.reason || '').trim(),
    },
  };
}

function sanitizeHex(color, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || '').trim()) ? String(color).trim() : fallback;
}

export function parsePost(text) {
  const markdown = extractTag(text, 'post');
  if (!markdown) return null;
  const seo = parseJsonLoose(extractTag(text, 'seo')) || {};
  const thumb = parseJsonLoose(extractTag(text, 'thumbnail')) || {};
  return {
    notice: extractTag(text, 'notice') || '',
    finalTitle: extractTag(text, 'final_title') || '',
    seo: {
      mainKeyword: String(seo.main_keyword || '').trim(),
      relatedKeywords: Array.isArray(seo.related_keywords) ? seo.related_keywords.map(String).slice(0, 3) : [],
      metaDescription: String(seo.meta_description || '').trim(),
    },
    thumbnail: thumb.line1
      ? {
        line1: String(thumb.line1).trim(),
        line2: String(thumb.line2 || '').trim(),
        visual_brief: String(thumb.visual_brief || '').trim(),
        accent: sanitizeHex(thumb.accent, '#22C3A6'),
        alt: String(thumb.alt || thumb.line1).trim(),
      }
      : null,
    markdown: stripCitationMarks(markdown),
  };
}

/** Extracts the first <svg>…</svg> from a response. */
export function extractSvg(text) {
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start === -1 || end === -1) return null;
  return text.slice(start, end + 6);
}
