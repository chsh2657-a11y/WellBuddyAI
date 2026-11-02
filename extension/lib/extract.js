// Article extraction. `extractArticleInPage` is injected into the page with
// chrome.scripting.executeScript, so it must be fully self-contained.

export function extractArticleInPage() {
  const MAX = 20000;
  const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content') || '';

  const selection = clean(window.getSelection?.().toString());

  const candidates = [
    '#dic_area', '#newsct_article', '#articleBodyContents', '#articeBody', '#article_body',
    '[itemprop="articleBody"]', '.article_body', '.article-body', '.news_body', '.news-body',
    '#article-view-content-div', '.story-news', '.article_txt', '#harmonyContainer',
    '.se-main-container', '#postViewArea', '.tt_article_useless_p_margin', '.entry-content',
    'article', 'main',
  ];
  const textOf = (el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,iframe,nav,aside,footer,form,button,figure figcaption,.ad,.ads,[class*="advert"],[class*="banner"],[class*="related"],[class*="comment"]').forEach((n) => n.remove());
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    clone.querySelectorAll('p,div,li,h1,h2,h3,h4,tr').forEach((n) => n.append('\n'));
    return clean(clone.textContent);
  };

  let body = '';
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) {
      const t = textOf(el);
      if (t.length > 300) { body = t; break; }
    }
  }
  if (!body) {
    // Fallback: the element with the most paragraph text.
    let best = null;
    let bestLen = 0;
    document.querySelectorAll('div,section').forEach((el) => {
      const len = [...el.querySelectorAll(':scope > p')].reduce((n, p) => n + p.textContent.length, 0);
      if (len > bestLen) { best = el; bestLen = len; }
    });
    body = best ? textOf(best) : clean(document.body?.innerText || '');
  }

  return {
    pageTitle: clean(meta('meta[property="og:title"]') || document.title),
    pageUrl: location.href,
    publishedAt: meta('meta[property="article:published_time"]') || meta('meta[name="article:published_time"]') ||
      meta('meta[property="og:regDate"]') || document.querySelector('time[datetime]')?.getAttribute('datetime') || '',
    selection: selection.slice(0, MAX),
    text: body.slice(0, MAX),
  };
}

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

/** Splits user input into links and text for the prompt. */
export function describeInput(raw) {
  const text = String(raw || '').trim();
  const links = text.match(URL_RE) || [];
  const rest = text.replace(URL_RE, '').trim();
  return { text, links, hasText: rest.length > 0 };
}
