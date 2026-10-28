'use strict';

// 设备模块负责 adb 记录、在线状态和左侧列表渲染
// 这里的函数都围绕记录、选择态和列表刷新展开
// 不把设备状态分散到多个文件里
// 加载左侧记录列表
async function loadDevices() {
  const box = $('#devices');
  try {
    const data = await api(apiUrl('/api/records'));
    records = data.records || [];
    currentDevices = (data.devices || []).filter((d) => d.state !== 'offline');

    if (!records.find((item) => item.id === selectedRecordId)) {
      selectedRecordId = selectedSerial ? '' : records[0]?.id || '';
    }

    if (!records.length) {
      selectedRecordId = '';
      box.innerHTML = '<p class="empty">暂无连接记录</p>';
      renderSelectedDevice();
      return;
    }

    // 轮询刷新会重复进入这里 先清空容器避免列表越刷越多
    box.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'device-group-list';
    records.forEach((record) => {
      const onlineDevice = findOnlineDeviceForRecord(record);
      const wrap = document.createElement('div');
      wrap.className = `device-wrap ${selectedRecordId === record.id ? 'active' : ''}`;

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'device';
      item.dataset.id = record.id;
      item.innerHTML = `
        <span class="device-dot ${getRecordStatusClass(onlineDevice)}" title="${escapeHtml(getRecordStateText(onlineDevice))}"></span>
        <span class="device-text">
          <span class="device-model">${escapeHtml(getRecordDisplayName(record, onlineDevice))}</span>
          <span class="device-address">${escapeHtml(getRecordAddress(record))}</span>
        </span>`;
      item.addEventListener('click', () => {
        closeSidebar();
        connectRecord(record.id);
      });

      const actions = document.createElement('div');
      actions.className = 'record-actions';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'record-action delete-record';
      del.title = '删除连接记录';
      del.setAttribute('aria-label', '删除连接记录');
      del.innerHTML = '<i class="fa fa-trash" aria-hidden="true"></i>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRecord(record.id);
      });
      actions.appendChild(del);

      wrap.appendChild(item);
      wrap.appendChild(actions);
      list.appendChild(wrap);
    });
    box.appendChild(list);

    renderSelectedDevice();
  } catch (e) {
    box.innerHTML = `<p class="empty">加载失败：${escapeHtml(String(e))}</p>`;
  }
}

// 选择并打开 USB 设备
async function connectUsb(device) {
  selectedRecordId = '';
  selectedIsUsb = true;
  selectedSerial = device?.serial || '';
  renderRecordListSelection();
  renderSelectedDevice();
  if (!selectedSerial || device.state !== 'device') {
    return false;
  }
  await openMirror(selectedSerial);
  return true;
}

// 选择并连接网络记录
async function connectRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;

  selectedRecordId = id;
  selectedIsUsb = false;
  renderRecordListSelection();
  selectedSerial = record.serial || `${record.ip}:${record.port || '5555'}`;
  renderSelectedDevice();

  const data = await postJson(apiUrl('/api/connect'), {
    ip: record.ip,
    port: record.port,
    pairPort: record.pairPort,
    name: record.name,
    maxSize: record.maxSize || '',
  });

  if (!data.ok) {
    await loadLogs();
    return;
  }

  selectedSerial = data.serial || record.serial || `${record.ip}:${record.port || '5555'}`;
  await loadDevices();
  await openMirror(selectedSerial);
}

// USB 设备单独落一条记录，和网络记录保持同一套列表逻辑
async function saveUsbRecord(device) {
  const serial = String(device?.serial || '').trim();
  if (!serial) return null;

  const data = await postJson(apiUrl('/api/records'), {
    transport: 'usb',
    serial,
    name: getDeviceModel(device) || serial,
    model: getDeviceModel(device),
    maxSize: getSelectedMaxSize(),
  });

  if (data.ok && data.record) {
    selectedRecordId = data.record.id || '';
    await loadDevices();
    return data.record;
  }

  return null;
}

// 删除一条连接记录
async function deleteRecord(id) {
  await postJson(apiUrl('/api/records/delete'), { id });
  if (selectedRecordId === id) {
    selectedRecordId = '';
    selectedSerial = '';
  }
  await loadDevices();
}

// 刷新左侧记录的选中态
function renderRecordListSelection() {
  document.querySelectorAll('.device-wrap').forEach((el) => {
    const button = el.querySelector('.device[data-id]');
    el.classList.toggle('active', button?.dataset.id === selectedRecordId);
  });
}

// 刷新右侧当前设备信息
function renderSelectedDevice() {
  const record = records.find((item) => item.id === selectedRecordId);
  const device = selectedSerial ? currentDevices.find((d) => d.serial === selectedSerial) : null;
  const canUse = !!selectedSerial && (!device || device.state === 'device');

  $('#openNewBtn').disabled = !canUse;
  $('#disconnectBtn').disabled = !selectedSerial;

  if (!record && !selectedSerial) {
    $('#selectedTitle').textContent = '未选择设备';
    $('#selectedMeta').textContent = '从左侧连接记录单击设备后自动连接并打开画面。';
    return;
  }

  $('#selectedTitle').textContent = record
    ? getRecordDisplayName(record, device)
    : (device && device.transport === 'usb' ? 'USB 设备' : selectedSerial);
  $('#selectedMeta').textContent = device
    ? formatDeviceMeta(device)
    : `连接目标：${record ? formatRecordMeta(record) : selectedSerial}`;

}

// 按记录匹配当前在线设备
function findOnlineDeviceForRecord(record) {
  const serial = record.serial || `${record.ip}:${record.port || '5555'}`;
  return currentDevices.find((device) => device.serial === serial);
}

// 把 adb 状态转成可读文本
function getStateText(state) {
  if (state === 'device') return '在线';
  if (state === 'unauthorized') return '未授权';
  if (state === 'offline') return '离线';
  if (state === 'stored') return '已保存';
  return state || '未知';
}

// 从 adb 信息里提取型号
function getDeviceModel(device) {
  const m = String(device?.info || '').match(/(?:^|\s)model:([^\s]+)/);
  return m ? m[1] : '';
}

// 计算列表里显示的主名称
function getRecordDisplayName(record, device) {
  return record.name || getDeviceModel(device) || record.model || record.ip;
}

// 计算列表里显示的地址
function getRecordAddress(record) {
  return record.ip ? `${record.ip}:${record.port || '5555'}` : record.serial || '';
}

// 计算记录状态文本
function getRecordStateText(device) {
  return device ? getStateText(device.state) : '已保存';
}

// 计算状态图标样式
function getRecordStatusClass(device) {
  if (!device) return 'stored';
  if (device.state === 'device') return 'ok';
  if (device.state === 'unauthorized') return 'warn';
  return 'stored';
}

// 计算右侧元信息里展示的连接串
function formatRecordMeta(record, device) {
  return device?.serial || record.serial || `${record.ip}:${record.port || '5555'}`;
}

// 计算右侧元信息里的设备说明
function formatDeviceMeta(device) {
  if (device.state === 'unauthorized') {
    return '手机未授权这台 NAS。请在手机弹窗中允许 USB 调试，若没有弹窗，撤销 USB 调试授权后重新连接。';
  }
  if (device.state !== 'device') {
    return `状态：${getStateText(device.state)} ${device.info || ''}`.trim();
  }
  return `MSE 视频流 · ${device.info || '已连接'}`;
}
