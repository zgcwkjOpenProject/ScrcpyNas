'use strict';

const net = require('net');
const { spawn } = require('child_process');

// 兜底强杀 adb 进程 kill-server 都叫不动时用系统命令清理
function forceKillAdbProcesses() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'taskkill' : 'pkill';
    // 按进程名精确匹配 避免误伤路径里含 adb 的其它进程
    const args = isWin ? ['/F', '/IM', 'adb.exe'] : ['-9', '-x', 'adb'];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      const child = spawn(cmd, args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {
          /* ignore */
        }
        finish();
      }, 5000);
      child.on('close', () => {
        clearTimeout(timer);
        finish();
      });
      child.on('error', () => {
        clearTimeout(timer);
        finish();
      });
    } catch (_) {
      finish();
    }
  });
}

function createAdb(adbBin) {
  function runAdb(args, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const child = spawn(adbBin, args, { env: process.env });
      let out = '';
      let err = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        err = `${err ? `${err}\n` : ''}timeout after ${timeoutMs}ms`;
        try {
          child.kill('SIGKILL');
        } catch (_) {
          /* ignore */
        }
        // SIGKILL 可能因权限/竞态失败而延迟，显式 unref 让事件循环不再等待这个子进程，
        // 避免僵尸进程长期残留或阻止 Node 正常退出。
        try {
          if (typeof child.unref === 'function') child.unref();
        } catch (_) {
          /* ignore */
        }
        resolve({ code: -2, out: out.trim(), err: err.trim() });
      }, timeoutMs);

      child.stdout.on('data', (data) => (out += data.toString()));
      child.stderr.on('data', (data) => (err += data.toString()));
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, out: out.trim(), err: err.trim() });
      });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: -1, out, err: e.message });
      });
    });
  }

  async function parseDevices() {
    const { out } = await runAdb(['devices', '-l']);
    const lines = out.split('\n').slice(1);
    const devices = [];
    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(\S+)(.*)$/);
      if (!match) continue;
      // transport 判定：优先用 adb devices -l 行内的 usb: 字段，命中即为 USB；
      // 否则按序列号是否含冒号推断网络连接。不依赖 transport_id（不同 adb 版本可能没有）。
      // 这样 emulator-5554 这类无冒号也非 USB 的设备不会被误判为 USB。
      const info = match[3].trim();
      const hasUsbField = /\busb:[^\s]/.test(info);
      const transport = hasUsbField ? 'usb' : match[1].includes(':') ? 'network' : 'usb';
      devices.push({ serial: match[1], state: match[2], info, transport });
    }
    return devices;
  }

  // 卡住时先停 adb 服务 kill-server 也叫不动就强杀进程 下次调用会自动拉起
  async function killAdbServer(timeoutMs = 5000) {
    const r = await runAdb(['kill-server'], timeoutMs);
    const stuck = r.code === -2 || r.code === -1;
    if (stuck) await forceKillAdbProcesses();
    return { ...r, forced: stuck };
  }

  return { runAdb, parseDevices, killAdbServer };
}

function checkTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;

    const finish = (ok, error = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok, error });
    };

    const timer = setTimeout(() => finish(false, `tcp timeout after ${timeoutMs}ms`), timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('error', (e) => finish(false, e.message));
  });
}

function findDevice(devices, serial) {
  return devices.find((item) => item.serial === serial);
}

// 判断设备是否为 USB 连接（序列号不含冒号即为 USB 或本地传输）
function isUsbDevice(device) {
  return !!(device && device.transport === 'usb');
}

function extractDeviceModel(device) {
  const match = String((device && device.info) || '').match(/(?:^|\s)model:([^\s]+)/);
  return match ? match[1] : '';
}

function encodeAdbInputText(text) {
  return String(text || '').replace(/%/g, '%25').replace(/\s/g, '%s').replace(/'/g, "'\\''");
}

module.exports = {
  createAdb,
  checkTcp,
  findDevice,
  isUsbDevice,
  extractDeviceModel,
  encodeAdbInputText,
};
