/**
 * 安全相关：输入净化、客户端 IP、CSRF、频率限制（Cloudflare KV）
 */

import { CONFIG } from './env';
import type { Env } from './env';

/** 移除换行与控制字符，用于单行字段，防止 CRLF / Header 注入 */
export function sanitizeLine(value: string): string {
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\r\n]/g, '');
}

/** 净化多行内容：保留换行，移除 HTML 标签与其余控制字符 */
export function sanitizeContent(value: string): string {
    const noControl = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return noControl.replace(/<[^>]*>/g, '');
}

/** HTML 转义 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** 换行转 <br>（先转义再替换，安全） */
export function nl2br(value: string): string {
    return escapeHtml(value).replace(/\r\n?|\n/g, '<br>');
}

interface IpInfo {
    ip: string;
    country?: string;
    city?: string;
    region?: string;
}

/** 提取客户端真实 IP 与地理位置（优先 Cloudflare 提供的可信信息） */
export function getIpInfo(request: Request, cf?: IncomingRequestCfProperties): IpInfo {
    const fromHeader = request.headers.get('CF-Connecting-IP') ?? '';
    const ip = isValidIp(fromHeader) ? fromHeader : '0.0.0.0';

    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const c = cf as { country?: unknown; city?: unknown; region?: unknown } | undefined;

    return {
        ip,
        country: str(c?.country),
        city: str(c?.city),
        region: str(c?.region),
    };
}

/** 是否为合法 IPv4/IPv6 地址 */
function isValidIp(ip: string): boolean {
    if (!ip) {
        return false;
    }
    if (ip.includes(':')) {
        return /^[0-9a-fA-F:]+$/.test(ip);
    }
    return ipv4Parts(ip) !== null;
}

function ipv4Parts(ip: string): number[] | null {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        return null;
    }
    const parts = ip.split('.').map((n) => parseInt(n, 10));
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
        return null;
    }
    return parts;
}

/** IPv4 转无符号整数 */
function ipv4ToInt(ip: string): number | null {
    const p = ipv4Parts(ip);
    if (!p) {
        return null;
    }
    return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

/** 判断 IPv4 是否落在指定 CIDR 网段内 */
function inCidr(ip: string, cidr: string): boolean {
    const [network, bitsStr] = cidr.split('/');
    const bits = parseInt(bitsStr, 10);
    const ipn = ipv4ToInt(ip);
    const netn = ipv4ToInt(network);
    if (ipn === null || netn === null || Number.isNaN(bits)) {
        return false;
    }
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((ipn & mask) >>> 0) === ((netn & mask) >>> 0);
}

/**
 * 是否为私网 / 回环 / 链路本地 / 未指定地址。
 * 这类 IP 无法可靠定位，地区限制将对其放行（如 127.0.0.1、192.168.x、10.x、172.16-31.x）。
 */
export function isPrivateIp(ip: string): boolean {
    if (!ip || ip === '0.0.0.0') {
        return true;
    }
    if (ip.includes(':')) {
        return ip === '::1' || ip === '::' || /^f[cd][0-9a-fA-F]{2}:/i.test(ip);
    }
    const ranges = [
        '0.0.0.0/8',
        '10.0.0.0/8',
        '100.64.0.0/10',
        '127.0.0.0/8',
        '169.254.0.0/16',
        '172.16.0.0/12',
        '192.168.0.0/16',
    ];
    return ranges.some((r) => inCidr(ip, r));
}

/** 生成 CSRF token，并构造对应的 Set-Cookie（双重提交 Cookie 模式，JS 可读） */
export function issueCsrfCookie(request: Request): { token: string; setCookie: string } {
    const token = generateToken();
    // 不设置 Domain 属性：host-only cookie 对 localhost:端口 与正式域名都正确生效。
    // （Domain 一旦带端口会被浏览器视为非法而整条丢弃，这正是本地发不出的原因。）
    const parts = [
        `${CONFIG.csrfCookie}=${token}`,
        `Max-Age=${CONFIG.csrfTtlSeconds}`,
        'Path=/',
    ];
    // 仅 https 下加 Secure：http（本地/内网调试）若带 Secure，部分客户端会拒收。
    if (new URL(request.url).protocol === 'https:') {
        parts.push('Secure');
    }
    parts.push('SameSite=Strict');
    const setCookie = parts.join('; ');
    return { token, setCookie };
}

/** 校验 CSRF：请求体中的 token 必须与 Cookie 中的一致 */
export function verifyCsrf(request: Request, posted: string): boolean {
    const cookieToken = parseCookie(request.headers.get('Cookie'), CONFIG.csrfCookie);
    const a = sanitizeLine(posted);
    if (!a || !cookieToken) {
        return false;
    }
    return timingSafeEqual(a, cookieToken);
}

function generateToken(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseCookie(header: string | null, name: string): string {
    if (!header) {
        return '';
    }
    const match = header
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

/** 常量时间比较，避免时序攻击 */
function timingSafeEqual(a: string, b: string): boolean {
    const enc = new TextEncoder();
    const ba = enc.encode(a);
    const bb = enc.encode(b);
    if (ba.byteLength !== bb.byteLength) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < ba.byteLength; i++) {
        diff |= ba[i] ^ bb[i];
    }
    return diff === 0;
}

/**
 * 基于 IP 的频率限制（固定时间窗口，时间戳数组存于 KV）
 * @returns 是否放行
 */
export async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
    const key = `rl:${ip}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - CONFIG.rateWindowSeconds;

    const raw = await env.RATE_LIMIT.get(key);
    let hits: number[] = [];
    if (raw) {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                hits = parsed.filter((t): t is number => typeof t === 'number' && t > windowStart);
            }
        } catch {
            hits = [];
        }
    }

    if (hits.length >= CONFIG.rateMax) {
        return false;
    }

    hits.push(now);
    await env.RATE_LIMIT.put(key, JSON.stringify(hits), {
        expirationTtl: CONFIG.rateWindowSeconds,
    });
    return true;
}

/** 格式化为北京时间（UTC+8） */
export function formatBeijingTime(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date);
}
