// Canvas helpers shared by the thumbnail and infographic renderers.

export const FONT_STACK = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", sans-serif';

let fontsReady = null;
export function ensureFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load(`500 32px ${FONT_STACK}`, '가나다'),
      document.fonts.load(`700 32px ${FONT_STACK}`, '가나다'),
      document.fonts.load(`800 32px ${FONT_STACK}`, '가나다'),
    ]).catch(() => null);
  }
  return fontsReady;
}

export function font(weight, size) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

/** Word-wraps text (breaking long words by character, which suits Korean). */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (ctx.measureText(candidate.trimEnd()).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = /^\s+$/.test(w) ? '' : w;
      // Break a single word that is still too long.
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines.length ? lines : [''];
}

/** Picks the largest font size (stepping down) for which text fits in maxLines. */
export function fitText(ctx, text, { weight, maxSize, minSize, maxWidth, maxLines }) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = font(weight, size);
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = font(weight, minSize);
  return { size: minSize, lines: wrapText(ctx, text, maxWidth) };
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x22c3a6;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다'));
    img.src = src;
  });
}

/** Draws an image scaled to cover the target rectangle. */
export function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}
