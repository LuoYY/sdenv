/*
 * 统一指纹对齐: 用真实浏览器采集值覆盖 sdenv 环境
 * 采集: 2026-09-21, Chrome UA, Apple M5 Pro, 屏幕2056x1329
 * 注意: UA 用 Chrome 121（与 sdenv 默认一致），硬件类值用真实值
 */
module.exports = (sdenv) => {
  const window = sdenv.memory.window;
  const setFuncNative = sdenv.tools.setFuncNative;
  const n = window.navigator;

  const FP = {
    platform: 'MacIntel',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh-Hans-CN'],
    hardwareConcurrency: 18,
    deviceMemory: 32,
    maxTouchPoints: 0,
    pdfViewerEnabled: true,
    plugins: ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'],
    screen: { width: 2056, height: 1329, availWidth: 2056, availHeight: 1226, colorDepth: 30, pixelDepth: 30 },
    win: { devicePixelRatio: 2, innerWidth: 723, innerHeight: 1019, outerWidth: 2056, outerHeight: 1226, screenX: 0, screenY: 39, screenLeft: 0, screenTop: 39 },
  };

  // navigator
  try {
    Object.defineProperty(n, 'platform', { get: () => FP.platform, configurable: true });
    Object.defineProperty(n, 'language', { get: () => FP.language, configurable: true });
    Object.defineProperty(n, 'languages', { get: () => FP.languages, configurable: true });
    Object.defineProperty(n, 'hardwareConcurrency', { get: () => FP.hardwareConcurrency, configurable: true });
    Object.defineProperty(n, 'deviceMemory', { get: () => FP.deviceMemory, configurable: true });
    Object.defineProperty(n, 'pdfViewerEnabled', { get: () => FP.pdfViewerEnabled, configurable: true });
  } catch (e) { /* 忽略不可重定义属性 */ }

  // screen
  try {
    const s = window.screen;
    for (const [k, v] of Object.entries(FP.screen)) {
      Object.defineProperty(s, k, { get: () => v, configurable: true });
    }
  } catch (e) {}

  // window 尺寸
  try {
    for (const [k, v] of Object.entries(FP.win)) {
      Object.defineProperty(window, k, { get: () => v, configurable: true });
    }
  } catch (e) {}
};
