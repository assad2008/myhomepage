# wangjiang.me

王江个人主页 — 全栈开发者，专注于 Web 开发、后端服务、AI/LLM 应用。

## 技术栈

- **前端**：HTML5 / CSS3 / Bootstrap 3 / jQuery 2 / Particles.js / Typed.js / WOW.js
- **后端**：Cloudflare Pages Functions (TypeScript) + Mailgun REST API
- **存储**：Cloudflare KV（频率限制）
- **部署**：Cloudflare Pages

## 项目结构

```
├── public/                       # 静态站点（Pages 输出目录）
│   ├── index.html                # 主页
│   ├── favicon.ico
│   ├── _headers                  # Cloudflare 自定义响应头
│   └── assets/
│       ├── css/                  # style.css / bootstrap / animate
│       ├── js/                   # script.js 及各 JS 库
│       ├── fontawesome-free-6.7.2-web/
│       └── fonts/
├── functions/                    # Pages Functions（API，替代旧版 sendmail.php）
│   ├── api/
│   │   ├── csrf.ts              # GET  /api/csrf  下发 CSRF Token
│   │   └── mail.ts             # POST /api/mail   校验 + Mailgun 发送
│   └── shared/
│       ├── env.ts               # 配置 / 响应 / 类型
│       ├── security.ts          # 净化 / IP / CSRF / 频率限制(KV)
│       └── email.ts             # HTML / Text 邮件模板 + Mailgun 调用
├── wrangler.toml                 # Pages 项目配置 + KV 绑定
├── tsconfig.json
├── package.json
├── deploy.ps1                    # Cloudflare 一键部署脚本（Windows PowerShell）
├── .dev.vars.example             # 本地调试变量模板（复制为 .dev.vars，不提交）
└── .gitignore
```

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填写 Mailgun 配置
npm run dev                      # 启动预览（含 Pages Functions，默认 http://localhost:8788）
```

> 本地由 Miniflare 模拟 KV（`wrangler.toml` 中 `preview_id` 为占位值即可），
> 频率限制计数保存于临时目录，重启/清理后重置。

## 部署到 Cloudflare Pages

### 方式 A：一键脚本（Windows，推荐）

在项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
```

脚本自动完成：

1. 检查依赖与 `wrangler` 登录状态（未登录则打开浏览器授权）
2. 创建 KV 命名空间 `RATE_LIMIT`（已存在则复用），并把真实 `id` 回填到 `wrangler.toml`
3. 交互式配置 Mailgun 密钥（输入不回显；必填 3 项，可选 2 项，回车跳过）
4. TypeScript 类型检查
5. `wrangler pages deploy` 部署 `public/` 与 `functions/`

若已配置过密钥，可加 `-SkipSecrets` 跳过第 3 步：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -SkipSecrets
```

### 方式 B：手动（跨平台）

```bash
# 1. 创建 KV 命名空间，并把返回的 id 填入 wrangler.toml 的 [[kv_namespaces]]
npx wrangler kv namespace create RATE_LIMIT

# 2. 配置密钥
npx wrangler pages secret put MAILGUN_API_KEY --project-name page-wangjiang-me
npx wrangler pages secret put MAILGUN_DOMAIN  --project-name page-wangjiang-me
npx wrangler pages secret put MAIL_RECIPIENT  --project-name page-wangjiang-me
# 可选：MAILGUN_REGION（us 默认 / eu）、RESTRICT_CN_ONLY（true 默认 / false）

# 3. 部署
npm run deploy
```

### 方式 C：Git 持续部署

在 Cloudflare Dashboard 连接 Git 仓库：Build command 留空，Build output 目录设为 `public`。
KV 绑定与密钥在 Pages 项目 Settings 中配置（绑定名 `RATE_LIMIT`）。

### 绑定自定义域名

Dashboard → Pages → `page-wangjiang-me` → Custom domains → 添加 `wangjiang.me` / `www.wangjiang.me`
（域名需已托管于该 Cloudflare 账户的 DNS，脚本不含此步）。`_headers` 会随之生效。

> 邮件密钥务必用 `wrangler pages secret put` 配置，切勿写入 `wrangler.toml` 或提交到仓库。

## 邮件接口

**端点**：`POST /api/mail`

### 请求参数（form-encoded）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sendname` | string | 否 | 发件人姓名，最长 100 字 |
| `email` | string | 是 | 发件人邮箱 |
| `subject` | string | 否 | 邮件标题，最长 200 字 |
| `message` | string | 是 | 邮件内容，最长 5000 字 |
| `csrf` | string | 是 | 从 `/api/csrf` 获取的 Token |

### 响应格式

```json
{"code": 0, "tips": "发送成功"}
```

### 错误码

| code | 说明 |
|------|------|
| `0` | 发送成功 |
| `-1` | 非法请求（非 POST / 无法解析） |
| `-3` | 内容校验失败 / 非中国大陆 IP |
| `-4` | 邮箱为空或格式错误 |
| `-5` | 服务未配置 / 发送失败 |
| `-6` | CSRF 校验失败 |
| `-7` | 频率限制 |

### 安全措施

- CSRF：双重提交 Cookie（`wj_csrf`，`Secure; SameSite=Strict`），常量时间比较；
  Cookie **不带 `Domain`**（host-only），以兼容 `localhost:端口` 与正式域名——
  `Domain` 一旦带端口会被浏览器判定非法而整条丢弃
- 地区限制：基于 Cloudflare `request.cf.country === 'CN'`，仅对**公网 IP** 生效；
  私网 / 回环 IP（`127.0.0.1`、`192.168.x`、`10.x`、`172.16-31.x` 等）无法可靠定位，直接放行；
  可用 `RESTRICT_CN_ONLY=false` 全局关闭
- 频率限制：每 IP 每 10 分钟最多 1 次（Cloudflare KV）
- 输入净化：CRLF / Header 注入防护、HTML 标签过滤、长度截断
- 日志：结构化输出到 `console.log`，可在 Workers 日志 / `wrangler tail` 查看

### 本地测试说明

浏览器将 `localhost` 视为安全上下文，http 下也会接受 `Secure` cookie，因此本地
`npm run dev` 表单可正常提交。若用脚本（如 PowerShell `Invoke-WebRequest`）测试，
其 Cookie 容器不接受 http 下的 `Secure` cookie，请改用 `curl --cookie-jar` 或
在请求头中手动携带 `Cookie: wj_csrf=<token>`。

## 许可

© 2019-2026 Wang Jiang
