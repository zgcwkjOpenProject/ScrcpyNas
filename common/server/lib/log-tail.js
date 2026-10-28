'use strict';

const fs = require('fs');

function readLogTail(file, maxBytes = 120 * 1024) {
  if (!file || !fs.existsSync(file)) {
    return { path: file, exists: false, text: '' };
  }

  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    return {
      path: file,
      exists: true,
      size: stat.size,
      truncated: start > 0,
      text: buf.toString('utf8'),
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readLogTail };
