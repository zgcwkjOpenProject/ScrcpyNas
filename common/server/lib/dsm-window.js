'use strict';

const fs = require('fs');
const path = require('path');

// DSM loads the package desktop entry script from the same Webman path as the
// app. Because our Webman path is proxied to Node, Node must return JavaScript
// for /Main.js instead of the normal app HTML, otherwise DSM refuses to execute
// it with a strict MIME type error
const FALLBACK_DSM_APP_WINDOW_JS = `
Ext.define('SYNO.SDS.ScrcpyNas.Instance', {
  extend: 'SYNO.SDS.AppInstance',
  appWindowName: 'SYNO.SDS.ScrcpyNas.Main',

  constructor: function () {
    this.callParent(arguments);
  }
});

Ext.define('SYNO.SDS.ScrcpyNas.Main', {
  extend: 'SYNO.SDS.AppWindow',
  appInstance: null,

  constructor: function (cfg) {
    this.appInstance = cfg.appInstance;

    var config = Ext.apply({
      title: 'ScrcpyNas',
      resizable: true,
      maximizable: true,
      minimizable: true,
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      layout: 'fit',
      items: [
        new Ext.BoxComponent({
          height: '100%',
          html: '<iframe title="ScrcpyNas" src="/webman/3rdparty/scrcpynas/" frameborder="0" width="100%" height="100%" style="display:block"></iframe>'
        })
      ]
    }, cfg);

    this.callParent([config]);
  }
});
`;

function readDsmAppWindowScript(serverDir) {
  // Package layout: target/app/server/server.js and target/ui/Main.js
  const candidate = path.join(serverDir, '..', '..', 'ui', 'Main.js');
  try {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
  } catch (e) {
    console.error(`[dsm-ui] read Main.js failed: ${e.message}`);
  }
  return FALLBACK_DSM_APP_WINDOW_JS;
}

function registerDsmWindowScriptRoute(app, appPath, serverDir) {
  app.get(appPath('/Main.js'), (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(readDsmAppWindowScript(serverDir));
  });
}

module.exports = { registerDsmWindowScriptRoute, readDsmAppWindowScript };
