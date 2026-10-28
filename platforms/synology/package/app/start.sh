#!/bin/sh
# systemd 以套件用户运行本脚本
# 程序主体在包内 app 子目录

APP_DIR="/var/packages/scrcpynasfree/target/app"
PKGVAR="/var/packages/scrcpynasfree/var"
DATA_DIR="$PKGVAR/app"
ARCH_DIR="$APP_DIR/platform-tools"
ENGINE_DIR="$APP_DIR/engine"

APP_LOG_FILE="$DATA_DIR/scrcpynas.log"

# 按机器架构选择 platform-tools 子目录
case "$(uname -m)" in
    x86_64)
        PT_ARCH="x86_64"
        ;;
    aarch64)
        PT_ARCH="arm64"
        ;;
    *)
        echo "ERROR: 暂不支持的架构: $(uname -m)（当前支持 x86_64 / arm64）" >&2
        exit 1
        ;;
esac

# 探测群晖官方 Node.js 套件 优先 v22 回退 v20 v18 v16
NODE_BIN=""
for v in v22 v20 v18 v16; do
    if [ -x "/var/packages/Node.js_${v}/target/usr/local/bin/node" ]; then
        NODE_BIN="/var/packages/Node.js_${v}/target/usr/local/bin/node"
        break
    fi
done
# 官方套件缺失时尝试 PATH 里的 node
if [ -z "$NODE_BIN" ]; then
    NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    echo "ERROR: 未找到 Node.js 运行时，请在套件中心安装官方 Node.js_v22" >&2
    exit 1
fi

ADB_BIN="$ARCH_DIR/$PT_ARCH/adb"
if [ ! -f "$ADB_BIN" ]; then
    echo "ERROR: 未找到 $PT_ARCH 架构的 adb: $ADB_BIN" >&2
    exit 1
fi
chmod +x "$ADB_BIN" 2>/dev/null || true

mkdir -p "$DATA_DIR" 2>/dev/null || {
    echo "ERROR: 无法创建数据目录: $DATA_DIR" >&2
    exit 1
}

# Nginx 反代不剥离前缀 服务需以 BASE_PATH 挂载同名路由
# 只监听回环地址 鉴权由 DSM 网关完成 不向局域网暴露服务端口
# 端口与 Go 版 scrcpynas 套件错开 两版可同时安装
export HOST=127.0.0.1
export PORT=8131
export WS_SCRCPY_PORT=8132
export WS_SCRCPY_BIND_HOST=127.0.0.1
export BASE_PATH=/webman/zgcwkj/scrcpynasfree
export PLATFORM=synology
export ADB_BIN
export NODE_BIN
export LOG_FILE=$APP_LOG_FILE
export RECORDS_FILE=$DATA_DIR/devices.json
export WS_SCRCPY_DIR=$ENGINE_DIR
export NODE_PATH=$ENGINE_DIR/node_modules
export HOME=$DATA_DIR
export TMPDIR=$DATA_DIR
export PATH=$ARCH_DIR/$PT_ARCH:$PATH

cd "$APP_DIR" || exit 1

# Node 负责写入应用日志 systemd 负责接管进程生命周期
"$NODE_BIN" "$APP_DIR/server/server.js" >> "$APP_LOG_FILE" 2>&1 &
APP_PID=$!

# 将停止信号转发给 Node 主进程
forward_signal() {
    kill -TERM "$APP_PID" 2>/dev/null || true
}
trap forward_signal TERM INT

# 等待子进程实际退出 保持退出码一致
APP_STATUS=0
wait_for_app() {
    while kill -0 "$APP_PID" 2>/dev/null; do
        wait "$APP_PID"
        APP_STATUS=$?
    done
}
wait_for_app
exit "$APP_STATUS"
