# 生成带 Free 角标的图标小样，输出到构建暂存目录
$root = Split-Path (Split-Path $PSScriptRoot)
$devDir = Join-Path $root 'build\icon-badge\preview'
New-Item -ItemType Directory -Force -Path $devDir | Out-Null

. (Join-Path $PSScriptRoot 'free-badge-lib.ps1')

$base = Load-Argb (Join-Path $root 'platforms\fnos\ICON.PNG')
$withText = Add-Badge -Base $base -WithText $true
$plain = Add-Badge -Base $base -WithText $false

# 大尺寸带文字，小尺寸只用色带
foreach ($size in @(512, 256, 144, 128, 96, 64, 48, 32)) {
    $src = if ($size -ge 128) { $withText } else { $plain }
    $img = if ($size -eq 512) { $src } else { Resize-Icon -Src $src -Size $size }
    $img.Save((Join-Path $devDir "preview-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    if ($size -ne 512) { $img.Dispose() }
}

$withText.Dispose()
$plain.Dispose()
$base.Dispose()

Get-ChildItem $devDir | Select-Object Name, Length | Format-Table -AutoSize | Out-String
