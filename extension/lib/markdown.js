// Small, dependency-free Markdown renderer for the blog posts the model writes.
// Supports: headings, paragraphs, bold/italic/strike/code, links, images,
// bare URLs, ordered/unordered (nested) lists, GFM tables, blockquotes, hr,
// fenced code. All text is HTML-escaped first; only http(s)/mailto links and
// http(s)/data:image images are emitted.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

function safeUrl(url, { image = false } = {}) {
  const u = String(url || '').trim().replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(u)) return u;
  if (!image && /^mailto:/i.test(u)) return u;
  if (image && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u)) return u;
  if (image && /^(\.\/)?[\w\-./]+\.(png|jpe?g|webp|gif)$/i.test(u)) return u; // relative file in exports
  return null;
}

/** Strips inline markdown so headings can be compared as plain text. */
export function plainText(md) {
  return String(md || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeHeading(s) {
  return plainText(s).replace(/[\s·\-–—:：?？!！.,'"“”‘’()（）[\]]/g, '').toLowerCase();
}

export function inline(text) {
  const tokens = [];
  const keep = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = escapeHtml(text);

  s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, url) => {
    const u = safeUrl(url, { image: true });
    return u ? keep(`<img src="${escapeHtml(u)}" alt="${alt}">`) : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(url);
    return u ? keep(`<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${label}</a>`) : label;
  });
  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+[^\s<)）.,。、])/g, (m, pre, url) => {
    const u = safeUrl(url);
    return u ? `${pre}${keep(`<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${url}</a>`)}` : m;
  });
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

const RE = {
  fence: /^\s*```/,
  heading: /^(#{1,6})\s+(.+?)\s*#*\s*$/,
  hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s*>\s?/,
  list: /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function renderList(lines) {
  // Build a tree from indentation.
  const root = { children: [], ordered: null, indent: -1 };
  const stack = [root];
  for (const raw of lines) {
    const m = raw.match(RE.list);
    if (m) {
      const indent = m[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(m[2]);
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1];
      const container = parent === root ? root : parent;
      if (container.ordered === null) container.ordered = ordered;
      const item = { text: m[3], children: [], ordered: null, indent, start: ordered ? parseInt(m[2], 10) : null };
      container.children.push(item);
      stack.push(item);
    } else if (stack.length > 1) {
      stack[stack.length - 1].text += ` ${raw.trim()}`;
    }
  }
  const render = (node) => {
    if (!node.children.length) return '';
    const tag = node.ordered ? 'ol' : 'ul';
    const start = node.ordered && node.children[0].start > 1 ? ` start="${node.children[0].start}"` : '';
    return `<${tag}${start}>${node.children.map((c) => `<li>${inline(c.text)}${render(c)}</li>`).join('')}</${tag}>`;
  };
  return render(root);
}

/**
 * Renders markdown to HTML.
 * @param {string} md
 * @param {{afterHeading?: (level:number, text:string, index:number) => string}} [opts]
 *   afterHeading returns extra HTML inserted right after a heading.
 */
export function renderMarkdown(md, opts = {}) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let headingIndex = 0;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) { flushPara(); continue; }

    if (RE.fence.test(line)) {
      flushPara();
      const buf = [];
      i++;
      while (i < lines.length && !RE.fence.test(lines[i])) buf.push(lines[i++]);
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const h = line.match(RE.heading);
    if (h) {
      flushPara();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      if (opts.afterHeading) out.push(opts.afterHeading(level, plainText(h[2]), headingIndex) || '');
      headingIndex++;
      continue;
    }

    if (RE.hr.test(line) && !RE.list.test(line)) { flushPara(); out.push('<hr>'); continue; }

    if (RE.quote.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].replace(RE.quote, ''));
      i--;
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      flushPara();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      i--;
      const cell = (tag, c, j) => `<${tag}${aligns[j] ? ` style="text-align:${aligns[j]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(
        `<table><thead><tr>${head.map((c, j) => cell('th', c, j)).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, j) => cell('td', r[j] ?? '', j)).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }

    if (RE.list.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line ends the list unless the next line continues it.
          if (i + 1 < lines.length && RE.list.test(lines[i + 1])) { i++; continue; }
          break;
        }
        if (RE.list.test(l) || (/^\s{2,}\S/.test(l) && buf.length)) { buf.push(l); i++; continue; }
        break;
      }
      i--;
      out.push(renderList(buf));
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return out.join('\n');
}

/** Returns headings of the given level as plain text, in order. */
export function extractHeadings(md, level = 2) {
  const res = [];
  let inFence = false;
  for (const line of String(md || '').split('\n')) {
    if (RE.fence.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = line.match(RE.heading);
    if (h && h[1].length === level) res.push(plainText(h[2]));
  }
  return res;
}
