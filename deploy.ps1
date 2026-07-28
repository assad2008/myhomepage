#Requires -Version 5.1
<#
.SYNOPSIS
    Cloudflare Pages 一键部署脚本（Windows PowerShell 5.1+）。

.DESCRIPTION
    自动完成：
      1. 检查 npm 依赖 / wrangler / Cloudflare 登录状态
      2. 创建 KV 命名空间 RATE_LIMIT（已存在则复用），并自动回填 wrangler.toml
      3. 配置 Mailgun 密钥（必填 3 项 + 可选 2 项）
      4. TypeScript 类型检查
      5. 部署 public/ 与 functions/ 到 Cloudflare Pages

.NOTES
    用法：  powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
    可选开关：  -SkipSecrets  跳过密钥配置（已配置过时）
#>

[CmdletBinding()]
param(
    [switch]$SkipSecrets
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# 定位到脚本所在目录（项目根）
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
Set-Location -LiteralPath $root

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2($m)  { Write-Host "  [!] $m" -ForegroundColor Yellow }
function Run($args2)      { & npx --no-install wrangler @args2 }

# ---------- 0. 读取项目名 ----------
Write-Step "0/6 读取配置"
$wranglerToml = Join-Path $root 'wrangler.toml'
if (-not (Test-Path -LiteralPath $wranglerToml)) { throw "未找到 wrangler.toml，请在项目根目录运行本脚本" }
$projectName = ((Get-Content -LiteralPath $wranglerToml -Raw) | Select-String -Pattern '(?m)^\s*name\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
Write-Ok "项目名: $projectName"

# ---------- 依赖与登录 ----------
Write-Step "1/6 检查依赖与登录状态"
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Warn2 "node_modules 不存在，先执行 npm install ..."
    & npm install
}
& npx --no-install wrangler --version *>$null
if ($LASTEXITCODE -ne 0) { throw "wrangler 不可用，请先运行 npm install" }
Run whoami *>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warn2 "尚未登录 Cloudflare，将打开浏览器进行授权 ..."
    Run login
    Run whoami *>$null
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare 登录失败" }
}
Write-Ok "wrangler 已登录"

# ---------- KV 命名空间 ----------
Write-Step "2/6 KV 命名空间 RATE_LIMIT"
$kvJson = (Run kv namespace list --output json 2>$null) -join "`n"
$existing = @($kvJson | ConvertFrom-Json | Where-Object { $_.binding -eq 'RATE_LIMIT' })
if ($existing.Count -gt 0) {
    $kvId = $existing[0].id
    Write-Ok "复用已有命名空间 id=$kvId"
} else {
    $created = (Run kv namespace create RATE_LIMIT --output json 2>$null) -join "`n"
    $kvId = ($created | ConvertFrom-Json).id
    Write-Ok "已创建命名空间 id=$kvId"
}

# 回填 wrangler.toml（占位 id 为 32 个 0）
$wt = Get-Content -LiteralPath $wranglerToml -Raw
if ($wt -match 'id\s*=\s*"0{32}"') {
    $wt2 = $wt -replace 'id\s*=\s*"0{32}"', ('id = "{0}"' -f $kvId)
    [System.IO.File]::WriteAllText($wranglerToml, $wt2, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "wrangler.toml 已写入真实 KV id"
} else {
    Write-Ok "wrangler.toml 中的 KV id 无需更新"
}

# ---------- 密钥 ----------
function Convert-Secure([System.Security.SecureString]$s) {
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Set-Secret($key, [System.Security.SecureString]$val) {
    $plain = Convert-Secure $val
    $plain | Run pages secret put $key --project-name $projectName *>$null | Out-Null
    Write-Ok "已设置密钥 $key"
}

if ($SkipSecrets) {
    Write-Step "3/6 密钥（已跳过）"
} else {
    Write-Step "3/6 配置 Mailgun 密钥（回车=保留原值/跳过）"
    $v = Read-Host -Prompt "  MAILGUN_API_KEY (必填)" -AsSecureString
    if ($v.Length -gt 0) { Set-Secret 'MAILGUN_API_KEY' $v }
    $v = Read-Host -Prompt "  MAILGUN_DOMAIN (必填, 如 mg.wangjiang.me)" -AsSecureString
    if ($v.Length -gt 0) { Set-Secret 'MAILGUN_DOMAIN' $v }
    $v = Read-Host -Prompt "  MAIL_RECIPIENT (必填, 收件邮箱)" -AsSecureString
    if ($v.Length -gt 0) { Set-Secret 'MAIL_RECIPIENT' $v }
    $v = Read-Host -Prompt "  MAILGUN_REGION (可选: us/eu, 默认 us)" -AsSecureString
    if ($v.Length -gt 0) { Set-Secret 'MAILGUN_REGION' $v }
    $v = Read-Host -Prompt "  RESTRICT_CN_ONLY (可选: true/false, 默认 true)" -AsSecureString
    if ($v.Length -gt 0) { Set-Secret 'RESTRICT_CN_ONLY' $v }
}

# ---------- 类型检查 ----------
Write-Step "4/6 TypeScript 类型检查"
& npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "类型检查未通过，请先修复错误再部署" }
Write-Ok "类型检查通过"

# ---------- 部署 ----------
Write-Step "5/6 部署到 Cloudflare Pages"
Run pages deploy public --project-name $projectName
if ($LASTEXITCODE -ne 0) { throw "部署失败" }
Write-Ok "部署完成"

# ---------- 收尾 ----------
Write-Step "6/6 完成"
Write-Host "  查看项目: npx wrangler pages project list" -ForegroundColor DarkGray
Write-Host "  实时日志: npx wrangler pages deployment tail --project-name $projectName" -ForegroundColor DarkGray
Write-Host "  自定义域名请在 Cloudflare Dashboard -> Pages -> $projectName -> Custom domains 中配置。" -ForegroundColor DarkGray
