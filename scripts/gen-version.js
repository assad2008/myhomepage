/**
 * 版本号内联注入器
 *
 * 每次发布时（predev / predeploy / deploy.ps1）将版本号直接内联写入
 * public/index.html 的 #app-version 元素，无需额外的 HTTP 请求。
 *
 * 这样做的好处：
 *   - 不存在 version.js 缺失导致页脚一直显示 "dev" 的问题
 *   - 版本号随 HTML 一起到达，无闪烁 / 延迟
 *   - 减少一次网络请求
 *
 * 页面底部显示格式：v{package.json 版本} - {构建时间}（如 v1.0.0 - 2026-07-28 15:17）
 * 完整构建戳写入 data-build 属性，供鼠标悬停 tooltip 使用。
 */
const fs = require('fs');
const path = require('path');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `.${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const human =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;

const version = `${pkg.version}+${stamp}`;
const display = `v${pkg.version} - ${human}`;
const indexPath = path.join(__dirname, '..', 'public', 'index.html');

if (!fs.existsSync(indexPath)) {
    console.error('[gen-version] index.html not found, skipping version injection.');
    process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

const replacement = `<span id="app-version" data-build="${stamp}" data-generated="${now.toISOString()}">${display}</span>`;

let updated = false;
html = html.replace(
    /<span id="app-version"[^>]*>[^<]*<\/span>/,
    () => {
        updated = true;
        return replacement;
    }
);

if (!updated) {
    console.warn('[gen-version] Warning: #app-version span not found in index.html.');
    process.exit(1);
}

fs.writeFileSync(indexPath, html, 'utf8');
console.log(`[gen-version] ${version} -> public/index.html`);
