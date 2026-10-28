'use strict';

// 主题色引导脚本 必须在样式表之前同步加载 保证首屏就是正确的配色
// 主题选择缓存在浏览器本地 打包版服务端没有全局设置接口

// 主题色本地缓存键 用于首屏渲染前先套用上次选择
var PAGE_THEME_STORAGE = 'scrcpynas.theme';
// 系统深色偏好查询 自动模式下跟随系统配色变化
var PAGE_THEME_QUERY = window.matchMedia('(prefers-color-scheme: dark)');
// 当前主题色选择 自动模式下需要按系统配色重新解析
var pageThemeChoice = 'auto';

// 把主题色选择解析为具体外观并写入文档根节点 同时缓存选择避免下次闪色
function applyPageTheme(theme) {
  pageThemeChoice = theme === 'light' || theme === 'dark' ? theme : 'auto';
  var dark = pageThemeChoice === 'dark' || (pageThemeChoice === 'auto' && PAGE_THEME_QUERY.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    window.localStorage.setItem(PAGE_THEME_STORAGE, pageThemeChoice);
  } catch (e) {}
}

// 读取上次保存的主题色选择 本地存储不可用时按自动处理
function readCachedPageTheme() {
  try {
    return window.localStorage.getItem(PAGE_THEME_STORAGE) || 'auto';
  } catch (e) {
    return 'auto';
  }
}

// 系统配色变化时按当前选择重新解析主题色
function handlePageThemeChange() {
  applyPageTheme(pageThemeChoice);
}

// 首屏先套用缓存主题 后续的手动切换由页面按钮触发
applyPageTheme(readCachedPageTheme());
PAGE_THEME_QUERY.addEventListener('change', handlePageThemeChange);
