/*
 * 统一指纹单一来源: Chrome 144 / Windows 10 (网站官方推荐版本)
 * 数据引用: const { FP } = require('../browser/chrome/fingerprint')
 * 环境注入: browser/chrome/index.js 自动调用
 */
const FP = {
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  uaFullVersion: '144.0.0.0',
  platform: 'Win32',
  oscpu: 'Windows NT 10.0; Win64; x64',
  language: 'zh-CN',
  languages: ['zh-CN', 'zh'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 0,
  pdfViewerEnabled: true,
  plugins: ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'],
  secChUa: '"Chromium";v="144", "Google Chrome";v="144", "Not?A_Brand";v="99"',
  secChUaPlatform: '"Windows"',
  screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 },
  win: { devicePixelRatio: 1, innerWidth: 1536, innerHeight: 746, outerWidth: 1536, outerHeight: 824, screenX: 0, screenY: 0, screenLeft: 0, screenTop: 0 },
  headers: {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Chromium";v="144", "Google Chrome";v="144", "Not?A_Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
  },
  // 子资源(script/style/img)默认头: 导航专用头(sec-fetch-dest: document、sec-fetch-user、
  // upgrade-insecure-requests)不适用; sec-fetch-dest/mode/site 由 ResourceLoader 补丁
  // 按请求的 element 与 referrer 推断注入, accept-encoding 由 curl --compressed 自带
  subHeaders: {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Chromium";v="144", "Google Chrome";v="144", "Not?A_Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  },
};

module.exports = (sdenv) => {
  const window = sdenv.memory.window;
  const n = window.navigator;

  try {
    Object.defineProperty(n, 'userAgent', { get: () => FP.ua, configurable: true });
    Object.defineProperty(n, 'appVersion', { get: () => FP.ua.replace('Mozilla/', ''), configurable: true });
    Object.defineProperty(n, 'platform', { get: () => FP.platform, configurable: true });
    Object.defineProperty(n, 'language', { get: () => FP.language, configurable: true });
    Object.defineProperty(n, 'languages', { get: () => FP.languages, configurable: true });
    Object.defineProperty(n, 'hardwareConcurrency', { get: () => FP.hardwareConcurrency, configurable: true });
    Object.defineProperty(n, 'deviceMemory', { get: () => FP.deviceMemory, configurable: true });
    Object.defineProperty(n, 'pdfViewerEnabled', { get: () => FP.pdfViewerEnabled, configurable: true });
  } catch (e) { /* 不可重定义属性忽略 */ }

  try {
    const s = window.screen;
    for (const [k, v] of Object.entries(FP.screen)) {
      Object.defineProperty(s, k, { get: () => v, configurable: true });
    }
  } catch (e) {}

  try {
    for (const [k, v] of Object.entries(FP.win)) {
      Object.defineProperty(window, k, { get: () => v, configurable: true });
    }
  } catch (e) {}
};
module.exports.FP = FP;
