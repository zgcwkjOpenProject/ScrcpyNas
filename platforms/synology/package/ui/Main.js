Ext.define('SYNO.SDS.ScrcpyNasFree.Instance', {
  extend: 'SYNO.SDS.AppInstance',
  appWindowName: 'SYNO.SDS.ScrcpyNasFree.Main',

  // 初始化 DSM 桌面应用实例
  constructor: function () {
    this.callParent(arguments);
  }
});

Ext.define('SYNO.SDS.ScrcpyNasFree.Main', {
  extend: 'SYNO.SDS.AppWindow',
  appInstance: null,

  // 创建承载 ScrcpyNas投屏 Webman 页面的 DSM 窗口
  constructor: function (cfg) {
    this.appInstance = cfg.appInstance;

    // iframe 使用 Webman 路径，保持 DSM 桌面入口和反代链路一致
    var config = Ext.apply({
      title: 'ScrcpyNas投屏',
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
          html: '<iframe title="ScrcpyNas投屏" src="about:blank" frameborder="0" width="100%" height="100%" style="display:block"></iframe>',
          listeners: {
            // iframe 准备完成后取得当前 DSM 会话的 Token 再进入应用
            afterrender: function (component) {
              var request = new XMLHttpRequest();
              request.open('GET', '/webman/login.cgi', true);
              request.timeout = 10000;

              // 将 DSM 返回的 Token 附加到首次应用请求中
              request.onload = function () {
                if (request.status !== 200) return;
                try {
                  var data = JSON.parse(request.responseText);
                  if (!data.SynoToken) return;
                  component.getEl().down('iframe').dom.src = '/webman/zgcwkj/scrcpynasfree/?SynoToken=' + encodeURIComponent(data.SynoToken);
                } catch (_) {
                  return;
                }
              };
              request.send();
            }
          }
        })
      ]
    }, cfg);

    this.callParent([config]);
  }
});
