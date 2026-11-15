# 图标 Free 角标合成函数库
Add-Type -AssemblyName System.Drawing

# 角标斜带填充色
$script:BandColor = [System.Drawing.Color]::FromArgb(244, 81, 30)

# 载入底图为 32 位 ARGB
function Load-Argb {
    param([string]$Path)
    $img = [System.Drawing.Image]::FromFile($Path)
    $bmp = New-Object System.Drawing.Bitmap $img.Width, $img.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $rect = New-Object System.Drawing.Rectangle 0, 0, $img.Width, $img.Height
    $g.DrawImage($img, $rect)
    $g.Dispose()
    $img.Dispose()
    return $bmp
}

# 按底图 alpha 裁剪图层
function Mask-Alpha {
    param([System.Drawing.Bitmap]$Layer, [System.Drawing.Bitmap]$Mask)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $Layer.Width, $Layer.Height
    $ld = $Layer.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $md = $Mask.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $len = [Math]::Abs($ld.Stride) * $ld.Height
    $lb = New-Object byte[] $len
    $mb = New-Object byte[] $len
    [System.Runtime.InteropServices.Marshal]::Copy($ld.Scan0, $lb, 0, $len)
    [System.Runtime.InteropServices.Marshal]::Copy($md.Scan0, $mb, 0, $len)
    for ($i = 3; $i -lt $len; $i += 4) {
        $a = $mb[$i]
        if ($a -eq 0) { $lb[$i] = 0 }
        elseif ($a -lt 255) { $lb[$i] = [byte]([int]$lb[$i] * $a / 255) }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($lb, 0, $ld.Scan0, $len)
    $Layer.UnlockBits($ld)
    $Mask.UnlockBits($md)
}

# 在右上角叠加 Free 角标
function Add-Badge {
    param([System.Drawing.Bitmap]$Base, [bool]$WithText)
    $w = $Base.Width
    $h = $Base.Height
    # 斜带长度与带宽，长度取足够值让两端插到上边和右边外
    $bl = $w * 0.680
    $bw = $w * 0.125
    # 斜带中心落在右上角对角线上
    $cx = [float]($w * 0.800)
    $cy = [float]($w * 0.200)
    $layer = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($layer)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.TranslateTransform($cx, $cy)
    # 正角度旋转得到反斜杠方向
    $g.RotateTransform([float]45)
    $brush = New-Object System.Drawing.SolidBrush $script:BandColor
    $g.FillRectangle($brush, [float](-$bl / 2), [float](-$bw / 2), [float]$bl, [float]$bw)
    $brush.Dispose()
    if ($WithText) {
        # 字号按带高换算，上下各留一点白
        $em = [float]($bw * 1.10)
        $maxLen = $bl * 0.940
        $maxHigh = $bw * 2.200
        $fmt = New-Object System.Drawing.StringFormat
        $fmt.Alignment = [System.Drawing.StringAlignment]::Center
        $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
        $font = $null
        while ($em -gt 8) {
            $font = New-Object System.Drawing.Font 'Arial', $em, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
            $sz = $g.MeasureString('FREE', $font)
            if ($sz.Width -le $maxLen -and $sz.Height -le $maxHigh) { break }
            $font.Dispose()
            $font = $null
            $em -= 1
        }
        if ($null -ne $font) {
            $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
            $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
            # 补偿字形盒与测量盒的行距差，让文字在带内垂直居中
            $g.DrawString('FREE', $font, $white, [float]0, [float]($em * 0.090), $fmt)
            $white.Dispose()
            $font.Dispose()
        }
        $fmt.Dispose()
    }
    $g.Dispose()
    Mask-Alpha -Layer $layer -Mask $Base
    $result = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($result)
    # 先用 SourceCopy 铺底图再叠角标，避免角标销毁底图
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $g.DrawImage($Base, $rect)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.DrawImage($layer, $rect)
    $g.Dispose()
    $layer.Dispose()
    return $result
}

# 等比缩放图标
function Resize-Icon {
    param([System.Drawing.Bitmap]$Src, [int]$Size)
    $dst = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $srcRect = New-Object System.Drawing.Rectangle 0, 0, $Src.Width, $Src.Height
    $g.DrawImage($Src, $rect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    return $dst
}

# 优先取环境变量指向的 ffmpeg，否则用 PATH 中的
function Resolve-Ffmpeg {
    if ($env:FFMPEG_BIN) { return $env:FFMPEG_BIN }
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { throw '未找到 ffmpeg，请安装到 PATH 或设置 FFMPEG_BIN' }
    return $cmd.Source
}
