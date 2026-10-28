'use strict';

const fs = require('fs');
const path = require('path');

function makeRecordId(record) {
  const transport = String(record.transport || '').trim().toLowerCase();
  const ip = String(record.ip || '').trim();
  const port = String(record.port || '5555').trim() || '5555';
  const serial = String(record.serial || '').trim();

  // USB 没有 ip:port，必须用真实 serial 做稳定主键
  if (transport === 'usb' || (!ip && serial)) {
    return `usb:${serial}`;
  }

  return `${ip}:${port}`;
}

function normalizeRecord(record) {
  const ip = String(record.ip || '').trim();
  const port = String(record.port || '5555').trim() || '5555';
  const serial = String(record.serial || '').trim();
  // 老记录没有 transport 字段，按是否存在 IP 做兼容推断
  const transport = String(record.transport || '').trim().toLowerCase() || (ip ? 'network' : 'usb');
  const id = String(record.id || makeRecordId({ ip, port, serial, transport })).trim();
  return {
    id,
    transport,
    name: String(record.name || '').trim(),
    ip,
    port,
    pairPort: String(record.pairPort || '').trim(),
    model: String(record.model || '').trim(),
    serial: serial || (transport === 'usb' ? id.replace(/^usb:/, '') : `${ip}:${port}`),
    maxSize: String(record.maxSize || '').trim(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

function createRecordStore(recordsFile) {
  function readRecords() {
    try {
      if (!fs.existsSync(recordsFile)) return [];
      const raw = JSON.parse(fs.readFileSync(recordsFile, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizeRecord).filter((item) => item.ip || item.serial);
    } catch (e) {
      console.error(`[records] read failed: ${e.message}`);
      return [];
    }
  }

  function writeRecords(records) {
    fs.mkdirSync(path.dirname(recordsFile), { recursive: true });
    fs.writeFileSync(recordsFile, JSON.stringify(records.map(normalizeRecord), null, 2));
  }

  function upsertRecord(record) {
    const next = normalizeRecord({ ...record, id: record.id || makeRecordId(record) });
    const records = readRecords().filter((item) => item.id !== next.id);
    records.unshift({ ...next, updatedAt: new Date().toISOString() });
    writeRecords(records);
    return next;
  }

  return {
    recordsFile,
    readRecords,
    writeRecords,
    upsertRecord,
  };
}

module.exports = { createRecordStore, makeRecordId, normalizeRecord };
