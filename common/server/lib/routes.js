'use strict';

const { URL } = require('url');

function normalizeBasePath(basePath) {
  return String(basePath || '').replace(/\/+$/, '');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createRoutePaths(basePath) {
  const normalizedBasePath = normalizeBasePath(basePath);
  const routeBases = [...new Set([normalizedBasePath || ''])];
  const routeBasesByLength = [...routeBases].sort((a, b) => b.length - a.length);

  // Express accepts an array of paths. This keeps fnOS (/app/scrcpyNas) and
  // DSM (/webman/3rdparty/scrcpynas) on the same route definitions
  const appPath = (pathName) => routeBases.map((base) => `${base}${pathName}`);

  const buildProxyPath = (reqUrl) => {
    const url = new URL(reqUrl || '/', 'http://127.0.0.1');
    let pathName = url.pathname;

    // The bundled ws-scrcpy engine expects root-relative paths; strip only the
    // public /scrcpy prefix and leave query parameters untouched
    for (const base of routeBasesByLength) {
      const prefix = `${base}/scrcpy`;
      if (pathName === prefix) {
        pathName = '/';
        break;
      }
      if (pathName.startsWith(`${prefix}/`)) {
        pathName = pathName.slice(prefix.length) || '/';
        break;
      }
    }

    return `${pathName || '/'}${url.search}`;
  };

  const isScrcpyPath = (urlValue) => {
    const raw = String(urlValue || '');
    return routeBases.some((base) => raw.startsWith(`${base}/scrcpy/`));
  };

  return {
    basePath: normalizedBasePath,
    routeBases,
    appPath,
    buildProxyPath,
    escapeRegExp,
    isScrcpyPath,
  };
}

module.exports = { createRoutePaths, escapeRegExp, normalizeBasePath };
