'use strict';

// UI 模块 绑定页面事件和弹窗行为 具体设备和投屏动作交给 devices/stream 模块

// 打开一个弹窗
function openModal(id) {
  const modal = $(`#${id}`);
  if (modal) modal.classList.remove('hidden');
}

// 关闭一个弹窗
function closeModal(id) {
  const modal = $(`#${id}`);
  if (modal) modal.classList.add('hidden');
}

// 网络连接成功后统一收尾 避免连接 选中和投屏状态分散在多个回调里
async function connectNetworkDevice(payload) {
  const data = await postJson(apiUrl('/api/connect'), payload);
  if (!data.ok) {
    return data;
  }

  $('#connectForm').reset();
  closeModal('connectModal');
  selectedIsUsb = false;
  selectedSerial = data.serial || `${payload.ip}:${payload.port || '5555'}`;
  selectedRecordId = data.record?.id || '';
  await loadDevices();
  await openMirror(selectedSerial);
  return data;
}

// USB 连接成功后顺手补一条记录 确保列表和当前选择保持一致
async function connectUsbDevice(device) {
  const ok = await connectUsb(device);
  if (!ok) {
    return { ok: false };
  }
  const record = await saveUsbRecord(device);
  if (record) {
    selectedRecordId = record.id || selectedRecordId;
    renderRecordListSelection();
  }
  return { ok: true, record };
}

// 关闭侧边栏
function closeSidebar() {
  document.querySelector('.app-shell')?.classList.remove('sidebar-open');
}

// 主题色按钮的图标和提示 图标表示点击后切换到的主题
const PAGE_THEME_ICONS = {
  light: 'fa-moon-o',
  dark: 'fa-sun-o',
};
const PAGE_THEME_LABELS = {
  light: '主题色：浅色 点击切换到深色',
  dark: '主题色：深色 点击切换到浅色',
};

// 主题色在浅色 深色之间切换并刷新按钮外观
function togglePageTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyPageTheme(next);
  renderThemeToggle();
}

// 同步主题色按钮的图标和提示
function renderThemeToggle() {
  const btn = $('#themeToggleBtn');
  const dark = document.documentElement.dataset.theme === 'dark';
  const icon = btn.querySelector('.fa');
  icon.classList.remove(...Object.values(PAGE_THEME_ICONS));
  icon.classList.add(dark ? PAGE_THEME_ICONS.dark : PAGE_THEME_ICONS.light);
  btn.title = dark ? PAGE_THEME_LABELS.dark : PAGE_THEME_LABELS.light;
}

// 把当前页面在新标签打开
function openCurrentPageInNewTab() {
  window.open(window.location.href, '_blank', 'noopener');
}

// 加载运行日志
async function loadLogs() {
  const logBox = $('#logs');
  try {
    const data = await api(apiUrl('/api/logs'));
    if (!data.ok) {
      logBox.textContent = data.error || '日志读取失败';
      $('#logsEmpty').classList.add('hidden');
      return;
    }

    const text = data.text || '';
    logBox.textContent = text;
    $('#logsEmpty').classList.toggle('hidden', !!text);
    logBox.scrollTop = logBox.scrollHeight;
  } catch (e) {
    logBox.textContent = `日志读取失败：${String(e)}`;
    $('#logsEmpty').classList.add('hidden');
  }
}

// 绑定连接弹窗的提交逻辑 连接结果统一在此反馈到用户
function bindConnectForm() {
  $('#connectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#connectMsg');

    msg.textContent = '连接中...';
    msg.className = 'msg';

    const payload = {
      ip: $('#ip').value.trim(),
      port: $('#port').value.trim(),
      pairPort: $('#pairPort').value.trim(),
      pairCode: $('#pairCode').value.trim(),
      name: $('#recordName').value.trim(),
      maxSize: getSelectedMaxSize(),
    };
    const data = await connectNetworkDevice(payload);

    if (data.ok) {
      msg.textContent = '连接成功';
      msg.className = 'msg ok';
    } else {
      const detail = (data.results || [])
        .map((r) => `${r.step}: code=${r.code} ${r.out || ''} ${r.err || ''}`.trim())
        .join('\n');
      msg.textContent = `连接失败。${detail || data.error || ''}`;
      msg.className = 'msg err';
      await loadLogs();
    }
  });
}

// 绑定 USB 连接按钮
function bindUsbConnectButton() {
  $('#usbConnectBtn').addEventListener('click', async () => {
    const msg = $('#connectMsg');
    msg.textContent = '扫描 USB 设备...';
    msg.className = 'msg';
    try {
      const data = await api(apiUrl('/api/devices'));
      const usb = (data.usb || []).filter((d) => d.state !== 'offline');
      if (!usb.length) {
        msg.textContent = '未检测到 USB 设备';
        msg.className = 'msg err';
        return;
      }
      const device = usb.find((d) => d.state === 'device') || usb[0];
      const result = await connectUsbDevice(device);
      if (!result.ok) {
        msg.textContent = 'USB 设备未授权或无法连接';
        msg.className = 'msg err';
        return;
      }
      if (!result.record) {
        msg.textContent = '设备已连接，但记录保存失败';
        msg.className = 'msg warn';
        return;
      }
      closeModal('connectModal');
    } catch (e) {
      msg.textContent = `扫描失败：${escapeHtml(String(e))}`;
      msg.className = 'msg err';
    }
  });
}

// 绑定主页面按钮
function bindPageControls() {
  $('#connectOpenBtn').addEventListener('click', () => openModal('connectModal'));
  $('#maxSizeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#maxSizeSeg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
  });
  $('#menuBtn').addEventListener('click', () => {
    document.querySelector('.app-shell')?.classList.toggle('sidebar-open');
  });
  $('#sidebarCloseBtn').addEventListener('click', closeSidebar);
  $('#sidebarBackdrop').addEventListener('click', closeSidebar);
  $('#themeToggleBtn').addEventListener('click', togglePageTheme);
  $('#logsOpenBtn').addEventListener('click', async () => {
    await loadLogs();
    openModal('logsModal');
  });
  $('#aboutOpenBtn').addEventListener('click', () => openModal('aboutModal'));
  $('#refreshBtn').addEventListener('click', loadDevices);
  $('#refreshLogsBtn').addEventListener('click', loadLogs);
  $('#openNewBtn').addEventListener('click', openSelectedInNewTab);
  $('#disconnectBtn').addEventListener('click', disconnectSelectedDevice);

  const logo = $('.logo');
  if (logo) logo.onclick = openCurrentPageInNewTab;
}

// 绑定弹窗关闭和键盘行为
function bindModalControls() {
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('connectModal');
      closeModal('logsModal');
      closeModal('aboutModal');
    }
  });
}

// 初始化页面
function initApp() {
  bindConnectForm();
  bindUsbConnectButton();
  bindPageControls();
  bindModalControls();

  renderThemeToggle();
  pollEngine();
  loadDevices();
  loadLogs();
  setInterval(loadDevices, 10000);
}

initApp();
