'use strict';

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

body.stream .control-buttons-list,
body.stream .more-box {
    display: none !important;
}

/* 视频容器会被引擎设置为设备原始分辨率（内联 px），这里覆盖为
   铺满窗口的透明层；视频/触摸层按比例自适应宽高并绝对居中 */
body.stream .video {
    float: none !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    background: transparent !important;
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
(function () {
  'use strict';
  try {
    var hash = window.location.hash || '';
    var params = new URLSearchParams(hash.replace(/^#!/, ''));
    var serial = params.get('udid');
    var maxSize = parseInt(params.get('scrcpyNasMaxSize'), 10);
    if (!serial || !window.localStorage) return;
    var key = 'MseDecoder:' + serial + ':' + window.innerWidth + 'x' + window.innerHeight;
    if (!isNaN(maxSize) && maxSize > 0) {
      window.localStorage.setItem(key, JSON.stringify({ bounds: { width: maxSize, height: maxSize } }));
    } else {
      window.localStorage.removeItem(key);
    }
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

  function fitToWindow() {
    var video = document.querySelector('body.stream .video-layer');
    if (!video) return;
    var iw = video.videoWidth || video.width;
    var ih = video.videoHeight || video.height;
    if (!iw || !ih) return;
    var scale = Math.min(window.innerWidth / iw, window.innerHeight / ih);
    var w = Math.round(iw * scale);
    var h = Math.round(ih * scale);
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

  (function loop() {
    fitToWindow();
    requestAnimationFrame(loop);
  })();
})();
`;

function shouldInjectScrcpyStreamCss(method, proxyPath) {
  return method === 'GET' && proxyPath.split('?')[0] === '/main.css';
}

function shouldInjectScrcpyControls(method, proxyPath) {
  const p = proxyPath.split('?')[0];
  return method === 'GET' && (p === '/' || p === '/index.html');
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
    const headers = { ...proxyRes.headers };
    delete headers['content-length'];
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
    const proxyReq = http.request(
      {
        host: wsScrcpyHost,
        port: wsScrcpyPort,
        method: req.method,
        path: proxyPath,
        headers: {
          ...req.headers,
          host: `${wsScrcpyHost}:${wsScrcpyPort}`,
          'accept-encoding': 'identity',
        },
      },
      (proxyRes) => {
        if (injectControls && proxyRes.statusCode === 200) {
          writeTextProxyResponse(proxyRes, res, (body) => {
            const script = '<script src="../scrcpy-official-controls.js"></script>';
            if (body.includes('<script defer="defer" src="bundle.js"></script>')) {
              return body.replace('<script defer="defer" src="bundle.js"></script>', `${script}<script defer="defer" src="bundle.js"></script>`);
            }
            return body.includes('</head>') ? body.replace('</head>', `${script}</head>`) : `${script}${body}`;
          });
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

        const headers = { ...proxyRes.headers };
        delete headers['content-length'];
        headers['content-type'] = headers['content-type'] || 'text/css; charset=utf-8';
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

  app.get(options.appPath('/scrcpy-official-controls.js'), (_req, res) => {
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
