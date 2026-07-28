#Requires -Version 5.1
<#
.SYNOPSIS
Deploy this project to Cloudflare Pages.

.DESCRIPTION
Validates local configuration, authentication, and the target Pages project before
optionally updating secrets and deploying the public folder.
The script never creates Cloudflare resources or rewrites wrangler.toml.

.PARAMETER SkipSecrets
Do not prompt for Pages secrets.

.PARAMETER SkipTypecheck
Do not run TypeScript type checking.

.PARAMETER SkipProjectCheck
Do not verify that the Pages project exists before deployment.

.PARAMETER Branch
Deploy to a preview branch instead of production.

.PARAMETER AccountId
Cloudflare account ID that owns the Pages project. This value is applied only to
the current script process as CLOUDFLARE_ACCOUNT_ID.

.PARAMETER PromptForApiToken
Securely prompt for CLOUDFLARE_API_TOKEN when one is not already available in
the environment. The token is removed before the script exits.

.NOTES
For unattended local deployment, create .deploy.vars next to this script with
CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. This file is ignored by Git.
#>
[CmdletBinding()]
param(
    [switch]$SkipSecrets,
    [switch]$SkipTypecheck,
    [switch]$SkipProjectCheck,
    [ValidatePattern('^[A-Za-z0-9._/-]+$')]
    [string]$Branch,
    [ValidatePattern('^[A-Fa-f0-9]{32}$')]
    [string]$AccountId,
    [switch]$PromptForApiToken
)

$ErrorActionPreference = 'Stop'

# In PowerShell 7, native stderr can be promoted to a terminating error.
# Wrangler commands below are evaluated by their exit code instead.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$script:ProjectRoot = $PSScriptRoot
if (-not $script:ProjectRoot) {
    $script:ProjectRoot = (Get-Location).Path
}
Set-Location -LiteralPath $script:ProjectRoot

# Load deployment credentials from the Git-ignored local credentials file.
function Import-LocalDeploymentCredentials {
    param([Parameter(Mandatory = $true)][string]$CredentialFile)

    if (-not (Test-Path -LiteralPath $CredentialFile -PathType Leaf)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $CredentialFile) {
        $trimmedLine = $line.Trim()
        if (-not $trimmedLine -or $trimmedLine.StartsWith('#')) {
            continue
        }

        $match = [regex]::Match($trimmedLine, '^(CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN))=(.*)$')
        if (-not $match.Success) {
            throw "Invalid entry in $CredentialFile. Only CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are allowed."
        }

        $value = $match.Groups[2].Value.Trim()
        if ($value.Length -ge 2 -and (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        )) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw "The value for $($match.Groups[1].Value) in $CredentialFile cannot be empty."
        }

        if (-not (Get-Item -Path "Env:$($match.Groups[1].Value)" -ErrorAction SilentlyContinue)) {
            Set-Item -Path "Env:$($match.Groups[1].Value)" -Value $value
            if ($match.Groups[1].Value -eq 'CLOUDFLARE_API_TOKEN') {
                $script:ApiTokenSetByScript = $true
            }
        }
    }
}

$script:ApiTokenSetByScript = $false
Import-LocalDeploymentCredentials -CredentialFile (Join-Path $script:ProjectRoot '.deploy.vars')

# Use the explicitly supplied account ID without persisting it to the system.
if ($AccountId) {
    $env:CLOUDFLARE_ACCOUNT_ID = $AccountId
}

# Prompt for an API token without exposing it in command history or source code.
function Set-SessionApiToken {
    $secureToken = Read-Host -Prompt '  CLOUDFLARE_API_TOKEN' -AsSecureString
    if ($secureToken.Length -eq 0) {
        throw 'CLOUDFLARE_API_TOKEN cannot be empty.'
    }

    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
        $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $script:ApiTokenSetByScript = $true
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

if ($PromptForApiToken -and -not $env:CLOUDFLARE_API_TOKEN) {
    Set-SessionApiToken
}

# Write a deployment step heading.
function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

# Write a success message.
function Write-Ok {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

# Write a warning message.
function Write-WarnMessage {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "  [!] $Message" -ForegroundColor Yellow
}

# Run local Wrangler and fail when the process returns a nonzero exit code.
function Invoke-Wrangler {
    param(
        [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & npx --no-install wrangler @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Wrangler command failed (exit code $exitCode): npx wrangler $($Arguments -join ' ')"
    }
}

# Run local Wrangler and return stdout for JSON query commands.
function Get-WranglerOutput {
    param(
        [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $output = & npx --no-install wrangler @Arguments 2>$null
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $details = ($output | Out-String).Trim()
        throw "Wrangler command failed (exit code $exitCode): npx wrangler $($Arguments -join ' ')`n$details"
    }

    return ($output | Out-String).Trim()
}

# Read the Pages project name from wrangler.toml.
function Get-ProjectName {
    param([Parameter(Mandatory = $true)][string]$ConfigPath)

    $configContent = Get-Content -LiteralPath $ConfigPath -Raw
    $match = [regex]::Match($configContent, '(?m)^\s*name\s*=\s*"([^"]+)"\s*$')
    if (-not $match.Success) {
        throw 'wrangler.toml does not contain a valid name value.'
    }

    return $match.Groups[1].Value
}

try {
    $wranglerConfig = Join-Path $script:ProjectRoot 'wrangler.toml'
    $outputDirectory = Join-Path $script:ProjectRoot 'public'

    Write-Step '1/6 Validate local configuration'
    if (-not (Test-Path -LiteralPath $wranglerConfig -PathType Leaf)) {
        throw 'wrangler.toml was not found. Run this script from the project root.'
    }
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        throw 'The public directory was not found.'
    }
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw 'npx was not found. Install Node.js LTS and reopen PowerShell.'
    }

    $projectName = Get-ProjectName -ConfigPath $wranglerConfig
    Write-Ok "Pages project: $projectName"
    if ($env:CLOUDFLARE_ACCOUNT_ID) {
        Write-Ok "Cloudflare account: $env:CLOUDFLARE_ACCOUNT_ID"
    }
    else {
        Write-WarnMessage 'No explicit Cloudflare account ID was supplied. Wrangler will choose the current default account.'
    }

    Write-Step '2/6 Validate Wrangler and authentication'
    Invoke-Wrangler --version
    try {
        Invoke-Wrangler whoami
    }
    catch {
        Write-WarnMessage 'Cloudflare login is required. Opening the authorization flow.'
        Invoke-Wrangler login
        Invoke-Wrangler whoami
    }
    Write-Ok 'Cloudflare authentication is valid'

    if (-not $SkipProjectCheck) {
        Write-Step '3/6 Verify target Pages project'
        $projectJson = Get-WranglerOutput pages project list --json
        try {
            $projects = $projectJson | ConvertFrom-Json
        }
        catch {
            throw "Unable to parse the Pages project list: $projectJson"
        }

        # Wrangler pages project list --json uses display-oriented property names.
        $projectNames = @(
            $projects |
                ForEach-Object { $_.'Project Name' } |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        if ($projectNames -notcontains $projectName) {
            $availableNames = if ($projectNames.Count -gt 0) { $projectNames -join ', ' } else { 'none' }
            throw "Pages project '$projectName' was not found. Visible projects: $availableNames. Check wrangler.toml, CLOUDFLARE_API_TOKEN, and the Cloudflare account."
        }
        Write-Ok "Pages project $projectName exists"
    }
    else {
        Write-Step '3/6 Verify target Pages project (skipped)'
        Write-WarnMessage 'The deployment command will still validate the project name.'
    }

    if ($SkipSecrets) {
        Write-Step '4/6 Configure secrets (skipped)'
    }
    else {
        $devVarsFile = Join-Path $script:ProjectRoot '.dev.vars'
        if (Test-Path -LiteralPath $devVarsFile -PathType Leaf) {
            Write-Step '4/6 Import secrets from .dev.vars'
            Invoke-Wrangler pages secret bulk $devVarsFile --project-name $projectName
            Write-Ok 'Secrets from .dev.vars were imported into Cloudflare Pages'
        }
        else {
            Write-Step '4/6 Configure Mailgun secrets'
            Write-WarnMessage '.dev.vars was not found. Wrangler will securely prompt for each secret.'
            $secretNames = @('MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAIL_RECIPIENT', 'MAILGUN_REGION', 'RESTRICT_CN_ONLY')
            foreach ($secretName in $secretNames) {
                Invoke-Wrangler pages secret put $secretName --project-name $projectName
            }
        }
    }

    if ($SkipTypecheck) {
        Write-Step '5/6 TypeScript type check (skipped)'
    }
    else {
        Write-Step '5/6 TypeScript type check'
        & npm run typecheck
        if ($LASTEXITCODE -ne 0) {
            throw "TypeScript type check failed (exit code $LASTEXITCODE)."
        }
        Write-Ok 'TypeScript type check passed'
    }

    Write-Step '6/6 Deploy to Cloudflare Pages'

    # Stamp a fresh build version so the site footer reflects this very release.
    & node (Join-Path (Join-Path $script:ProjectRoot 'scripts') 'gen-version.js')
    if ($LASTEXITCODE -ne 0) {
        throw "Version generation failed (exit code $LASTEXITCODE) during deployment."
    }
    Write-Ok 'Build version stamped into public/index.html'

    $deployArguments = @('pages', 'deploy', 'public', "--project-name=$projectName")
    if ($Branch) {
        $deployArguments += "--branch=$Branch"
        Write-Host "  Target: preview branch $Branch" -ForegroundColor DarkGray
    }
    else {
        Write-Host '  Target: production' -ForegroundColor DarkGray
    }
    Invoke-Wrangler @deployArguments
    Write-Ok 'Deployment completed'
}
catch {
    Write-Host "`nDeployment stopped: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($script:ApiTokenSetByScript) {
        Remove-Item -Path Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    }
}
