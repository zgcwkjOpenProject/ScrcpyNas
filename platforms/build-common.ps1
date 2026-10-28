# 平台打包脚本共用函数

# 安全删除仓库内的暂存目录 越出仓库根即拒绝
function Remove-DirChecked([string]$Path, [string]$Root) {
    if (Test-Path $Path) {
        $resolved = (Resolve-Path $Path).Path
        if (-not $resolved.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "拒绝删除预期之外的路径: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

# 文本文件统一转 LF 无 BOM 防止 CRLF 破坏 shebang 和 JSON
function Convert-TextFilesToLf([System.Collections.Generic.List[string]]$Files) {
    foreach ($f in $Files) {
        $content = [System.IO.File]::ReadAllText($f)
        $content = $content -replace "`r`n", "`n"
        [System.IO.File]::WriteAllText($f, $content, [System.Text.UTF8Encoding]::new($false))
    }
}

# 从 common/tools 解出两个架构的 adb 到套件 payload 的 platform-tools 目录 单包同时覆盖 x86 与 arm
function Add-PlatformAdbBinaries([string]$TargetDir, [string]$ToolsDir) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # 压缩包文件名到目标子目录的映射 linux amd64/arm64 命名落到 x86_64/arm64
    $map = [ordered]@{
        'adb-linux-amd64.zip' = 'x86_64'
        'adb-linux-arm64.zip' = 'arm64'
    }
    foreach ($zipName in $map.Keys) {
        $zipPath = Join-Path $ToolsDir $zipName
        if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { throw "缺少 adb 压缩包: $zipPath" }

        # 与 sha256 文件比对 防止压缩包损坏或不完整
        $expected = ((Get-Content -LiteralPath "$zipPath.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expected -ne $actual) { throw "adb 压缩包校验失败: $zipPath" }

        $destDir = Join-Path $TargetDir $map[$zipName]
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null

        # 压缩包内只有一个 adb 取首个同名条目解到目标目录
        $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $entry = $zip.Entries | Where-Object { $_.Name -eq 'adb' } |
                Sort-Object { $_.FullName.Length } | Select-Object -First 1
            if (-not $entry) { throw "$zipName 中未找到 adb 文件" }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile(
                $entry, (Join-Path $destDir 'adb'), $true)
        }
        finally {
            $zip.Dispose()
        }
    }
}

# 写入目录条目到 tar
function Add-TarDirectory {
    param(
        [System.Formats.Tar.TarWriter]$Writer,
        [string]$Name
    )
    $entry = [System.Formats.Tar.PaxTarEntry]::new(
        [System.Formats.Tar.TarEntryType]::Directory,
        ($Name.TrimEnd('/') + '/')
    )
    $entry.Mode = [System.IO.UnixFileMode]([Convert]::ToInt32('755', 8))
    $Writer.WriteEntry($entry)
}

# 写入单个文件到 tar 并显式指定 Unix 权限位
function Add-TarFile {
    param(
        [System.Formats.Tar.TarWriter]$Writer,
        [string]$Source,
        [string]$Name,
        [string]$ModeOctal = '644'
    )
    $mode = [System.IO.UnixFileMode]([Convert]::ToInt32($ModeOctal, 8))
    $fs = [System.IO.File]::OpenRead($Source)
    try {
        $entry = [System.Formats.Tar.PaxTarEntry]::new(
            [System.Formats.Tar.TarEntryType]::RegularFile,
            ($Name -replace '\\', '/')
        )
        $entry.Mode = $mode
        $entry.DataStream = $fs
        $Writer.WriteEntry($entry)
    }
    finally {
        $fs.Dispose()
    }
}

# 递归写入目录树到 tar 并按 ExecSet 标记可执行文件
function Add-Tree {
    param(
        [System.Formats.Tar.TarWriter]$Writer,
        [string]$Root,
        [string]$Prefix = '',
        [hashtable]$ExecSet = @{ }
    )
    Get-ChildItem -LiteralPath $Root -Force | ForEach-Object {
        $rel = if ($Prefix) { "$Prefix/$($_.Name)" } else { $_.Name }
        if ($_.PSIsContainer) {
            Add-TarDirectory -Writer $Writer -Name $rel
            Add-Tree -Writer $Writer -Root $_.FullName -Prefix $rel -ExecSet $ExecSet
        }
        else {
            $mode = if ($ExecSet.ContainsKey($rel)) { '755' } else { '644' }
            Add-TarFile -Writer $Writer -Source $_.FullName -Name $rel -ModeOctal $mode
        }
    }
}
