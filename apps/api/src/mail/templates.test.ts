import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMail } from './templates.js';

describe('메일 템플릿', () => {
  it('사용자 입력은 HTML 이스케이프한다', () => {
    const { html, text } = renderMail({
      title: '<script>alert(1)</script>회사',
      paragraphs: ['a & b'],
      action: { label: '열기', url: 'https://x.test/?a=1&b="2"' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('href="https://x.test/?a=1&amp;b=&quot;2&quot;"');
    expect(text).toContain('열기: https://x.test/?a=1&b="2"');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
});
