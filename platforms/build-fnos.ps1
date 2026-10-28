#Requires -Version 7.0
<#
.SYNOPSIS
在 Windows 上打包 ScrcpyNas 的飞牛（fnOS）套件 .fpk

.DESCRIPTION
把 common/（Node 应用主体）和 platforms/fnos/（套件元数据、生命周期脚本、向导、桌面入口）
组装到 build/fnos/ 暂存目录，还原 fnpack 期望的源码布局后调用 fnpack.exe build，
manifest 声明 platform=all 单包覆盖 x86 与 arm，adb 从 common/tools 解包注入，
产物输出到 dist/

.EXAMPLE
.\platforms\build-fnos.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 构建配置
$FnpackDefaultVersion = '1.2.3'
$FnpackDocumentationUrl = 'https://developer.fnnas.com/docs/cli/fnpack/'
$FnpackDownloadUrl = 'https://static2.fnnas.com/fnpack/fnpack-{0}-windows-amd64'
$FnpackMinimumSize = 1MB

# 仓库与构建路径
$PlatformRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root         = Split-Path -Parent $PlatformRoot
$FnosDir      = Join-Path $PlatformRoot 'fnos'
$Common       = Join-Path $Root 'common'
$Stage        = Join-Path $Root (Join-Path 'build' 'fnos')
$DistDir      = Join-Path $Root 'dist'
$Fnpack       = Join-Path $Root 'fnpack.exe'
$VersionFile  = Join-Path $Common 'version'
$ToolsDir     = Join-Path $Common 'tools'
$BuildCommonScript = Join-Path $PlatformRoot 'build-common.ps1'
$ManifestSource = Join-Path $FnosDir 'manifest'
$PackageIcons = @('ICON.PNG', 'ICON_256.PNG')

if (-not (Test-Path -LiteralPath $VersionFile -PathType Leaf)) { throw '无法确定版本号：缺少 common/version' }
$PackageVersion = (Get-Content -LiteralPath $VersionFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($PackageVersion)) { throw '无法确定版本号：common/version 为空' }

# 确保用于飞牛打包的 fnpack 可执行文件可用
function Get-FnpackBinary {
    param([string]$Path)
    if (Test-Path $Path) { return }

    Write-Host '[fnpack] 未找到 fnpack.exe，开始自动下载 ...' -ForegroundColor Yellow

    $version = $FnpackDefaultVersion
    try {
        $docs = (Invoke-WebRequest -Uri $FnpackDocumentationUrl -TimeoutSec 20).Content
        $m = [regex]::Match($docs, 'fnpack-(\d+\.\d+\.\d+)-windows-amd64')
        if ($m.Success) { $version = $m.Groups[1].Value }
    }
    catch {
        Write-Warning "获取 fnpack 最新版本失败，使用固定版本 $version"
    }

    $url = $FnpackDownloadUrl -f $version
    Write-Host "[fnpack] 下载: $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $Path -TimeoutSec 300
    }
    catch {
        if (Test-Path $Path) { [System.IO.File]::Delete($Path) }
        throw "fnpack.exe 下载失败: $($_.Exception.Message)"
    }

    $size = (Get-Item $Path).Length
    if ($size -lt $FnpackMinimumSize) {
        [System.IO.File]::Delete($Path)
        throw "fnpack.exe 下载异常（仅 $size 字节），已删除，请手动下载官方版本后重试"
    }
    $probe = (& $Path --help 2>&1 | Out-String)
    if ($probe -notmatch 'Command-line utility') {
        [System.IO.File]::Delete($Path)
        throw '下载的 fnpack.exe 无法运行，已删除，请手动下载官方版本后重试'
    }
    Write-Host "[fnpack] 下载完成: $Path ($([Math]::Round($size / 1MB, 2)) MB)" -ForegroundColor Green
}

foreach ($p in @($FnosDir, $Common)) {
    if (-not (Test-Path $p)) { throw "缺少: $p" }
}
$requiredAppPaths = @(
    (Join-Path $Common 'server'),
    (Join-Path $Common 'engine'),
    $ToolsDir
)
foreach ($p in $requiredAppPaths) {
    if (-not (Test-Path $p)) { throw "缺少: $p" }
}
Get-FnpackBinary $Fnpack

# 公共函数：安全删除与文本转 LF
. $BuildCommonScript

Remove-DirChecked $Stage $Root
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
$appStage = Join-Path $Stage 'app'
New-Item -ItemType Directory -Path $appStage | Out-Null

Write-Host '[1/4] 组装应用主体 ...' -ForegroundColor Cyan

# common 下的 Node 应用主体 目录布局与旧版 fpk 的 app.tgz 保持一致
Copy-Item -Recurse (Join-Path $Common 'server')          (Join-Path $appStage 'server')
Copy-Item -Recurse (Join-Path $Common 'engine')          (Join-Path $appStage 'engine')

# adb 从 common/tools 解出两个架构写入 platform-tools 单包同时覆盖 x86 与 arm
Add-PlatformAdbBinaries -TargetDir (Join-Path $appStage 'platform-tools') -ToolsDir $ToolsDir

Write-Host '[2/4] 组装飞牛源码 ...' -ForegroundColor Cyan

# 飞牛专用文件（还原 fnpack 期望的根目录布局）
Copy-Item -Recurse (Join-Path $FnosDir 'cmd')     (Join-Path $Stage 'cmd')
Copy-Item -Recurse (Join-Path $FnosDir 'config')  (Join-Path $Stage 'config')
Copy-Item -Recurse (Join-Path $FnosDir 'wizard')  (Join-Path $Stage 'wizard')
Copy-Item $ManifestSource (Join-Path $Stage 'manifest')
foreach ($icon in $PackageIcons) {
    Copy-Item (Join-Path $FnosDir $icon) (Join-Path $Stage $icon)
}

# manifest 的版本字段必须与产物一致 platform=all 已直接写在模板中
$manifestPath = Join-Path $Stage 'manifest'
$manifest = [System.IO.File]::ReadAllText($manifestPath)
$manifest = $manifest -replace '(?m)^version\s*=.*$', ('version               = ' + $PackageVersion)
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

# 桌面入口配置与图标并入 app 包
Copy-Item -Recurse (Join-Path $FnosDir 'ui') $appStage

# 文本文件统一转 LF（无 BOM），防止 CRLF 破坏 shebang 和 JSON
$textFiles = [System.Collections.Generic.List[string]]::new()
Get-ChildItem (Join-Path $Stage 'cmd') -File | ForEach-Object { $textFiles.Add($_.FullName) }
Get-ChildItem (Join-Path $Stage 'config') -File | ForEach-Object { $textFiles.Add($_.FullName) }
Get-ChildItem (Join-Path $Stage 'wizard') -Recurse -File | ForEach-Object { $textFiles.Add($_.FullName) }
$textFiles.Add((Join-Path $Stage 'manifest'))
$textFiles.Add((Join-Path $appStage 'ui\config'))

Convert-TextFilesToLf $textFiles

Write-Host '[3/4] 调用 fnpack 打包 ...' -ForegroundColor Cyan
Push-Location $Stage
try {
    & $Fnpack build -d .
    if ($LASTEXITCODE -ne 0) {
        throw "fnpack 构建失败，退出码 $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

$fpk = Get-ChildItem -LiteralPath $Stage -Filter '*.fpk' | Select-Object -First 1
if (-not $fpk) { throw '未找到 fnpack 输出的 .fpk 文件' }

$outName = "scrcpynas-$PackageVersion-fnos.fpk"
$outPath = Join-Path $DistDir $outName
Copy-Item -LiteralPath $fpk.FullName $outPath -Force

Write-Host "[4/4] 完成: $outPath ($([Math]::Round((Get-Item $outPath).Length / 1MB, 2)) MB)" -ForegroundColor Green
