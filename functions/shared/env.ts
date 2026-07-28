/**
 * 环境变量、配置与响应工具
 */

export interface Env {
    MAILGUN_API_KEY: string;
    MAILGUN_DOMAIN: string;
    MAIL_RECIPIENT: string;
    MAILGUN_REGION?: string;
    RESTRICT_CN_ONLY?: string;
    RATE_LIMIT: KVNamespace;
}

export interface ApiResult {
    code: number;
    tips: string;
}

export const CONFIG = {
    maxNameLen: 100,
    maxSubjectLen: 200,
    maxMessageLen: 5000,
    csrfCookie: 'wj_csrf',
    csrfTtlSeconds: 7200,
    rateMax: 1,
    rateWindowSeconds: 600,
} as const;

export function respond(
    result: ApiResult,
    init?: { status?: number; setCookie?: string },
): Response {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    if (init?.setCookie) {
        headers.append('Set-Cookie', init.setCookie);
    }
    return new Response(JSON.stringify(result), {
        status: init?.status ?? 200,
        headers,
    });
}

export function ok(tips: string, setCookie?: string): Response {
    return respond({ code: 0, tips }, { setCookie });
}

export function fail(code: number, tips: string, setCookie?: string): Response {
    return respond({ code, tips }, { setCookie });
}

export function isConfigured(env: Env): boolean {
    return Boolean(env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN && env.MAIL_RECIPIENT);
}

export function mailgunEndpoint(env: Env): string {
    return env.MAILGUN_REGION?.toLowerCase() === 'eu'
        ? 'https://api.eu.mailgun.net/v3'
        : 'https://api.mailgun.net/v3';
}

export function restrictCnOnly(env: Env): boolean {
    return env.RESTRICT_CN_ONLY?.toLowerCase() !== 'false';
}

/** 取出请求的 Cloudflare 元信息（地理位置等） */
export function getCf(context: { request: Request }): IncomingRequestCfProperties | undefined {
    return (context.request as Request & { cf?: IncomingRequestCfProperties }).cf;
}
