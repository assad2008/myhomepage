/**
 * 邮件内容构建与 Mailgun 发送
 */

import type { Env } from './env';
import { mailgunEndpoint } from './env';
import { escapeHtml, nl2br } from './security';

export interface EmailPayload {
    name: string;
    email: string;
    subject: string;
    message: string;
    time: string;
    ip: string;
    location: string;
    ua: string;
}

export function buildTextEmail(p: EmailPayload): string {
    return [
        p.message,
        '',
        '==============================',
        '来自：WJ.PE官网',
        `发送时间：${p.time}`,
        `发送IP：${p.ip}`,
        `IP归属：${p.location}`,
        `浏览器：${p.ua}`,
    ].join('\n');
}

export function buildHtmlEmail(p: EmailPayload): string {
    const name = escapeHtml(p.name);
    const email = escapeHtml(p.email);
    const subject = escapeHtml(p.subject);
    const messageHtml = nl2br(p.message);
    const time = escapeHtml(p.time);
    const ip = escapeHtml(p.ip);
    const location = escapeHtml(p.location);
    const ua = escapeHtml(p.ua);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:#f5f7fa; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', '微软雅黑', 'PingFang SC', 'Hiragino Sans GB', sans-serif; color:#555555; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa; padding:40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:8px; overflow:hidden; border:1px solid #e9edf3;">
          <tr>
            <td style="background:linear-gradient(135deg, #5178ea 0%, #3a5fd9 100%); padding:28px 32px;">
              <p style="margin:0; font-size:18px; font-weight:bold; color:#ffffff; letter-spacing:1px;">王江的个人主页</p>
              <p style="margin:6px 0 0; font-size:13px; color:rgba(255,255,255,.85);">您收到一封新的联系表单邮件</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px; font-size:14px; line-height:24px;">
                <tr>
                  <td style="padding:4px 0; color:#999999; width:80px; white-space:nowrap;">发件人</td>
                  <td style="padding:4px 0; color:#333333; font-weight:bold;">${name} &lt;${email}&gt;</td>
                </tr>
                <tr>
                  <td style="padding:4px 0; color:#999999; white-space:nowrap;">标题</td>
                  <td style="padding:4px 0; color:#333333;">${subject}</td>
                </tr>
              </table>
              <p style="margin:0 0 12px; font-size:13px; font-weight:bold; color:#999999; letter-spacing:2px;">邮件内容</p>
              <div style="background-color:#f5f7fa; border-left:4px solid #5178ea; border-radius:4px; padding:18px 22px; font-size:15px; line-height:27px; color:#333333; word-break:break-word;">
                ${messageHtml}
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px; font-size:12px; line-height:22px; color:#a8a8a8;">
                <tr>
                  <td style="padding-bottom:20px; border-bottom:1px solid #f1f1f1; word-break:break-word;">
                    发送时间：${time}<br>
                    发送 IP：${ip}<br>
                    IP 归属：${location}<br>
                    浏览器：${ua}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#181818; padding:18px 32px;">
              <p style="margin:0; font-size:12px; color:#a8a8a8; text-align:center;">此邮件由 <a href="https://wangjiang.me" style="color:#7b9ff2; text-decoration:none;">wangjiang.me</a> 联系表单自动发送，回复将直接送达发件人。</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** 通过 Mailgun REST API 发送邮件，失败时抛出错误 */
export async function sendViaMailgun(env: Env, p: EmailPayload): Promise<void> {
    const auth = btoa(`api:${env.MAILGUN_API_KEY}`);
    const body = new URLSearchParams();
    body.set('from', `${p.name} <noreply@${env.MAILGUN_DOMAIN}>`);
    body.set('to', `Wang Jiang <${env.MAIL_RECIPIENT}>`);
    body.set('h:Reply-To', p.email);
    body.set('subject', p.subject);
    body.set('text', buildTextEmail(p));
    body.set('html', buildHtmlEmail(p));

    const resp = await fetch(`${mailgunEndpoint(env)}/${env.MAILGUN_DOMAIN}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Mailgun HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
}
