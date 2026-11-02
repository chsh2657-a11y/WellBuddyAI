// Renders explanatory infographics from a structured spec with exact Korean
// typesetting (no generative image model, so numbers and wording stay exact).

import { ensureFonts, font, wrapText, fitText, roundRect } from './canvas.js';

export const INFOGRAPHIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'question', 'kind', 'title', 'points', 'compare', 'basis_date', 'source_note', 'alt'],
        properties: {
          heading: { type: 'string' },
          question: { type: 'string' },
          kind: { type: 'string', enum: ['summary', 'steps', 'checklist', 'compare', 'caution'] },
          title: { type: 'string' },
          points: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'detail'],
              properties: { label: { type: 'string' }, detail: { type: 'string' } },
            },
          },
          compare: {
            type: 'object',
            additionalProperties: false,
            required: ['columns', 'rows'],
            properties: {
              columns: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
          },
          basis_date: { type: 'string' },
          source_note: { type: 'string' },
          alt: { type: 'string' },
        },
      },
    },
  },
};

const W = 1080;
const PAD = 72;
const INNER = W - PAD * 2;

const THEME = {
  bg: '#F4F7FB',
  ink: '#0F1B33',
  muted: '#50607A',
  card: '#FFFFFF',
  line: '#DCE3EE',
  navy: '#17305E',
  teal: '#0FA391',
  amber: '#D97706',
  amberSoft: '#FFF4E0',
  tealSoft: '#E3F6F3',
};

const KIND_LABEL = {
  summary: '핵심 요약',
  steps: '진행 순서',
  checklist: '체크리스트',
  compare: '한눈에 비교',
  caution: '주의사항',
};

function kindColor(kind) {
  return kind === 'caution' ? THEME.amber : kind === 'compare' ? THEME.navy : THEME.teal;
}

function drawCheck(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, s, s, s * 0.24);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = s * 0.13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.26, y + s * 0.52);
  ctx.lineTo(x + s * 0.44, y + s * 0.7);
  ctx.lineTo(x + s * 0.76, y + s * 0.32);
  ctx.stroke();
}

function drawWarning(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + s / 2, y + s * 0.06);
  ctx.lineTo(x + s * 0.97, y + s * 0.92);
  ctx.lineTo(x + s * 0.03, y + s * 0.92);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.08;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x + s * 0.455, y + s * 0.34, s * 0.09, s * 0.32, s * 0.04);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s * 0.77, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

function drawNumber(ctx, x, y, s, n, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(800, Math.round(s * 0.5));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x + s / 2, y + s / 2 + s * 0.03);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

function drawDot(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

/** Lays out (and, when draw=true, paints) the infographic; returns total height. */
function layout(ctx, spec, draw) {
  const color = kindColor(spec.kind);
  let y = PAD;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // Kind pill
  ctx.font = font(700, 28);
  const tag = KIND_LABEL[spec.kind] || KIND_LABEL.summary;
  const tagW = ctx.measureText(tag).width + 44;
  if (draw) {
    ctx.fillStyle = color;
    roundRect(ctx, PAD, y, tagW, 52, 26);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(tag, PAD + 22, y + 11);
  }
  y += 52 + 28;

  // Title
  const t = fitText(ctx, spec.title, { weight: 800, maxSize: 64, minSize: 46, maxWidth: INNER, maxLines: 2 });
  if (draw) {
    ctx.fillStyle = THEME.ink;
    ctx.font = font(800, t.size);
    t.lines.forEach((ln, i) => ctx.fillText(ln, PAD, y + i * t.size * 1.22));
  }
  y += t.lines.length * t.size * 1.22 + 10;

  // Question
  if (spec.question) {
    ctx.font = font(500, 32);
    const q = wrapText(ctx, spec.question, INNER);
    if (draw) {
      ctx.fillStyle = THEME.muted;
      q.forEach((ln, i) => ctx.fillText(ln, PAD, y + i * 46));
    }
    y += q.length * 46;
  }
  y += 40;

  if (spec.kind === 'compare' && spec.compare?.columns?.length) {
    y = layoutCompare(ctx, spec, y, draw);
  } else {
    y = layoutPoints(ctx, spec, y, draw, color);
  }

  // Footer
  y += 24;
  const footer = [spec.basis_date, spec.source_note].filter(Boolean).join('  ·  ');
  ctx.font = font(500, 24);
  const fl = footer ? wrapText(ctx, footer, INNER) : [];
  if (draw) {
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
  }
  y += 22;
  if (draw) {
    ctx.fillStyle = THEME.muted;
    fl.forEach((ln, i) => ctx.fillText(ln, PAD, y + i * 34));
  }
  y += fl.length * 34;
  if (draw) {
    ctx.font = font(500, 22);
    ctx.fillStyle = '#8A97AD';
    ctx.textAlign = 'right';
    ctx.fillText('AI 제작 설명용 인포그래픽', W - PAD, y + (fl.length ? 6 : 0));
    ctx.textAlign = 'left';
  }
  y += 34 + PAD - 20;
  return Math.ceil(y);
}

function layoutPoints(ctx, spec, y, draw, color) {
  const points = (spec.points || []).slice(0, 5);
  const icon = 64;
  const cardPadX = 36;
  const cardPadY = 30;
  const textX = PAD + cardPadX + icon + 28;
  const textW = W - PAD - cardPadX - textX;
  const gap = spec.kind === 'steps' ? 46 : 22;

  points.forEach((p, i) => {
    ctx.font = font(700, 38);
    const label = wrapText(ctx, p.label, textW);
    ctx.font = font(500, 31);
    const detail = p.detail ? wrapText(ctx, p.detail, textW) : [];
    const textH = label.length * 50 + (detail.length ? 8 + detail.length * 44 : 0);
    const h = Math.max(icon, textH) + cardPadY * 2;

    if (draw) {
      ctx.fillStyle = spec.kind === 'caution' ? THEME.amberSoft : THEME.card;
      ctx.shadowColor = 'rgba(15, 27, 51, 0.08)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 4;
      roundRect(ctx, PAD, y, INNER, h, 26);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      const ix = PAD + cardPadX;
      const iy = y + cardPadY + Math.max(0, (Math.min(textH, 120) - icon) / 2);
      if (spec.kind === 'steps') drawNumber(ctx, ix, iy, icon, i + 1, color);
      else if (spec.kind === 'checklist') drawCheck(ctx, ix, iy, icon, color);
      else if (spec.kind === 'caution') drawWarning(ctx, ix, iy, icon, color);
      else drawNumber(ctx, ix, iy, icon, i + 1, color);

      let ty = y + cardPadY + Math.max(0, (icon - textH) / 2);
      ctx.fillStyle = THEME.ink;
      ctx.font = font(700, 38);
      label.forEach((ln) => { ctx.fillText(ln, textX, ty); ty += 50; });
      if (detail.length) {
        ty += 8;
        ctx.fillStyle = THEME.muted;
        ctx.font = font(500, 31);
        detail.forEach((ln) => { ctx.fillText(ln, textX, ty); ty += 44; });
      }

      if (spec.kind === 'steps' && i < points.length - 1) {
        // Down arrow between steps
        const ax = PAD + cardPadX + icon / 2;
        const ay = y + h + 8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(ax - 16, ay + 6);
        ctx.lineTo(ax + 16, ay + 6);
        ctx.lineTo(ax, ay + 28);
        ctx.closePath();
        ctx.fill();
      }
    }
    y += h + (i < points.length - 1 ? gap : 0);
  });
  return y;
}

function layoutCompare(ctx, spec, y, draw) {
  const cols = spec.compare.columns.slice(0, 3);
  const rows = (spec.compare.rows || []).slice(0, 6);
  const firstW = Math.round(INNER * (cols.length >= 3 ? 0.26 : 0.3));
  const otherW = (INNER - firstW) / cols.length;
  const widths = [firstW, ...cols.map(() => otherW)];
  const cellPad = 22;

  const rowHeight = (cells, weight, size, lh) => {
    ctx.font = font(weight, size);
    const lines = cells.map((c, j) => wrapText(ctx, c, widths[j] - cellPad * 2));
    return { lines, h: Math.max(...lines.map((l) => l.length)) * lh + cellPad * 2 };
  };

  const header = rowHeight(['', ...cols], 700, 32, 42);
  const bodyRows = rows.map((r) => {
    const cells = [r[0] ?? '', ...cols.map((_, j) => r[j + 1] ?? '')];
    return rowHeight(cells, 500, 30, 42);
  });
  const total = header.h + bodyRows.reduce((n, r) => n + r.h, 0);

  if (draw) {
    ctx.save();
    roundRect(ctx, PAD, y, INNER, total, 24);
    ctx.clip();
    ctx.fillStyle = THEME.card;
    ctx.fillRect(PAD, y, INNER, total);
    ctx.fillStyle = THEME.navy;
    ctx.fillRect(PAD, y, INNER, header.h);

    let x = PAD;
    ctx.font = font(700, 32);
    ctx.fillStyle = '#FFFFFF';
    header.lines.forEach((lines, j) => {
      lines.forEach((ln, k) => ctx.fillText(ln, x + cellPad, y + cellPad + k * 42));
      x += widths[j];
    });

    let ry = y + header.h;
    bodyRows.forEach((r, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = '#F2F5FA';
        ctx.fillRect(PAD, ry, INNER, r.h);
      }
      let cx = PAD;
      r.lines.forEach((lines, j) => {
        ctx.font = font(j === 0 ? 700 : 500, 30);
        ctx.fillStyle = j === 0 ? THEME.ink : '#2A3850';
        lines.forEach((ln, k) => ctx.fillText(ln, cx + cellPad, ry + cellPad + k * 42));
        cx += widths[j];
      });
      ctx.strokeStyle = THEME.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, ry);
      ctx.lineTo(W - PAD, ry);
      ctx.stroke();
      ry += r.h;
    });
    // Column separators
    let sx = PAD;
    ctx.strokeStyle = THEME.line;
    widths.slice(0, -1).forEach((w) => {
      sx += w;
      ctx.beginPath();
      ctx.moveTo(sx, y + header.h);
      ctx.lineTo(sx, y + total);
      ctx.stroke();
    });
    ctx.restore();
  }
  return y + total;
}

/** Renders one infographic spec to a PNG data URL. */
export async function renderInfographic(spec) {
  await ensureFonts();
  const measure = document.createElement('canvas').getContext('2d');
  const height = Math.max(layout(measure, spec, false), 760);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, height);
  // Soft accent corner
  ctx.fillStyle = spec.kind === 'caution' ? THEME.amberSoft : THEME.tealSoft;
  ctx.beginPath();
  ctx.arc(W - 40, 40, 220, 0, Math.PI * 2);
  ctx.fill();
  layout(ctx, spec, true);
  return canvas.toDataURL('image/png');
}

/** All text drawn on an infographic, for proofreading against the post. */
export function infographicText(spec) {
  const parts = [spec.title, spec.question, spec.basis_date, spec.source_note];
  for (const p of spec.points || []) parts.push(p.label, p.detail);
  for (const c of spec.compare?.columns || []) parts.push(c);
  for (const r of spec.compare?.rows || []) parts.push(...r);
  return parts.filter(Boolean).join('\n');
}

const NUM_RE = /\d[\d,.]*/g;
const normNum = (s) => s.replace(/,/g, '').replace(/\.$/, '');

/**
 * Proofreads numbers: every number on the image must also appear in the post
 * (or be the basis date we supplied). Returns the numbers that don't.
 */
export function findUnsupportedNumbers(spec, markdown, allowed = []) {
  const postNums = new Set((String(markdown).match(NUM_RE) || []).map(normNum));
  // Dates written as 2026-11-02 / 2026.11.02 / 2026년 11월 2일 should match each other.
  for (const m of String(markdown).matchAll(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)) {
    postNums.add(m[1]); postNums.add(String(Number(m[2]))); postNums.add(String(Number(m[3])));
  }
  for (const a of allowed) for (const n of String(a).match(NUM_RE) || []) postNums.add(normNum(n));
  const text = [spec.title, spec.question, ...(spec.points || []).flatMap((p) => [p.label, p.detail]),
    ...(spec.compare?.columns || []), ...(spec.compare?.rows || []).flat()].join(' ');
  const missing = new Set();
  for (const raw of text.match(NUM_RE) || []) {
    const n = normNum(raw);
    const parts = n.split(/[.]/).filter(Boolean);
    const ok = postNums.has(n) || parts.every((p) => postNums.has(String(Number(p))) || postNums.has(p));
    if (!ok) missing.add(raw);
  }
  return [...missing];
}
