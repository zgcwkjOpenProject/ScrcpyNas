# 批量给套件图标叠加 Free 角标并覆盖源图
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
$workDir = Join-Path $root 'build\icon-badge'
$tmpDir = Join-Path $workDir 'tmp'
$bakDir = Join-Path $workDir 'orig-backup'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

. (Join-Path $PSScriptRoot 'free-badge-lib.ps1')
$ffmpeg = Resolve-Ffmpeg

# 每个像素尺寸对应要覆盖的文件
$groups = @(
    [pscustomobject]@{ Px = 512; Files = @('platforms\fnos\ICON.PNG', 'platforms\fnos\ui\images\icon_256.webp', 'platforms\synology\PACKAGE_ICON.PNG', 'platforms\synology\package\ui\images\icon_256.png') },
    [pscustomobject]@{ Px = 256; Files = @('platforms\fnos\ICON_256.PNG', 'platforms\fnos\ui\images\icon_128.webp', 'platforms\synology\PACKAGE_ICON_256.PNG', 'platforms\synology\package\ui\images\icon_128.png') },
    [pscustomobject]@{ Px = 144; Files = @('platforms\fnos\ui\images\icon_72.webp', 'platforms\synology\package\ui\images\icon_72.png') },
    [pscustomobject]@{ Px = 128; Files = @('platforms\fnos\ui\images\icon_64.webp', 'platforms\synology\package\ui\images\icon_64.png') },
    [pscustomobject]@{ Px = 96; Files = @('platforms\fnos\ui\images\icon_48.webp', 'platforms\synology\package\ui\images\icon_48.png') },
    [pscustomobject]@{ Px = 64; Files = @('platforms\fnos\ui\images\icon_32.webp', 'platforms\synology\package\ui\images\icon_32.png') },
    [pscustomobject]@{ Px = 48; Files = @('platforms\fnos\ui\images\icon_24.webp', 'platforms\synology\package\ui\images\icon_24.png') },
    [pscustomobject]@{ Px = 32; Files = @('platforms\fnos\ui\images\icon_16.webp', 'platforms\synology\package\ui\images\icon_16.png') }
)

# 备份原始文件，已存在则跳过
foreach ($group in $groups) {
    foreach ($rel in $group.Files) {
        $src = Join-Path $root $rel
        $dst = Join-Path $bakDir $rel
        if (Test-Path $dst) { continue }
        New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
        Copy-Item $src $dst -Force
    }
}
Write-Host ('备份完成 ' + (Get-ChildItem $bakDir -Recurse -File | Measure-Object).Count + ' 个文件')

# 合成 512 基准图，源图取备份避免重复叠加
$base = Load-Argb (Join-Path $bakDir 'platforms\fnos\ICON.PNG')
$withText = Add-Badge -Base $base -WithText $true
$plain = Add-Badge -Base $base -WithText $false
$plain.Save((Join-Path $tmpDir 'plain-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$withText.Save((Join-Path $tmpDir 'text-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$withText.Dispose()
$plain.Dispose()
$base.Dispose()
Write-Host '基准图合成完成'

# 按真实像素生成各尺寸，128 以上用带文字版本
foreach ($group in $groups) {
    $source = if ($group.Px -ge 128) { Join-Path $tmpDir 'text-512.png' } else { Join-Path $tmpDir 'plain-512.png' }
    $png = Join-Path $tmpDir ('s' + $group.Px + '.png')
    if ($group.Px -eq 512) {
        & $ffmpeg -v error -y -i $source -pix_fmt rgba $png
    }
    else {
        & $ffmpeg -v error -y -i $source -vf ('scale=' + $group.Px + ':' + $group.Px + ':flags=lanczos') -pix_fmt rgba $png
    }
    if ($LASTEXITCODE -ne 0) { throw ('ffmpeg 缩放失败 ' + $group.Px) }
}
Write-Host '尺寸生成完成'

# 覆盖目标文件，webp 走无损编码保留透明通道
foreach ($group in $groups) {
    $png = Join-Path $tmpDir ('s' + $group.Px + '.png')
    foreach ($rel in $group.Files) {
        $dst = Join-Path $root $rel
        if ($rel.EndsWith('.webp')) {
            & $ffmpeg -v error -y -i $png -c:v libwebp -lossless 1 $dst
            if ($LASTEXITCODE -ne 0) { throw ('webp 编码失败 ' + $rel) }
        }
        else {
            Copy-Item $png $dst -Force
        }
        ('{0,-4} {1,-52} {2}' -f $group.Px, $rel, (Get-Item $dst).Length)
    }
}
