/** 간단한 트랜잭션 메일 HTML 템플릿(인라인 스타일, 외부 리소스 없음) */
export interface MailTemplateInput {
  title: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMail({ title, paragraphs, action, footnote }: MailTemplateInput) {
  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#f6f7f9;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#16181d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #e2e5ea;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-size:15px;font-weight:700">WellBuddy ERP</td></tr>
<tr><td style="padding:8px 28px;font-size:20px;font-weight:700">${escapeHtml(title)}</td></tr>
${paragraphs.map((p) => `<tr><td style="padding:6px 28px;font-size:14px;line-height:1.6">${escapeHtml(p)}</td></tr>`).join('')}
${
  action
    ? `<tr><td style="padding:20px 28px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1b5ed6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(action.label)}</a></td></tr>`
    : ''
}
${footnote ? `<tr><td style="padding:8px 28px 28px;font-size:12px;color:#5f6673">${escapeHtml(footnote)}</td></tr>` : '<tr><td style="padding:12px"></td></tr>'}
</table></td></tr></table></body></html>`;
  const text = [
    title,
    '',
    ...paragraphs,
    ...(action ? ['', `${action.label}: ${action.url}`] : []),
    ...(footnote ? ['', footnote] : []),
  ].join('\n');
  return { html, text };
}
