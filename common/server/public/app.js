'use strict';

// 页面入口只负责按顺序加载前端模块，业务逻辑分散在相邻文件中维护
(function loadAppScripts() {
  const scripts = [
    'app-core.js',
    'app-stream.js',
    'app-devices.js',
    'app-ui.js',
  ];
  const currentScript = document.currentScript && document.currentScript.src;
  const baseUrl = currentScript ? new URL('.', currentScript).toString() : './';

  function loadScript(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(name, baseUrl).toString();
      script.onload = resolve;
      script.onerror = () => reject(new Error(`加载 ${name} 失败`));
      document.head.appendChild(script);
    });
  }

  scripts
    .reduce((chain, name) => chain.then(() => loadScript(name)), Promise.resolve())
    .catch((e) => {
      const target = document.getElementById('mirrorEmpty') || document.body;
      target.textContent = e && e.message ? e.message : '页面脚本加载失败';
    });
})();
