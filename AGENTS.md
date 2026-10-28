# ScrcpyNas 项目开发规范

本文件是仓库开发规范的唯一入口。开始任何开发、排查或代码审查前先阅读本文件；完成改动后按文末清单验证。项目行为细节以本文件和代码为准

## 项目定位

ScrcpyNas 是运行在飞牛 fnOS 和群晖 DSM 7 上的 Android 无线投屏与控制套件（Node.js 版）。核心使用 Node.js 实现，基于 ws-scrcpy 引擎启动 `scrcpy-server.jar`，浏览器通过 HTTP 和 WebSocket 使用投屏、控制和 Shell 终端

## 目录职责

- `common/`：各平台共用的 Node.js 服务、ws-scrcpy 引擎与 ADB 工具
- `common/server/`：编排服务，负责环境变量、端口和目录布局的启动逻辑
- `common/engine/`：ws-scrcpy 引擎及其 `node_modules`（第三方依赖，保守修改）
- `common/tools/`：各架构的 Linux adb 压缩包（linux amd64 与 arm64），构建时解包进套件
- `common/version`：版本号唯一来源
- `platforms/`：飞牛与群晖的套件外壳、构建脚本及平台元数据
- `platforms/build-common.ps1`：构建公共函数（暂存清理、LF 转换、tar 写入辅助）
- `platforms/build-fnos.ps1`：飞牛 `.fpk` 构建脚本
- `platforms/build-synology.ps1`：群晖 DSM 7 `.spk` 构建脚本
- `build.ps1`：一键构建全部发布产物的交互入口
- `build/`：构建暂存与 Node 运行时缓存（可再生，不入库）
- `dist/`：打包产物唯一存放位置（不入库）

## 通用约束

- 未经用户明确要求，不提交 Git、不创建提交、不代替用户打包
- 保留工作区已有改动，不擅自还原或覆盖无关文件
- 优先沿用现有代码风格、目录结构和模块，避免无关重构
- 打包产物只能放根目录 `dist/`，构建暂存只能放根目录 `build/`
- 本地调试需独立设置 `NODE_PATH`、`PORT` 与 `WS_SCRCPY_PORT` 环境变量，测试结束必须停止启动的进程并确认监听端口已释放
- 不将真实设备 IP、端口、序列号、设备名称、连接日志或由其生成的 `devices.json` 纳入 Git
- 代码、文档、脚本输出和提交说明只记录实际行为、必要约束和维护信息
- 改动覆盖到的文件，顺手补齐其中原本缺失的注释
- 版本号唯一来源是 `common/version`；构建脚本在 `build/` 暂存副本注入版本，平台元数据保持模板值
- 群晖套件依赖 DSM 套件中心的官方 Node.js_v22 套件，构建脚本不下载也不内置 Node 运行时

## 注释规范

- 每个函数和方法都要有上一行简短中文用途注释
- 注释说明做什么或为什么，用一句简短陈述句表达；不删除原本有用的分节和说明注释
- 变量、常量和重要结构字段需要中文注释，尤其是 `const` 块和配置字段
- 注释必须与当前实现一致；修改行为、默认值或生命周期时同步更新受影响的注释
- 不为显而易见的赋值、分支或语法添加注释
- 注释只描述功能，不写具体数值（尺寸、权限位、默认值、端口、格式串、超时等由代码决定）
- 注释末尾不加中文或英文标点；中间可以正常使用标点
- 注释审计覆盖仓库自有 JavaScript、HTML、CSS、PowerShell 和 Shell，排除 `common/engine/node_modules/` 等第三方目录

## 前端约定

- 自有前端布局统一优先使用 Flex；只有 Flex 无法表达的布局才使用 CSS Grid
- 自有前端代码统一使用单引号并省略语句行尾分号
- 注释审计与样式改动不覆盖 `common/engine/` 内的 ws-scrcpy 原生页面，只覆盖 `common/server/lib/public/` 下的自有页面

## 改动验证清单

- 新增或修改的函数都有中文用途注释，且末尾不带标点
- 构建脚本改动后运行 `./build.ps1` 验证产物生成到 `dist/`
- 平台元数据（manifest/INFO/ui config）的版本注入在暂存副本中生效
- 测试进程已停止，监听端口已释放
