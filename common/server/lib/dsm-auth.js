'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const { URL } = require('url');
const { spawn } = require('child_process');

// DSM 6/7 的 authenticate.cgi 路径有差异，启动时选第一个存在的路径
const DSM_AUTH_CGI_CANDIDATES = [
  '/usr/syno/synoman/webman/modules/authenticate.cgi',
  '/usr/syno/synoman/webman/authenticate.cgi',
];
const DSM_AUTH_CACHE_TTL = 30000;
const DSM_TOKEN_CACHE_TTL = 120000;

function getQueryValue(urlValue, key) {
  const raw = String(urlValue || '');
  if (!raw) return '';
  try {
    return new URL(raw, 'http://127.0.0.1').searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function getSynoToken(req) {
  // DSM AppWindow, page fetches, and websocket URLs do not always place
  // SynoToken in the same spot; accept header, current URL, and referer
  return (
    String(req.headers['x-syno-token'] || '').trim() ||
    getQueryValue(req.originalUrl || req.url || '', 'SynoToken') ||
    getQueryValue(req.headers.referer || req.headers.referrer || '', 'SynoToken')
  );
}

function getClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (fwd && fwd !== 'unknown') return fwd;
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real && real !== 'unknown') return real;
  return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}

function getServerAddr(req) {
  const dsmAddr = String(req.headers['x-dsm-server-addr'] || '').trim();
  if (dsmAddr) return dsmAddr.replace(/^::ffff:/, '');
  const local = String((req.socket && req.socket.localAddress) || '').replace(/^::ffff:/, '');
  if (local && local !== '::' && local !== '0.0.0.0' && local !== '127.0.0.1') return local;
  try {
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos || []) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return '127.0.0.1';
}

function getDsmRequestPort(req) {
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  return (
    String(req.headers['x-forwarded-port'] || '').trim() ||
    (hostHeader.match(/:(\d+)$/) || [])[1] ||
    '5000'
  );
}

function extractSynoToken(body) {
  const text = String(body || '');
  const patterns = [
    /SynoToken=([A-Za-z0-9._-]+)/,
    /["']SynoToken["']\s*[:=]\s*["']([^"']+)["']/,
    /synotoken["']?\s*[:=]\s*["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1];
  }
  return '';
}

function requestDsmRootForToken(req, options) {
  return new Promise((resolve) => {
    const client = options.secure ? https : http;
    // When DSM opens a package iframe without SynoToken in the URL, the token
    // can still be recovered from DSM's root page using the same login cookie
    const request = client.request(
      {
        host: '127.0.0.1',
        port: options.port,
        path: '/',
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 3000,
        headers: {
          Host: req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1',
          Cookie: req.headers.cookie || '',
          Accept: 'text/html,*/*',
        },
      },
      (res) => {
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total > 256 * 1024) res.destroy();
        });
        res.on('end', () => resolve(extractSynoToken(Buffer.concat(chunks).toString('utf8'))));
      }
    );
    request.on('error', () => resolve(''));
    request.on('timeout', () => {
      request.destroy();
      resolve('');
    });
    request.end();
  });
}

function createSynologyAuth({ platform }) {
  const dsmAuthCgi = DSM_AUTH_CGI_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_) {
      return false;
    }
  });
  const authCache = new Map();
  const tokenCache = new Map();

  async function fetchDsmSynoToken(req) {
    const cookie = String(req.headers.cookie || '');
    if (!cookie) return '';

    const cached = tokenCache.get(cookie);
    if (cached && Date.now() - cached.at < DSM_TOKEN_CACHE_TTL) return cached.token;

    const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const port = getDsmRequestPort(req);
    // Prefer the original DSM port/protocol, then fall back to local HTTP 5000
    // for DSM6 setups where nginx terminates the browser-facing request
    const attempts = [
      { secure: proto === 'https' || port === '5001' || port === '443', port },
      { secure: false, port: '5000' },
    ];
    const seen = new Set();
    for (const attempt of attempts) {
      const key = `${attempt.secure ? 'https' : 'http'}:${attempt.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const token = await requestDsmRootForToken(req, attempt);
      if (token) {
        tokenCache.set(cookie, { at: Date.now(), token });
        trimCache(tokenCache);
        return token;
      }
    }
    return '';
  }

  function buildDsmCgiEnv(req, synoToken) {
    const original = req.originalUrl || req.url || '/';
    const qIndex = original.indexOf('?');
    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    // authenticate.cgi is a CGI binary; it validates the DSM login by reading
    // cookie, SynoToken, request URI, and client/server addresses from env vars
    const env = {
      GATEWAY_INTERFACE: 'CGI/1.1',
      REQUEST_METHOD: req.method || 'GET',
      REQUEST_URI: original,
      QUERY_STRING: qIndex >= 0 ? original.slice(qIndex + 1) : '',
      SCRIPT_NAME: '/webman/3rdparty/scrcpynas/',
      SERVER_PROTOCOL: 'HTTP/1.1',
      SERVER_NAME: hostHeader.replace(/:\d+$/, ''),
      SERVER_PORT: getDsmRequestPort(req),
      SERVER_ADDR: getServerAddr(req),
      REMOTE_ADDR: getClientIp(req),
      HTTP_HOST: hostHeader,
      HTTP_COOKIE: req.headers.cookie || '',
      HTTP_X_SYNO_TOKEN: synoToken,
      SYNO_TOKEN: synoToken,
      CONTENT_LENGTH: '0',
      CONTENT_TYPE: '',
      HTTPS: proto === 'https' ? 'on' : 'off',
    };

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value !== 'string') continue;
      const name = `HTTP_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      if (!(name in env)) env[name] = value;
    }
    return env;
  }

  async function runDsmAuth(req) {
    const tokenFromRequest = getSynoToken(req);
    const token = tokenFromRequest || (await fetchDsmSynoToken(req));
    return new Promise((resolve) => {
      const cookie = String(req.headers.cookie || '');
      const cacheKey = `${cookie}\n${token}`;
      const cached = authCache.get(cacheKey);
      if (cached && Date.now() - cached.at < DSM_AUTH_CACHE_TTL) return resolve(cached.result);

      if (!dsmAuthCgi) {
        return resolve({ ok: false, reason: '未找到 DSM authenticate.cgi' });
      }
      if (!cookie) {
        return resolve({ ok: false, reason: '请求未携带 DSM Cookie' });
      }

      let child;
      try {
        child = spawn(dsmAuthCgi, {
          env: { ...process.env, ...buildDsmCgiEnv(req, token) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        return resolve({ ok: false, reason: e.message });
      }

      let out = '';
      let err = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch (_) {
          /* ignore */
        }
      }, 5000);

      child.stdout.on('data', (data) => (out += data.toString()));
      child.stderr.on('data', (data) => (err += data.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: e.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const user = parseDsmUser(out);
        const result = user
          ? { ok: true, user, token }
          : { ok: false, reason: err.trim() || `DSM 登录态无效（code=${code}${timedOut ? ', timeout' : ''}）` };
        if (!result.ok) {
          console.error(
            '[dsm-auth] failed ' +
              JSON.stringify({
                code,
                timedOut,
                cookieLen: cookie.length,
                synoToken: token ? 'yes' : 'no',
                out: out.slice(0, 160),
                err: err.slice(0, 160),
                uri: req.originalUrl || req.url || '',
              })
          );
        }
        authCache.set(cacheKey, { at: Date.now(), result });
        trimCache(authCache);
        resolve(result);
      });
    });
  }

  async function authMiddleware(req, res, next) {
    req.auth = { mode: platform || 'none', user: null };

    if (platform !== 'synology') return next();

    const auth = await runDsmAuth(req);
    if (auth.ok) {
      req.auth.user = { username: auth.user, uid: '', isAdmin: false };
      const reqUrl = req.originalUrl || req.url || '';
      if (
        auth.token &&
        !getSynoToken(req) &&
        req.method === 'GET' &&
        /text\/html/i.test(String(req.headers.accept || ''))
      ) {
        // Add SynoToken to HTML navigations so subsequent API and websocket
        // requests inherit it from the page URL/referrer
        const nextUrl = new URL(reqUrl, 'http://127.0.0.1');
        nextUrl.searchParams.set('SynoToken', auth.token);
        return res.redirect(`${nextUrl.pathname}${nextUrl.search}`);
      }
      return next();
    }

    const reqUrl = req.originalUrl || req.url || '';
    const isApi = reqUrl.includes('/api/');
    if (isApi) return res.status(401).json({ ok: false, error: `DSM 登录验证失败：${auth.reason}` });

    if (req.method === 'GET' && /text\/html/i.test(String(req.headers.accept || ''))) {
      return res.redirect('/webman/index.cgi');
    }
    return res.status(401).json({ ok: false, error: `DSM 登录验证失败：${auth.reason}` });
  }

  return { authMiddleware, runDsmAuth, dsmAuthCgi };
}

function parseDsmUser(output) {
  return String(output || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^content-|^status:/i.test(line))
    .pop() || '';
}

function trimCache(cache) {
  if (cache.size <= 100) return;
  for (const key of [...cache.keys()].slice(0, 50)) cache.delete(key);
}

module.exports = { createSynologyAuth, getSynoToken };
