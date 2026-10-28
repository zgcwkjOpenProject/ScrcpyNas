# ScrcpyNas

ScrcpyNas 是 Android 投屏与控制套件（Node.js 版），提供飞牛 fnOS `.fpk` 和群晖 DSM 7 `.spk` 两种 NAS 套件

## 功能

- 通过 Android 无线调试完成配对、连接和断开
- 在浏览器中投屏，支持多种分辨率限制
- 支持触控、键盘输入、返回、桌面、Shell 操作及文件管理
- 保存设备连接记录和运行日志

## 实现

- `common/` 是各平台共用的 Node.js 核心，`server/` 负责服务编排，`engine/` 是 ws-scrcpy 引擎（含 `node_modules`）
- `common/tools/` 存放 Linux adb 压缩包（amd64 与 arm64），构建时解包进套件，开发态直接用 PATH 里的系统 adb
- 每个平台只有一个安装包，飞牛 manifest 声明 `platform=all`，群晖 INFO 的 `arch` 同时声明 x86_64 与 aarch64
- `platforms/` 集中存放飞牛与群晖的套件外壳（cmd、config、wizard、scripts、conf 等）及各平台构建脚本；构建只在根目录 `build/` 暂存，产物只写入根目录 `dist/`
- 飞牛套件依赖平台提供的 `nodejs_v24` 运行时；群晖套件依赖 DSM 套件中心的官方 Node.js_v22 套件
- 版本号唯一来源是 `common/version`，构建时注入平台元数据

主要目录：

```text
common/                       共用 Node.js 核心和引擎
common/server/                编排服务入口
common/engine/                ws-scrcpy 引擎（含 node_modules）
common/tools/                 各架构 Linux adb 压缩包
platforms/                    套件外壳和构建脚本
platforms/fnos/               飞牛套件外壳
platforms/synology/           群晖 DSM 7 套件外壳
platforms/build-common.ps1    构建公共函数
platforms/build-fnos.ps1      飞牛 .fpk 构建脚本
platforms/build-synology.ps1  群晖 .spk 构建脚本
build.ps1                     一键构建全部发布产物
```

## 开发文档

- 仓库开发规范：[AGENTS.md](AGENTS.md)
- 飞牛 fnOS 套件开发：[开发指南](https://developer.fnnas.com/docs/guide)，用于查询 `.fpk` 打包、权限和桌面入口配置
- 群晖 DSM 套件开发：[开发指南](https://help.synology.cn/developer-guide/)，用于查询 `.spk` 打包、Webman 入口和权限配置

## 本地调试

在 PowerShell 中于仓库根目录执行：

```powershell
$env:NODE_PATH = "$PWD\common\engine\node_modules"
$env:PORT = '18129'
$env:WS_SCRCPY_PORT = '18128'
node common\server\server.js
```

## 构建

在 PowerShell 7 中执行 `./build.ps1`，按提示选择要构建的平台脚本；输入 `0` 构建全部，输入多个编号（用逗号或空格分隔）构建指定平台。所有构建版本从 `common/version` 读取

- 飞牛：`platforms/build-fnos.ps1` 生成 `dist/scrcpynas-<版本>-fnos.fpk`，依赖 `fnpack.exe`（缺失时自动下载）
- 群晖：`platforms/build-synology.ps1` 生成 `dist/scrcpynas-<版本>-synology.spk`，不下载也不内置 Node 运行时，安装时依赖 DSM 套件中心的官方 Node.js_v22 套件

## 许可证

[Apache-2.0](LICENSE)

