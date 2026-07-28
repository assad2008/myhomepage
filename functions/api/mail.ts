/**
 * POST /api/mail —— 联系表单邮件发送接口
 *
 * 复刻原 sendmail.php 的行为：
 * 1. 仅接受 POST
 * 2. 配置完整性校验
 * 3. CSRF 双重提交校验
 * 4. 地区限制（仅 CN，可配置）
 * 5. 基于 IP 的频率限制（Cloudflare KV）
 * 6. 输入净化与长度校验
 * 7. 通过 Mailgun REST API 发送
 *
 * 响应格式与原接口一致：{"code": number, "tips": string}
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../shared/env';
import { CONFIG, fail, getCf, isConfigured, ok, restrictCnOnly } from '../shared/env';
import {
    checkRateLimit,
    formatBeijingTime,
    getIpInfo,
    isPrivateIp,
    issueCsrfCookie,
    sanitizeContent,
    sanitizeLine,
    verifyCsrf,
} from '../shared/security';
import { sendViaMailgun } from '../shared/email';
import type { EmailPayload } from '../shared/email';

interface FormInput {
    name: string;
    email: string;
    subject: string;
    message: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { request } = context;
    const env = context.env;

    // ---- 配置完整性 ----
    if (!isConfigured(env)) {
        return fail(-5, '邮件服务未配置');
    }

    // ---- 解析表单 ----
    let data: URLSearchParams;
    try {
        const text = await request.text();
        data = new URLSearchParams(text);
    } catch {
        return fail(-1, '非法请求');
    }

    // ---- CSRF 校验（双重提交 Cookie） ----
    if (!verifyCsrf(request, data.get('csrf') ?? '')) {
        return fail(-6, '安全验证失败，请刷新页面后重试');
    }

    // ---- 客户端 IP 与地理位置 ----
    const { ip, country, city, region } = getIpInfo(request, getCf(context));
    const userAgent =
        sanitizeLine(request.headers.get('User-Agent') ?? '').slice(0, 300) || '未知';

    // ---- 读取 & 净化输入 ----
    const input: FormInput = {
        name: sanitizeLine(data.get('sendname') ?? '').slice(0, CONFIG.maxNameLen),
        email: sanitizeLine(data.get('email') ?? ''),
        subject: sanitizeLine(data.get('subject') ?? '').slice(0, CONFIG.maxSubjectLen),
        message: sanitizeContent(data.get('message') ?? ''),
    };

    logSubmit({ ip, country, city, region, userAgent, input });

    // ---- 地区限制 ----
    // 私网/回环 IP（127.0.0.1、192.168.x、10.x 等）无法可靠定位，直接放行；
    // 公网 IP 必须来自中国大陆（可用 RESTRICT_CN_ONLY=false 全局关闭）。
    if (restrictCnOnly(env) && !isPrivateIp(ip) && country !== 'CN') {
        return fail(-3, '对不起，只允许中国大陆发送邮件');
    }

    // ---- 频率限制 ----
    const allowed = await checkRateLimit(env, ip).catch(() => true);
    if (!allowed) {
        console.log(JSON.stringify({ rate_limited: true, ip }));
        return fail(-7, `提交过于频繁，请${CONFIG.rateWindowSeconds / 60}分钟后再试`);
    }

    // ---- 字段校验 ----
    if (!input.email) {
        return fail(-4, '对不起，邮箱地址不能为空');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
        return fail(-4, '对不起，邮箱地址格式不正确');
    }
    if (!input.message) {
        return fail(-3, '对不起，邮件内容不能为空');
    }
    if ([...input.message].length > CONFIG.maxMessageLen) {
        return fail(-3, `对不起，邮件内容不能超过${CONFIG.maxMessageLen}字`);
    }

    // ---- 构建邮件 ----
    const payload: EmailPayload = {
        name: input.name || '匿名',
        email: input.email,
        subject: input.subject || '来自WJ.PE的邮件',
        message: input.message,
        time: formatBeijingTime(),
        ip,
        location: formatLocation(country, region, city),
        ua: userAgent,
    };

    // ---- 发送 ----
    try {
        await sendViaMailgun(env, payload);
    } catch (err) {
        console.log(JSON.stringify({ error: String(err), ip }));
        return fail(-5, '发送失败，请稍后重试');
    }

    // 成功后轮换 CSRF token
    const { setCookie } = issueCsrfCookie(request);
    return ok('发送成功', setCookie);
};

function formatLocation(
    country?: string,
    region?: string,
    city?: string,
): string {
    const parts = [country ?? '', region ?? '', city ?? ''].filter(Boolean);
    return parts.join(' ') || '未知';
}

function logSubmit(info: Record<string, unknown>): void {
    console.log(JSON.stringify({ ...info, at: formatBeijingTime() }));
}
