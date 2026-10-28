'use strict';

// 共享状态和基础工具 这里不放具体业务流程 避免公共能力反向依赖页面细节
// 接口地址锚定到当前页面目录 避免反向代理带二级路径时相对路径拼错
var PAGE_BASE = window.location.pathname.replace(/[^/]*$/, '');
// 群晖 DSM 反向代理要求的 CSRF token 所有接口请求需附带 非群晖环境为空
var PAGE_SYNO_TOKEN = new URLSearchParams(window.location.search).get('SynoToken') || '';
var SCRCPY_BASE = apiUrl('scrcpy/');
// ws-scrcpy 内部服务端口 构造投屏代理地址时使用
var SCRCPY_SERVER_PORT = 8886;
// 默认播放器用 MSE 浏览器原生解码 兼容性最好
var DEFAULT_PLAYER = 'mse';
// 卸载 iframe 后等待浏览器回收 ws-scrcpy 内部 WebSocket 的时间 太短会残留连接
var IFRAME_RELEASE_DELAY_MS = 350;

// 全局状态中心 被 devices/ui/stream 三个模块共享读写
var records = [];           // 已保存的连接记录 持久化在服务端
var currentDevices = [];    // adb 当前可见的在线设备 实时拉取不落库
var selectedRecordId = '';  // 左侧列表选中的记录 id
var selectedSerial = '';    // 当前选中的设备 serial USB 直连时不在 records 里
var selectedIsUsb = false;  // 是否 USB 设备 USB 不走 adb connect/disconnect 断开逻辑不同
var mirrorSerial = '';      // 右侧 iframe 当前正在播放的设备 与 selectedSerial 不同步 选中后可能还没加载完
var openMirrorSeq = 0;      // 投屏加载序号 每次开始新加载递增 await 后比对 seq 不一致说明用户已发起新切换 当前流程作废

// 拼出当前页面下的接口地址
function apiUrl(path) {
  const url = new URL(PAGE_BASE + String(path).replace(/^\/+/, ''), window.location.href);
  if (PAGE_SYNO_TOKEN) url.searchParams.set('SynoToken', PAGE_SYNO_TOKEN);
  return `${url.pathname}${url.search}${url.hash}`;
}

// 读取单个 DOM 节点
function $(sel) {
  return document.querySelector(sel);
}

// 读取 JSON 接口并统一处理解析失败
async function api(path, options) {
  const res = await fetch(path, { ...(options || {}), credentials: 'same-origin' });
  return res.json().catch(() => ({ ok: false, error: '响应解析失败' }));
}

// 发送 JSON 请求
function postJson(path, payload) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// 延迟指定毫秒
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 转义文本，避免直接塞进 innerHTML
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// 更新引擎状态文案
function setEngineStatus(ready) {
  $('#engineStatusText').textContent = ready ? '投屏服务就绪' : '投屏服务启动中';
}

// 定时轮询引擎是否就绪
async function pollEngine() {
  try {
    const data = await api(apiUrl('/api/engine'));
    setEngineStatus(!!data.ready);
  } catch (_) {
    setEngineStatus(false);
  }
  setTimeout(pollEngine, 5000);
}
