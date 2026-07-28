/**
 * GET /api/csrf —— 下发 CSRF Token（写入 Cookie，JS 可读）
 *
 * 前端页面加载时调用一次；token 也通过响应体返回，便于前端回填。
 */

import type { PagesFunction } from '@cloudflare/workers-types';
import { ok } from '../shared/env';
import { issueCsrfCookie } from '../shared/security';

export const onRequestGet: PagesFunction = async (context) => {
    const { token, setCookie } = issueCsrfCookie(context.request);
    return ok(token, setCookie);
};
