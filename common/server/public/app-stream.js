'use strict';

// 投屏模块 管理 iframe 的加载卸载 构造 ws-scrcpy 的 stream/proxy URL
// 用序号作废并发切换 切换设备前清理设备侧残留的 scrcpy-server 进程
// 生命周期全收拢在此 避免切换 释放 新标签打开互相踩状态

// 构造 ws-scrcpy 的 adb 代理地址 action=proxy-adb 是 ws-scrcpy 的 adb 代理端点
// remote 指向 scrcpy server 监听的本机端口 udid 标识目标设备
function buildWsProxyUrl(serial) {
  const url = new URL(SCRCPY_BASE, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('action', 'proxy-adb');
  url.searchParams.set('remote', `tcp:${SCRCPY_SERVER_PORT}`);
  url.searchParams.set('udid', serial);
  return url.toString();
}

// 构造投屏页面地址 ws-scrcpy 前端是 hash 路由 SPA 参数挂在 #! 后
// scrcpyNasTs 既防缓存又承载加载序号 captureKeyboard 默认开让键盘事件透传到设备
function buildStreamUrl(serial, token = Date.now(), maxSize = '') {
  const params = new URLSearchParams({
    action: 'stream',
    udid: serial,
    player: DEFAULT_PLAYER,
    ws: buildWsProxyUrl(serial),
    captureKeyboard: 'true',
    scrcpyNasTs: String(token),
  });
  if (maxSize) params.set('scrcpyNasMaxSize', String(maxSize));
  return `${SCRCPY_BASE}#!${params.toString()}`;
}

// 读取当前选中的分辨率限制
function getSelectedMaxSize() {
  const btn = document.querySelector('#maxSizeSeg .seg-btn.active');
  return btn ? btn.dataset.maxsize || '' : '';
}

// 优先用记录里保存的分辨率 没有才回退到当前分段按钮的选中值
function getMaxSizeFor(serial) {
  const record = records.find((r) => r.serial === serial || r.id === serial);
  if (record && record.maxSize) return record.maxSize;
  return getSelectedMaxSize();
}

// 判断当前 iframe 是否已加载指定设备
function isMirrorLoadedFor(serial) {
  const src = $('#mirrorFrame').src || '';
  return src.includes(`udid=${encodeURIComponent(serial)}`) || src.includes(`udid=${serial}`);
}

// 切换或断开前调一次 ws-scrcpy 会在设备侧持有 adb 连接和 scrcpy-server 进程
// 不清理会累积僵尸进程 下次连接可能冲突
async function cleanupStream(serial) {
  if (!serial) return { ok: true };
  return postJson(apiUrl('/api/stream/prepare'), { serial });
}

// 开始加载前先做准备工作
async function prepareStream(serial) {
  return cleanupStream(serial);
}

// 先指向 about:blank 再等 IFRAME_RELEASE_DELAY_MS 直接换 src 会让旧 ws-scrcpy
// 实例的 WebSocket 来不及关闭 需要先指空白页等浏览器回收连接
async function unloadMirror(showEmpty = false) {
  $('#mirrorFrame').src = 'about:blank';
  mirrorSerial = '';
  if (showEmpty) {
    $('#mirrorEmpty').classList.remove('hidden');
  }
  await sleep(IFRAME_RELEASE_DELAY_MS);
}

// 在当前页打开投屏 用序号 seq 作废并发切换 每次开始新加载递增 openMirrorSeq
// 每个 await 之后比对 seq 不一致说明用户中途又点了别的设备 当前流程直接返回
async function openMirror(serial = selectedSerial) {
  const seq = ++openMirrorSeq;
  if (!serial) return;

  const previousSerial = mirrorSerial;
  if (previousSerial === serial && isMirrorLoadedFor(serial)) {
    return;
  }

  if (previousSerial) {
    await unloadMirror(false);
    await cleanupStream(previousSerial);
    if (seq !== openMirrorSeq) return;
  }

  await prepareStream(serial);
  if (seq !== openMirrorSeq) return;
  $('#mirrorEmpty').classList.add('hidden');
  $('#mirrorFrame').src = buildStreamUrl(serial, seq, getMaxSizeFor(serial));
  mirrorSerial = serial;
}

// 在新标签打开当前选中设备 若本页 iframe 正在播同一设备 要先卸载本页并清理资源
// 否则两个 scrcpy 实例会同时连同一设备
async function openSelectedInNewTab() {
  if (!selectedSerial) return;

  const tab = window.open('about:blank', '_blank');
  if (mirrorSerial === selectedSerial) {
    ++openMirrorSeq;
    await unloadMirror(true);
    await cleanupStream(selectedSerial);
  }

  const streamUrl = buildStreamUrl(selectedSerial, Date.now(), getMaxSizeFor(selectedSerial));
  if (tab) {
    tab.location.href = streamUrl;
  } else {
    window.open(streamUrl, '_blank', 'noopener');
  }
}

// 断开当前选中设备 USB 设备只清理不 disconnect USB 直连不走 adb connect/disconnect
async function disconnectSelectedDevice() {
  if (!selectedSerial) return;

  ++openMirrorSeq;
  const loadedSerial = mirrorSerial;
  if (loadedSerial) {
    await unloadMirror(true);
    await cleanupStream(loadedSerial);
  }

  if (!selectedIsUsb) {
    await postJson(apiUrl('/api/disconnect'), { serial: selectedSerial });
  }
  selectedSerial = '';
  selectedIsUsb = false;
  await loadDevices();
}
