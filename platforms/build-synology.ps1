#Requires -Version 7.0
<#
.SYNOPSIS
在 Windows 上打包 ScrcpyNas 的群晖（Synology DSM 7）套件 .spk

.DESCRIPTION
把 common/（Node 应用主体）和 platforms/synology/（套件元数据、生命周期脚本、DSM 配置）
组装到 build/synology/ 暂存目录，Node 运行时依赖 DSM 套件中心的官方 Node.js_v22 套件，
INFO 的 arch 声明 x86_64 与 aarch64 单包覆盖两类架构，adb 从 common/tools 解包注入，
用 .NET System.Formats.Tar 生成 tar 并显式写入 Unix 权限位，文本文件统一转成 LF，
产物输出到 dist/

版本号从 common/version 读取，无需也无法通过参数覆盖

.EXAMPLE
.\platforms\build-synology.ps1
.\platforms\build-synology.ps1 -SkipVerify
#>
[CmdletBinding()]
param(
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 构建配置
$PackageFlavor = 'synology'
$PackageIconNames = @('PACKAGE_ICON.PNG', 'PACKAGE_ICON_256.PNG')

# 仓库与构建路径
$PlatformRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root         = Split-Path -Parent $PlatformRoot
$SynoDir      = Join-Path $PlatformRoot 'synology'
$Common       = Join-Path $Root 'common'
$DistDir      = Join-Path $Root 'dist'
$WorkDir      = Join-Path $Root (Join-Path 'build' 'synology')
$Payload      = Join-Path $WorkDir 'payload'
$SpkRoot      = Join-Path $WorkDir 'spkroot'
$PkgTgz       = Join-Path $SpkRoot 'package.tgz'
$VersionFile  = Join-Path $Common 'version'
$ToolsDir     = Join-Path $Common 'tools'
$BuildCommonScript = Join-Path $PlatformRoot 'build-common.ps1'
$InfoTemplate = Join-Path $SynoDir 'INFO'
$PackageSource = Join-Path $SynoDir 'package'
$ScriptsSource = Join-Path $SynoDir 'scripts'
$ConfSource   = Join-Path $SynoDir 'conf'
$WizardSource = Join-Path $SynoDir 'WIZARD_UIFILES'
$PackageIconSource = Join-Path $SynoDir $PackageIconNames[0]
$PackageIcon256Source = Join-Path $SynoDir $PackageIconNames[1]

if (-not (Test-Path -LiteralPath $VersionFile -PathType Leaf)) { throw '无法确定版本号：缺少 common/version' }
$Version = (Get-Content -LiteralPath $VersionFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($Version)) { throw '无法确定版本号：common/version 为空' }

# ---------------------------------------------------------------------------
# 前置检查
# ---------------------------------------------------------------------------
try { Add-Type -AssemblyName System.Formats.Tar -ErrorAction Stop }
catch { throw '需要 PowerShell 7+（依赖 System.Formats.Tar）。请用 pwsh 运行本脚本。' }

$requiredPaths = @(
    (Join-Path $Common 'server'),
    (Join-Path $Common 'engine'),
    $ToolsDir,
    $PackageSource,
    $ScriptsSource,
    $ConfSource,
    $WizardSource,
    $InfoTemplate,
    $PackageIconSource,
    $PackageIcon256Source
)
foreach ($p in $requiredPaths) {
    if (-not (Test-Path $p)) { throw "缺少必需文件或目录: $p" }
}

# 公共函数：安全删除 文本转 LF tar 写入辅助
. $BuildCommonScript

# 安全删除仓库内的暂存目录
Remove-DirChecked $WorkDir $Root

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
New-Item -ItemType Directory -Path $Payload | Out-Null
New-Item -ItemType Directory -Path $SpkRoot | Out-Null

Write-Host "[1/4] 组装 payload ..." -ForegroundColor Cyan

New-Item -ItemType Directory -Path (Join-Path $Payload 'app') | Out-Null

# common 下的 Node 应用主体 目录布局与飞牛包的 app.tgz 保持一致
Copy-Item -Recurse (Join-Path $Common 'server')          (Join-Path $Payload 'app\server')
Copy-Item -Recurse (Join-Path $Common 'engine')          (Join-Path $Payload 'app\engine')

# adb 从 common/tools 解出两个架构写入 platform-tools 单包同时覆盖 x86 与 arm
Add-PlatformAdbBinaries -TargetDir (Join-Path $Payload 'app\platform-tools') -ToolsDir $ToolsDir

# 群晖专用静态文件 平台外壳在 platforms/synology/ 公共运行时从 common/ 注入
Copy-Item (Join-Path $PackageSource 'app/start.sh') (Join-Path $Payload 'app\start.sh')
Copy-Item -Recurse (Join-Path $PackageSource 'ui')  (Join-Path $Payload 'ui')
Copy-Item -Recurse (Join-Path $PackageSource 'etc') (Join-Path $Payload 'etc')

# DSM 桌面入口配置里的展示版本跟随 INFO 避免模板版本漏同步
$uiConfigPath = Join-Path $Payload 'ui\config'
$uiConfig = Get-Content -Raw $uiConfigPath | ConvertFrom-Json
$uiConfig.'Main.js'.'SYNO.SDS.ScrcpyNasFree.Instance'.version = $Version
$uiConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $uiConfigPath -Encoding utf8NoBOM

# spk 根目录文件
Copy-Item -Recurse $ScriptsSource (Join-Path $SpkRoot 'scripts')
Copy-Item -Recurse $ConfSource (Join-Path $SpkRoot 'conf')
Copy-Item -Recurse $WizardSource (Join-Path $SpkRoot 'WIZARD_UIFILES')
Copy-Item $PackageIconSource (Join-Path $SpkRoot $PackageIconNames[0])
Copy-Item $PackageIcon256Source (Join-Path $SpkRoot $PackageIconNames[1])

# INFO：注入版本 arch=x86_64 aarch64 已直接写在模板中
$info = Get-Content -Raw $InfoTemplate
# (?m) 让 ^ 锚定每行行首 version= 不在文件首行 默认单行模式会静默漏匹配
$info = $info -replace '(?m)^version="[^"]*"', ('version="' + $Version + '"')
[System.IO.File]::WriteAllText(
    (Join-Path $SpkRoot 'INFO'),
    $info,
    [System.Text.UTF8Encoding]::new($false)
)

# ---------------------------------------------------------------------------
# 文本文件统一转 LF（无 BOM），防止 CRLF 破坏 shebang 和 JSON
# ---------------------------------------------------------------------------
$textFiles = [System.Collections.Generic.List[string]]::new()
Get-ChildItem (Join-Path $SpkRoot 'scripts') -File | ForEach-Object { $textFiles.Add($_.FullName) }
Get-ChildItem (Join-Path $SpkRoot 'conf') -Recurse -File | ForEach-Object { $textFiles.Add($_.FullName) }
Get-ChildItem (Join-Path $SpkRoot 'WIZARD_UIFILES') -File | ForEach-Object { $textFiles.Add($_.FullName) }
$textFiles.Add((Join-Path $SpkRoot 'INFO'))
$textFiles.Add((Join-Path $Payload 'app\start.sh'))
$textFiles.Add((Join-Path $Payload 'ui\config'))
$textFiles.Add((Join-Path $Payload 'etc\www\scrcpynas.nginx.conf'))

Convert-TextFilesToLf $textFiles

# ---------------------------------------------------------------------------
# 生成 package.tgz（gzip tar）
# ---------------------------------------------------------------------------
Write-Host "[2/4] 生成 package.tgz ..." -ForegroundColor Cyan

$pkgFs = [System.IO.File]::Open($PkgTgz, [System.IO.FileMode]::Create)
$gzip = [System.IO.Compression.GZipStream]::new(
    $pkgFs,
    [System.IO.Compression.CompressionLevel]::SmallestSize
)
$pkgWriter = [System.Formats.Tar.TarWriter]::new($gzip, $false)
try {
    # 启动脚本与两个架构的 adb 需要可执行权限 其余文件按普通文件权限写入
    $execSet = @{
        'app/start.sh'                  = $true
        'app/platform-tools/x86_64/adb' = $true
        'app/platform-tools/arm64/adb'  = $true
    }
    Add-Tree -Writer $pkgWriter -Root $Payload -ExecSet $execSet
}
finally {
    $pkgWriter.Dispose()   # 会连带关闭 gzip 和文件流
}

# ---------------------------------------------------------------------------
# 生成 .spk（普通 tar）
# ---------------------------------------------------------------------------
Write-Host "[3/4] 生成 .spk ..." -ForegroundColor Cyan

$spkName = "scrcpynas-$Version-$PackageFlavor.spk"
$spkPath = Join-Path $DistDir $spkName

$spkFs = [System.IO.File]::Open($spkPath, [System.IO.FileMode]::Create)
$spkWriter = [System.Formats.Tar.TarWriter]::new($spkFs, $false)
try {
    Add-TarFile -Writer $spkWriter -Source (Join-Path $SpkRoot 'INFO') -Name 'INFO'
    Add-TarFile -Writer $spkWriter -Source (Join-Path $SpkRoot 'PACKAGE_ICON.PNG') -Name 'PACKAGE_ICON.PNG'
    Add-TarFile -Writer $spkWriter -Source (Join-Path $SpkRoot 'PACKAGE_ICON_256.PNG') -Name 'PACKAGE_ICON_256.PNG'
    Add-TarFile -Writer $spkWriter -Source $PkgTgz -Name 'package.tgz'

    Add-TarDirectory -Writer $spkWriter -Name 'scripts'
    Get-ChildItem (Join-Path $SpkRoot 'scripts') -File | ForEach-Object {
        Add-TarFile -Writer $spkWriter -Source $_.FullName -Name "scripts/$($_.Name)" -ModeOctal '755'
    }

    Add-TarDirectory -Writer $spkWriter -Name 'conf'
    Add-TarFile -Writer $spkWriter -Source (Join-Path $SpkRoot 'conf/privilege') -Name 'conf/privilege'
    Add-TarFile -Writer $spkWriter -Source (Join-Path $SpkRoot 'conf/resource') -Name 'conf/resource'
    Add-TarDirectory -Writer $spkWriter -Name 'conf/systemd'
    Add-TarFile -Writer $spkWriter -Source (Join-Path $SpkRoot 'conf/systemd/pkguser-scrcpynas.service') -Name 'conf/systemd/pkguser-scrcpynas.service'

    Add-TarDirectory -Writer $spkWriter -Name 'WIZARD_UIFILES'
    Get-ChildItem (Join-Path $SpkRoot 'WIZARD_UIFILES') -File | Sort-Object Name | ForEach-Object {
        Add-TarFile -Writer $spkWriter -Source $_.FullName -Name "WIZARD_UIFILES/$($_.Name)"
    }
}
finally {
    $spkWriter.Dispose()
}

# ---------------------------------------------------------------------------
# 验证
# ---------------------------------------------------------------------------
Write-Host "[4/4] 验证产物 ..." -ForegroundColor Cyan

$sizeMB = [Math]::Round((Get-Item $spkPath).Length / 1MB, 2)
Write-Host "产物: $spkPath ($sizeMB MB)"

if (-not $SkipVerify) {
    Write-Host "`n===== .spk 内容 ====="
    tar.exe -tvf $spkPath

    Write-Host "`n===== package.tgz 前 15 条 ====="
    tar.exe -xf $spkPath -C $WorkDir 'package.tgz'
    tar.exe -tzvf (Join-Path $WorkDir 'package.tgz') | Select-Object -First 15
}

Write-Host "`n构建完成。安装：套件中心 -> 手动安装，或 SSH 执行" -ForegroundColor Green
Write-Host "sudo synopkg install $spkName"
