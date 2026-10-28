# ws-scrcpy engine 更新说明

`common/engine/` 是 `ws-scrcpy` 的 vendor 目录。不要在这里做 scrcpyNas
业务改动；群晖、飞牛、鉴权、日志、端口代理、输入适配都应放在外层
`common/server/` 或平台目录里。

## 运行边界

套件启动时先运行 `app/server/server.js`，再由它启动 engine：

```text
飞牛入口 / 群晖 Webman 入口
  -> app/server/server.js
  -> /scrcpy/ 反向代理到 127.0.0.1:8128
  -> app/engine/index.js 或 app/engine/dist/index.js
```

外层服务会做这些适配：

- 写入 `WS_SCRCPY_CONFIG`，让 engine 监听内部端口 `8128`。
- 通过外层启动器把 engine 的 `listen(8128)` 收紧到 `127.0.0.1`，避免
  `8128` 被外网直接访问。
- 把公开的 `/scrcpy/` 路径反代到 engine 根路径。
- 给 engine 页面注入外层控制脚本和投屏样式。
- 通过 `/api/device/input` 补充右键返回、中键桌面；键盘输入走 ws-scrcpy
  原生 `captureKeyboard` 参数。

因此更新 engine 时，优先改 `common/server/` 的注入或代理逻辑，不要直接改
`common/engine/`。

## 更新步骤

1. 准备新版 `ws-scrcpy` 可运行产物，至少包含：
   `index.js` 或 `dist/index.js`、`public/`、`node_modules/`、`package.json`。
2. 备份当前 `common/engine/`。
3. 删除旧 `common/engine/`，用新版目录整体替换。
4. 只保留本 README 作为目录维护说明，不要把 scrcpyNas 业务补丁写进
   `common/engine/`。
5. 检查新版仍包含 `public/index.html`、`public/main.css`、`public/bundle.js`
   或等价入口；如果文件名变化，修改 `common/server/server.js` 的外层注入逻辑。
6. 运行语法检查：
   ```powershell
   Get-ChildItem common\server -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
   ```
7. 重新打包：
   ```powershell
   .\build-fnos.ps1
   .\build-synology.ps1
   ```

## 更新后检查

- 管理页能打开 `/scrcpy/`。
- `/scrcpy/main.css` 或新版等价 CSS 仍能追加投屏页样式。
- engine 首页仍能被注入 `scrcpy-official-controls.js`。
- MSE 播放、触摸、右键返回、中键桌面、原生键盘输入都正常。
- `scrcpy-server.jar` 在新版 engine 中仍能被找到。
