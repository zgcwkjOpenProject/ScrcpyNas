'use strict';

/**
 * API 路由注册。
 *
 * 从 server.js 抽出的所有 /api/* 处理器，逻辑实现逐字搬迁、不重写；
 * 依赖项通过 deps 显式注入，保持与项目其它 createXxx({...}) 工厂一致的装配风格。
 */

// 校验并规范 TCP 端口 防止非法值传入连接探测后变成服务端异常
function parseTcpPort(value, fallback) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  const text = raw || String(fallback);
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? String(port) : null;
}

// 注册应用所需的 HTTP API 并注入运行时依赖
function registerApiRoutes(app, deps) {
  const {
    appPath,
    runAdb,
    parseDevices,
    readRecords,
    writeRecords,
    upsertRecord,
    makeRecordId,
    normalizeRecord,
    checkWsScrcpy,
    checkTcp,
    findDevice,
    isUsbDevice,
    extractDeviceModel,
    wsScrcpyHost,
    wsScrcpyPort,
    platform,
    readLogTail,
    logFile,
    appLogFile,
    varLogFile,
  } = deps;

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  // 返回当前 adb 设备列表
  app.get(appPath('/api/devices'), async (_req, res) => {
    try {
      const devices = await parseDevices();
      res.json({ ok: true, devices, usb: devices.filter(isUsbDevice) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  // 返回内部投屏引擎状态
  app.get(appPath('/api/engine'), async (_req, res) => {
    res.json({ ok: true, ready: await checkWsScrcpy(), host: wsScrcpyHost, port: wsScrcpyPort });
  });

  // 返回保存记录和当前设备列表
  app.get(appPath('/api/records'), async (_req, res) => {
    try {
      const devices = await parseDevices();
      res.json({ ok: true, records: readRecords(), devices, usb: devices.filter(isUsbDevice) });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });

  // 保存连接记录
  app.post(appPath('/api/records'), (req, res) => {
    const record = normalizeRecord(req.body || {});
    if (!record.ip && !record.serial) {
      return res.status(400).json({ ok: false, error: '缺少设备信息' });
    }
    res.json({ ok: true, record: upsertRecord(record) });
  });

  // 删除连接记录
  app.post(appPath('/api/records/delete'), (req, res) => {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ ok: false, error: '缺少记录 ID' });
    }
    writeRecords(readRecords().filter((item) => item.id !== id));
    res.json({ ok: true });
  });

  // 执行无线调试配对和连接
  app.post(appPath('/api/connect'), async (req, res) => {
    const { ip, port, pairPort, pairCode, name } = req.body || {};
    if (!ip) {
      return res.status(400).json({ ok: false, error: '缺少设备 IP' });
    }
    const devPort = parseTcpPort(port, '5555');
    if (!devPort) {
      return res.status(400).json({ ok: false, error: '连接端口必须是 1 到 65535 之间的整数' });
    }
    const pairingPort = pairCode ? parseTcpPort(pairPort, devPort) : '';
    if (pairCode && !pairingPort) {
      return res.status(400).json({ ok: false, error: '配对端口必须是 1 到 65535 之间的整数' });
    }
    const results = [];

    try {
      console.log(
        `[connect] ip=${ip} port=${devPort} pairPort=${pairPort || ''} hasPairCode=${!!pairCode}`
      );

      const before = await runAdb(['devices', '-l'], 10000);
      results.push({ step: 'devices-before-connect', ...before });
      console.log(`[adb] devices before connect code=${before.code} out=${before.out} err=${before.err}`);

      // Android 11+ 无线调试先配对再连接
      if (pairCode) {
        const pairTarget = `${ip}:${pairingPort}`;
        const pairTcp = await checkTcp(ip, pairingPort);
        results.push({
          step: 'tcp-pair-port',
          code: pairTcp.ok ? 0 : -1,
          out: pairTcp.ok ? `TCP ${pairTarget} reachable` : '',
          err: pairTcp.ok ? '' : `TCP ${pairTarget} unreachable: ${pairTcp.error}`,
        });
        console.log(`[tcp] pair ${pairTarget} reachable=${pairTcp.ok} error=${pairTcp.error || ''}`);
        if (!pairTcp.ok) {
          return res.json({ ok: false, results });
        }

        console.log(`[adb] pair ${pairTarget}`);
        const pr = await runAdb(['pair', pairTarget, String(pairCode)]);
        results.push({ step: 'pair', ...pr });
        console.log(`[adb] pair result code=${pr.code} out=${pr.out} err=${pr.err}`);
        if (pr.code !== 0) {
          return res.json({ ok: false, results });
        }
      }

      const connectTarget = `${ip}:${devPort}`;
      const connectTcp = await checkTcp(ip, devPort);
      results.push({
        step: 'tcp-connect-port',
        code: connectTcp.ok ? 0 : -1,
        out: connectTcp.ok ? `TCP ${connectTarget} reachable` : '',
        err: connectTcp.ok ? '' : `TCP ${connectTarget} unreachable: ${connectTcp.error}`,
      });
      console.log(
        `[tcp] connect ${connectTarget} reachable=${connectTcp.ok} error=${connectTcp.error || ''}`
      );
      if (!connectTcp.ok) {
        return res.json({ ok: false, results });
      }

      console.log(`[adb] connect ${connectTarget}`);
      const cr = await runAdb(['connect', connectTarget], 15000);
      results.push({ step: 'connect', ...cr });
      console.log(`[adb] connect result code=${cr.code} out=${cr.out} err=${cr.err}`);

      const after = await runAdb(['devices', '-l'], 10000);
      results.push({ step: 'devices-after-connect', ...after });
      console.log(`[adb] devices after connect code=${after.code} out=${after.out} err=${after.err}`);

      const output = cr.out + cr.err;
      const ok =
        cr.code === 0 &&
        /connected|already/i.test(output) &&
        !/failed|unable|cannot|unauthorized/i.test(output) &&
        !/\sunauthorized\b/i.test(after.out);
      const serial = connectTarget;
      const device = findDevice(await parseDevices(), serial);
      const model = extractDeviceModel(device);
      // 连接成功后再落记录 避免保存无法连接的设备
      const record = ok
        ? upsertRecord({
            id: makeRecordId({ ip, port: devPort }),
            transport: 'network',
            name,
            ip,
            port: devPort,
            pairPort,
            model,
            serial,
            maxSize: String(req.body.maxSize || '').trim(),
          })
        : undefined;
      res.json({ ok, results, serial, device, record });
    } catch (e) {
      console.error(`[connect] failed: ${e && e.message ? e.message : e}`);
      res.status(500).json({ ok: false, error: String(e && e.message), results });
    }
  });

  // 断开指定 adb 设备
  app.post(appPath('/api/disconnect'), async (req, res) => {
    const { serial } = req.body || {};
    if (!serial) {
      return res.status(400).json({ ok: false, error: '缺少 serial' });
    }
    const r = await runAdb(['disconnect', serial]);
    res.json({ ok: r.code === 0, ...r });
  });

  // 接收投屏页补充鼠标操作并转成 adb input；键盘由 ws-scrcpy 原生参数处理
  app.post(appPath('/api/device/input'), async (req, res) => {
    const { serial, type, key, longpress } = req.body || {};
    const keyMap = {
      BACK: '4',
      HOME: '3',
    };

    if (!serial) {
      return res.status(400).json({ ok: false, error: '缺少 serial' });
    }

    if (type === 'key') {
      const keyCode = keyMap[key];
      if (!keyCode) {
        return res.status(400).json({ ok: false, error: '不支持的按键' });
      }
      const args = ['-s', serial, 'shell', 'input', 'keyevent'];
      if (longpress) args.push('--longpress');
      args.push(keyCode);
      console.log(`[device-input] ${serial} key=${key} longpress=${!!longpress}`);
      const r = await runAdb(args, 10000);
      return res.json({ ok: r.code === 0, ...r });
    }

    return res.status(400).json({ ok: false, error: '不支持的输入类型' });
  });

  // 清理设备侧旧的 scrcpy-server 进程
  app.post(appPath('/api/stream/prepare'), async (req, res) => {
    const { serial } = req.body || {};
    if (!serial) {
      return res.status(400).json({ ok: false, error: '缺少 serial' });
    }

    const script = [
      'for p in $(pidof app_process app_process32 app_process64 2>/dev/null); do',
      '  if grep -q "com.genymobile.scrcpy.Server" /proc/$p/cmdline 2>/dev/null || grep -q "scrcpy-server.jar" /proc/$p/cmdline 2>/dev/null; then',
      '    echo "kill scrcpy-server pid=$p";',
      '    kill $p 2>/dev/null;',
      '  fi;',
      'done',
    ].join(' ');

    console.log(`[stream] prepare ${serial}`);
    const r = await runAdb(['-s', serial, 'shell', 'sh', '-c', script], 10000);
    console.log(`[stream] prepare result code=${r.code} out=${r.out} err=${r.err}`);
    res.json({ ok: r.code === 0, ...r });
  });

  // 返回服务健康状态
  app.get(appPath('/api/health'), (_req, res) => res.json({ ok: true }));

  app.get(appPath('/api/auth'), (req, res) => {
    res.json({ ok: true, platform: platform || 'none', user: (req.auth && req.auth.user) || null });
  });

  // 返回套件运行日志
  app.get(appPath('/api/logs'), (_req, res) => {
    try {
      const candidates = [logFile, appLogFile, varLogFile].filter(Boolean);
      const unique = [...new Set(candidates)];
      const logs = unique.map((file) => readLogTail(file));
      const selected = logs.find((item) => item.exists) || logs[0] || { text: '' };
      res.json({
        ok: true,
        active: selected.path || logFile,
        logs,
        text: selected.text || '',
        truncated: !!selected.truncated,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });
}

module.exports = { registerApiRoutes };
