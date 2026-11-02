// Collects real autocomplete suggestions from Google and Naver.
// These are the only phrases the model may label as '자동완성 확인'.

const TIMEOUT_MS = 8000;

async function fetchText(url, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function parseGoogleSuggest(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return data[1].map((s) => String(s).trim()).filter(Boolean);
}

export function parseNaverSuggest(text) {
  const data = JSON.parse(text);
  const out = [];
  for (const group of data?.items || []) {
    for (const item of group || []) {
      const v = Array.isArray(item) ? item[0] : item;
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
  }
  return out;
}

export async function googleSuggest(q, signal) {
  const url = `https://suggestqueries.google.com/complete/search?client=chrome&hl=ko&gl=kr&ie=UTF-8&oe=UTF-8&q=${encodeURIComponent(q)}`;
  return parseGoogleSuggest(await fetchText(url, signal));
}

export async function naverSuggest(q, signal) {
  const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(q)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`;
  return parseNaverSuggest(await fetchText(url, signal));
}

const dedupe = (arr) => [...new Set(arr)];

/**
 * @param {string[]} seeds
 * @param {'google'|'naver'|'both'} platform
 * @returns {Promise<{google: Array, naver: Array}>} rows of {seed, suggestions, error}
 */
export async function collectAutocomplete(seeds, platform, signal) {
  const engines = platform === 'both' ? ['google', 'naver'] : [platform === 'naver' ? 'naver' : 'google'];
  const fn = { google: googleSuggest, naver: naverSuggest };
  const result = { google: [], naver: [] };
  await Promise.all(
    engines.flatMap((engine) =>
      seeds.map(async (seed) => {
        try {
          // The seed itself plus "seed " (a trailing space often surfaces more completions).
          const [a, b] = await Promise.all([fn[engine](seed, signal), fn[engine](`${seed} `, signal).catch(() => [])]);
          result[engine].push({ seed, suggestions: dedupe([...a, ...b]).slice(0, 12) });
        } catch (err) {
          result[engine].push({ seed, suggestions: [], error: err?.name === 'AbortError' ? '시간 초과' : String(err?.message || err) });
        }
      }),
    ),
  );
  for (const engine of engines) result[engine].sort((x, y) => seeds.indexOf(x.seed) - seeds.indexOf(y.seed));
  return result;
}

export function countSuggestions(data) {
  const sum = (rows) => rows.reduce((n, r) => n + r.suggestions.length, 0);
  return { google: sum(data?.google || []), naver: sum(data?.naver || []) };
}
