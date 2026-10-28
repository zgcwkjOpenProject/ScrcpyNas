# ScrcpyNas 群晖（DSM 7）平台

本目录存放群晖 DSM 7 套件（.spk）的平台专属物料，构建入口为 `platforms/build-synology.ps1`

## 目录职责

- `INFO`：套件元数据模板，version 由构建脚本注入，`arch` 直接声明 x86_64 与 aarch64 单包覆盖两类架构
- `PACKAGE_ICON.PNG` / `PACKAGE_ICON_256.PNG`：套件中心图标
- `conf/`：套件特权、Webman/nginx 资源声明与 systemd 用户服务单元
- `scripts/`：DSM 套件生命周期脚本（安装、卸载、升级、启停）
- `package/app/start.sh`：Node 应用启动脚本，由 systemd 服务调用
- `package/etc/www/`：DSM nginx 反代配置
- `package/ui/`：DSM 桌面入口（Main.js 与 config）

## 与新版（Go 版）的差异

- 应用主体是 `common/` 下的 Node 服务（server + engine），没有 Go 编译步骤
- Node 运行时依赖 DSM 套件中心的官方 Node.js_v22 套件（INFO 声明 `install_dep_packages`，`start.sh` 按 v22→v20→v18→v16 探测）
- 连接记录 `devices.json` 与日志通过环境变量直接写入套件数据目录 `var/app/`，无需在程序目录与数据目录之间搬移
- 无线 adb 从 `common/tools/` 解包注入 package.tgz，单包同时支持 x86_64 与 aarch64
