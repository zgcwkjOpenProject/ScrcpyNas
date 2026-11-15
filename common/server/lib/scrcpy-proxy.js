'use strict';

const crypto = require('crypto');
const http = require('http');
const net = require('net');

const SCRCPY_STREAM_CSS = `

html,
body.stream {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #05070b;
}

body.stream {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* 隐藏引擎的更多设置面板，工具栏只保留自家按钮 */
body.stream .more-box {
    display: none !important;
}

/* 画面在上、工具栏在下，工具栏占独立一行不压画面 */
body.stream .device-view {
    display: flex !important;
    flex-direction: column;
    align-items: center;
    width: 100vw;
    height: 100vh;
    float: none !important;
}

body.stream .control-buttons-list {
    order: 2;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    float: none !important;
    width: 100% !important;
    height: auto !important;
    padding: 4px 8px;
    background: #0b0f16 !important;
    box-sizing: border-box;
}

body.stream .control-buttons-list .control-button {
    margin: 0 14px;
    width: 2.4rem;
    height: 2.4rem;
    background: transparent !important;
    opacity: .85;
}

body.stream .control-buttons-list .control-button:hover {
    opacity: 1;
}

/* 勾选类开关依赖更多面板，面板隐藏后一并隐藏 */
body.stream .control-buttons-list .control-wrapper,
body.stream .control-buttons-list > .control-button[title="More"],
body.stream .control-buttons-list > .control-button[title="Capture keyboard"] {
    display: none !important;
}

/* 默认只留返回/桌面/多任务，其余按键由三个点弹出 */
body.stream .control-buttons-list > .control-button[title="Power"],
body.stream .control-buttons-list > .control-button[title="Volume up"],
body.stream .control-buttons-list > .control-button[title="Volume down"],
body.stream .control-buttons-list > .control-button[title="Take screenshot"] {
    display: none !important;
}

body.stream .control-buttons-list > .vk-more-toggle {
    opacity: .85;
}

/* 三点点击后在他上方弹出的小菜单，不改变工具栏本身 */
body.stream .vk-more-menu {
    position: fixed;
    display: none;
    flex-direction: column;
    align-items: center;
    padding: 4px;
    border-radius: 12px;
    background: rgba(12, 16, 24, .94);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .5);
    z-index: 20;
}

body.stream .vk-more-menu.vk-open {
    display: flex;
}

body.stream .vk-more-menu .control-button {
    margin: 5px 0;
}

/* 视频容器会被引擎设置为设备原始分辨率（内联 px），这里改为占满工具栏以上区域 */
body.stream .video {
    order: 1;
    flex: 1 1 auto;
    float: none !important;
    width: 100% !important;
    height: auto !important;
    min-height: 0;
    max-width: 100% !important;
    max-height: 100% !important;
    position: relative;
    background: #000 !important;
}

body.stream .video .video-layer,
body.stream .video .touch-layer {
    position: absolute !important;
    left: 50% !important;
    top: 50% !important;
    transform: translate(-50%, -50%);
    max-width: 100% !important;
    max-height: 100% !important;
    object-fit: contain;
}
`;

const SCRCPY_OFFICIAL_CONTROL_JS = `
// 应用连接时选择的分辨率：写入 ws-scrcpy 本地存储，MSE 播放器创建时会读取
// 原画不带 maxSize 参数，须写入超大 bounds 抵消引擎 720p 默认回退，否则等同 720p
(function () {
  'use strict';
  try {
    var hash = window.location.hash || '';
    var params = new URLSearchParams(hash.replace(/^#!/, ''));
    var serial = params.get('udid');
    var maxSize = parseInt(params.get('scrcpyNasMaxSize'), 10);
    if (!serial || !window.localStorage) return;
    var key = 'MseDecoder:' + serial + ':' + window.innerWidth + 'x' + window.innerHeight;
    var settings;
    if (!isNaN(maxSize) && maxSize > 0) {
      settings = { bounds: { width: maxSize, height: maxSize } };
    } else {
      settings = { bounds: { width: 4096, height: 4096 }, bitrate: 20971520 };
    }
    window.localStorage.setItem(key, JSON.stringify(settings));
  } catch (e) {
    /* ignore */
  }
})();

// 只补充 ws-scrcpy 原生页面没有覆盖好的鼠标操作：右键返回，中键回桌面
(function () {
  'use strict';

  var LONG_PRESS_MS = 650;
  var rightPress = null;

  function getSerial() {
    var hash = window.location.hash || '';
    var query = hash.replace(/^#!/, '');
    var params = new URLSearchParams(query);
    return params.get('udid') || '';
  }

  function sendKey(key, longpress) {
    var serial = getSerial();
    if (!serial) return;
    fetch('../api/device/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: serial, type: 'key', key: key, longpress: !!longpress })
    }).catch(function (e) {
      console.warn('[scrcpyNas] input failed:', e && e.message ? e.message : e);
    });
  }

  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onPointerDown(e) {
    if (e.button === 2) {
      stop(e);
      rightPress = { longSent: false };
      rightPress.timer = setTimeout(function () {
        if (!rightPress) return;
        rightPress.longSent = true;
        sendKey('BACK', true);
      }, LONG_PRESS_MS);
      return;
    }

    if (e.button === 1) {
      stop(e);
      sendKey('HOME');
    }
  }

  function onPointerUp(e) {
    if (e.button === 2) {
      stop(e);
      if (!rightPress) return;
      clearTimeout(rightPress.timer);
      if (!rightPress.longSent) sendKey('BACK');
      rightPress = null;
      return;
    }

    if (e.button === 1) {
      stop(e);
    }
  }

  var downEvent = window.PointerEvent ? 'pointerdown' : 'mousedown';
  var upEvent = window.PointerEvent ? 'pointerup' : 'mouseup';
  document.addEventListener(downEvent, onPointerDown, true);
  document.addEventListener(upEvent, onPointerUp, true);
  document.addEventListener('auxclick', function (e) {
    if (e.button === 1 || e.button === 2) stop(e);
  }, true);
  document.addEventListener('contextmenu', stop, true);
})();

// 自适应画面尺寸：按视频固有分辨率等比缩放到窗口内并居中
(function () {
  'use strict';

  var lastW = 0;
  var lastH = 0;

  // 按视频容器实际大小缩放，工具栏占掉的高度不计入画面
  function fitToWindow() {
    var video = document.querySelector('body.stream .video-layer');
    if (!video) return;
    var iw = video.videoWidth || video.width;
    var ih = video.videoHeight || video.height;
    if (!iw || !ih) return;
    var host = video.parentElement || document.body;
    var cw = host.clientWidth || window.innerWidth;
    var ch = host.clientHeight || window.innerHeight;
    var scale = Math.min(cw / iw, ch / ih);
    var w = Math.round(iw * scale);
    var h = Math.round(ih * scale);
    // 工具栏宽度跟画面实际宽度对齐，两侧留白不铺满
    var bar = document.querySelector('body.stream .control-buttons-list');
    if (bar && bar.style.getPropertyValue('width') !== w + 'px') {
      bar.style.setProperty('width', w + 'px', 'important');
    }
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    video.style.width = w + 'px';
    video.style.height = h + 'px';
    var touch = document.querySelector('body.stream .touch-layer');
    if (touch) {
      touch.style.width = w + 'px';
      touch.style.height = h + 'px';
    }
  }

  window.addEventListener('resize', fitToWindow);
  window.addEventListener('orientationchange', function () {
    setTimeout(fitToWindow, 300);
  });

  // 后台标签页 requestAnimationFrame 不跑，用定时器保证一直有校正
  fitToWindow();
  setInterval(fitToWindow, 300);
})();

// 工具栏只留三个导航键，末尾补一个竖三点按钮，点击在它上方弹出其余按键
(function () {
  'use strict';

  var EXTRA_TITLES = ['Power', 'Volume up', 'Volume down', 'Take screenshot'];
  var list = null;
  var toggle = null;
  var menu = null;
  var swapped = false;

  function buildToggle() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'control-button vk-more-toggle';
    btn.title = '更多按键';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
    return btn;
  }

  function closeMenu() {
    if (menu) menu.classList.remove('vk-open');
  }

  // 菜单对齐三点按钮右侧并夹在视口内
  function placeMenu() {
    var r = toggle.getBoundingClientRect();
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
    var top = Math.max(8, r.top - mh - 6);
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function onToggle(e) {
    e.preventDefault();
    e.stopPropagation();
    if (menu.classList.contains('vk-open')) {
      closeMenu();
      return;
    }
    menu.classList.add('vk-open');
    placeMenu();
  }

  // 导航键改成最近任务、桌面、返回三键顺序
  function orderNavButtons() {
    if (swapped) return;
    var byTitle = function (title) {
      return list.querySelector(':scope > .control-button[title="' + title + '"]');
    };
    var overview = byTitle('Overview');
    var home = byTitle('Home');
    var back = byTitle('Back');
    if (!overview || !home || !back) return;
    // 以浮层菜单为锚点依次插入，得到最近任务、桌面、返回
    list.insertBefore(overview, menu);
    list.insertBefore(home, menu);
    list.insertBefore(back, menu);
    swapped = true;
  }

  function ensure() {
    var el = document.querySelector('body.stream .control-buttons-list');
    if (!el) {
      list = null;
      toggle = null;
      menu = null;
      swapped = false;
      return;
    }
    if (el === list && toggle && el.contains(toggle)) return;

    list = el;
    swapped = false;
    toggle = buildToggle();
    toggle.addEventListener('click', onToggle);
    menu = document.createElement('div');
    menu.className = 'vk-more-menu';
    // 选中任一按键后收起菜单
    menu.addEventListener('click', function (e) {
      var hit = e.target && e.target.closest ? e.target.closest('.control-button') : null;
      if (hit) closeMenu();
    });

    // 按键搬进浮层，元素移动不会丢原生点击逻辑
    Array.prototype.slice.call(el.querySelectorAll('.control-button')).forEach(function (btn) {
      if (EXTRA_TITLES.indexOf(btn.title) >= 0) menu.appendChild(btn);
    });

    el.appendChild(menu);
    el.appendChild(toggle);
    orderNavButtons();
  }

  document.addEventListener('click', function (e) {
    if (!menu || !menu.classList.contains('vk-open')) return;
    if (menu.contains(e.target) || (toggle && toggle.contains(e.target))) return;
    closeMenu();
  }, true);

  window.addEventListener('resize', closeMenu);

  // 后台标签页 requestAnimationFrame 不跑 定时器加 DOM 变化监听保证工具栏能补上
  ensure();
  setInterval(ensure, 400);
  try {
    new MutationObserver(function () {
      ensure();
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    /* ignore */
  }
})();
`;

function shouldInjectScrcpyStreamCss(method, proxyPath) {
  return method === 'GET' && proxyPath.split('?')[0] === '/main.css';
}

function shouldInjectScrcpyControls(method, proxyPath) {
  const p = proxyPath.split('?')[0];
  return method === 'GET' && (p === '/' || p === '/index.html');
}

// 注入过的响应一律不缓存 否则引擎文件没变时会一直用旧的注入内容
function markInjectedResponseNoStore(headers) {
  delete headers['content-length'];
  delete headers['etag'];
  delete headers['last-modified'];
  delete headers['expires'];
  headers['cache-control'] = 'no-store, no-cache, must-revalidate';
  headers['pragma'] = 'no-cache';
  return headers;
}

// 注入路径不转发条件请求 免得上游回 304 让浏览器继续用旧内容
function stripConditionalHeaders(headers) {
  delete headers['if-none-match'];
  delete headers['if-modified-since'];
  return headers;
}

// 注入内容一变版本号也变 引用地址跟着换 浏览器自然拉新文件
const SCRCPY_ASSET_VERSION = crypto
  .createHash('sha1')
  .update(SCRCPY_STREAM_CSS)
  .update(SCRCPY_OFFICIAL_CONTROL_JS)
  .digest('hex')
  .slice(0, 10);

function versionedAsset(url) {
  return `${url}?v=${SCRCPY_ASSET_VERSION}`;
}

// 在首页引用处追加版本号 避免浏览器用旧的 bundle.js 和 main.css
function injectScrcpyControls(body) {
  const script = `<script src="../scrcpy-official-controls.js?v=${SCRCPY_ASSET_VERSION}"></script>`;
  const bundle = `<script defer="defer" src="${versionedAsset('bundle.js')}"></script>`;
  let html = body.replace('<script defer="defer" src="bundle.js"></script>', `${script}${bundle}`);
  html = html.replace(/href="\.?\/?main\.css"/, `href="${versionedAsset('main.css')}"`);
  if (!html.includes('scrcpy-official-controls.js')) html = html.replace('</head>', `${script}</head>`);
  return html;
}

function writeTextProxyResponse(proxyRes, res, transform) {
  const chunks = [];
  proxyRes.on('error', (e) => {
    console.error(`[scrcpy-proxy] response read error: ${e.message}`);
    if (!res.headersSent) res.status(502).send('scrcpy engine proxy error');
    else res.end();
  });
  proxyRes.on('data', (chunk) => chunks.push(chunk));
  proxyRes.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const nextBody = transform(body);
    const headers = markInjectedResponseNoStore({ ...proxyRes.headers });
    headers['content-type'] = headers['content-type'] || 'text/html; charset=utf-8';
    res.writeHead(proxyRes.statusCode || 200, headers);
    res.end(nextBody);
  });
}

function isExpectedSocketError(error) {
  return error && ['EPIPE', 'ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code);
}

function logProxySocketError(scope, error) {
  // Closing a tab or stopping a stream often closes one side of the proxy first
  if (isExpectedSocketError(error)) {
    console.warn(`[scrcpy-proxy] ${scope}: ${error.code}`);
    return;
  }
  console.error(`[scrcpy-proxy] ${scope}: ${error && error.message ? error.message : error}`);
}

function destroyQuietly(stream) {
  try {
    if (stream && !stream.destroyed) stream.destroy();
  } catch (_) {
    /* ignore */
  }
}

function createScrcpyHttpProxy({ buildProxyPath, wsScrcpyHost, wsScrcpyPort }) {
  return function proxyScrcpyHttp(req, res) {
    const proxyPath = buildProxyPath(req.originalUrl || req.url);
    const injectStreamCss = shouldInjectScrcpyStreamCss(req.method, proxyPath);
    const injectControls = shouldInjectScrcpyControls(req.method, proxyPath);
    const upstreamHeaders = {
      ...req.headers,
      host: `${wsScrcpyHost}:${wsScrcpyPort}`,
      'accept-encoding': 'identity',
    };
    if (injectStreamCss || injectControls) stripConditionalHeaders(upstreamHeaders);
    const proxyReq = http.request(
      {
        host: wsScrcpyHost,
        port: wsScrcpyPort,
        method: req.method,
        path: proxyPath,
        headers: upstreamHeaders,
      },
      (proxyRes) => {
        if (injectControls && proxyRes.statusCode === 200) {
          writeTextProxyResponse(proxyRes, res, injectScrcpyControls);
          return;
        }

        if (!injectStreamCss || proxyRes.statusCode !== 200) {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.on('error', (e) => logProxySocketError('http upstream response error', e));
          res.on('error', (e) => {
            logProxySocketError('http client response error', e);
            destroyQuietly(proxyRes);
          });
          proxyRes.pipe(res);
          return;
        }

        const headers = markInjectedResponseNoStore({ ...proxyRes.headers });
        headers['content-type'] = headers['content-type'] || 'text/css; charset=utf-8';
        // 带当前版本号说明地址唯一 可以长期缓存 版本变了地址也会变
        if (new URL(req.originalUrl || req.url, 'http://localhost').searchParams.get('v') === SCRCPY_ASSET_VERSION) {
          headers['cache-control'] = 'public, max-age=31536000, immutable';
          delete headers['pragma'];
        }
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.on('data', (chunk) => {
          if (!res.destroyed) res.write(chunk);
        });
        proxyRes.on('end', () => {
          if (!res.destroyed) res.end(SCRCPY_STREAM_CSS);
        });
        proxyRes.on('error', (e) => {
          logProxySocketError('http css response error', e);
          if (!res.destroyed) res.end();
        });
      }
    );

    proxyReq.on('error', (e) => {
      console.error(`[scrcpy-proxy] http error: ${e.message}`);
      if (!res.headersSent) {
        res.status(502).send('scrcpy engine proxy error');
      } else {
        res.end();
      }
    });

    req.on('aborted', () => destroyQuietly(proxyReq));
    req.on('error', (e) => {
      logProxySocketError('http client request error', e);
      destroyQuietly(proxyReq);
    });
    res.on('error', (e) => {
      logProxySocketError('http client response error', e);
      destroyQuietly(proxyReq);
    });
    req.pipe(proxyReq);
  };
}

function createScrcpyUpgradeProxy({ buildProxyPath, wsScrcpyHost, wsScrcpyPort }) {
  return function proxyScrcpyUpgrade(req, socket, head) {
    let connected = false;
    let closed = false;
    const closeBoth = () => {
      if (closed) return;
      closed = true;
      destroyQuietly(upstream);
      destroyQuietly(socket);
    };

    const upstream = net.connect(wsScrcpyPort, wsScrcpyHost, () => {
      connected = true;
      const proxyPath = buildProxyPath(req.url);
      // Recreate the HTTP upgrade request to proxy raw WebSocket sockets
      const headers = Object.entries({
        ...req.headers,
        host: `${wsScrcpyHost}:${wsScrcpyPort}`,
      })
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n');
      upstream.write(`${req.method} ${proxyPath} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });

    upstream.on('error', (e) => {
      logProxySocketError('websocket upstream error', e);
      if (!connected && socket.writable && !socket.destroyed) {
        try {
          socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        } catch (_) {
          /* ignore */
        }
      }
      closeBoth();
    });
    socket.on('error', (e) => {
      logProxySocketError('websocket client error', e);
      closeBoth();
    });
    upstream.on('close', closeBoth);
    socket.on('close', closeBoth);
  };
}

function registerScrcpyProxyRoutes(app, options) {
  const proxyScrcpyHttp = createScrcpyHttpProxy(options);

  for (const base of options.routeBases) {
    app.get(new RegExp(`^${options.escapeRegExp(base)}/scrcpy$`), (_req, res) => {
      res.redirect(`${base}/scrcpy/`);
    });
  }

  // 控制脚本按内容哈希出 ETag 内容一变地址里的版本号也会跟着变
  const controlsEtag = `"${crypto.createHash('sha1').update(SCRCPY_OFFICIAL_CONTROL_JS).digest('hex').slice(0, 20)}"`;
  app.get(options.appPath('/scrcpy-official-controls.js'), (req, res) => {
    const version = new URL(req.originalUrl || req.url, 'http://localhost').searchParams.get('v');
    res.set({
      'Cache-Control': version === SCRCPY_ASSET_VERSION ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
      ETag: controlsEtag,
    });
    res.type('application/javascript').send(SCRCPY_OFFICIAL_CONTROL_JS);
  });
  app.use(options.appPath('/scrcpy/'), proxyScrcpyHttp);
}

function createScrcpyUpgradeHandler(options) {
  const proxyScrcpyUpgrade = createScrcpyUpgradeProxy(options);
  return function handleScrcpyUpgrade(req, socket, head) {
    const url = req.url || '';
    if (!options.isScrcpyPath(url)) {
      socket.destroy();
      return;
    }

    if (options.platform !== 'synology') {
      proxyScrcpyUpgrade(req, socket, head);
      return;
    }

    options.runDsmAuth(req).then((auth) => {
      if (auth.ok) return proxyScrcpyUpgrade(req, socket, head);
      try {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      } catch (_) {
        socket.destroy();
      }
    });
  };
}

module.exports = { registerScrcpyProxyRoutes, createScrcpyUpgradeHandler };
