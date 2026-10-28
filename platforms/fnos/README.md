# ScrcpyNas 飞牛（fnOS）平台

本目录存放飞牛 fnOS 套件（.fpk）的平台专属物料，构建入口为 `platforms/build-fnos.ps1`

## 目录职责

- `manifest`：套件元数据，version 由构建脚本注入，`platform=all` 单包覆盖 x86 与 arm
- `ICON.PNG` / `ICON_256.PNG`：套件中心图标
- `cmd/`：套件生命周期脚本（main 负责启停 Node 服务）
- `config/`：套件特权与资源声明
- `wizard/`：安装/卸载向导文案
- `ui/`：桌面入口图标与配置，打包时并入 app.tgz 的 `ui/`

## 依赖

- 应用主体来自 `common/`（server + engine），adb 从 `common/tools/` 解包注入
- 运行时依赖套件市场的 `nodejs_v24`，由 `cmd/main` 解析 Node 可执行文件
- 打包使用仓库根目录的 `fnpack.exe`（缺失时构建脚本自动从飞牛官网下载）
