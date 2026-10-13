#!/usr/bin/env node
// 宁夏环境探针: 记录 VMP 的属性访问序列(window层) + navigator/document/screen 读值 + API调用,
// 结束时自动分析"被访问但值为undefined/null"的属性——即环境缺失候选(新增环境校验的嫌疑对象)
// 用法: SDENV_IMPERSONATE=1 [proxy=http://...] node nx-probe.js <url> [输出文件]
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const fs = require('fs');
const { jsdomFromUrl, logger } = require('sdenv');
const { FP } = require('../../browser/chrome/fingerprint');

const url = process.argv[2];
const outFile = process.argv[3] || '/tmp/nx-props.log';
if (!url) throw new Error('用法: node nx-probe.js <url> [输出文件]');

const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const access = [];   // window层访问序列(含非get操作前缀)
const readLog = [];  // navigator/document/screen 属性读值
const callLog = [];  // 被包装API的调用

async function main() {
  const dom = await jsdomFromUrl(url, {
    userAgent: FP.ua,
    proxy: process.env.proxy,
    windowProxyConfig: {
      windowGetterErrorKeys: ['process', 'global', 'require', 'module', '__dirname', '__filename', 'Buffer'],
      windowGetterUndefinedKeys: ['_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers','_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy','_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual','_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject','_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top','_virtualConsole','sdenv'],
      log: (type, prop) => {
        if (typeof prop !== 'string') return;
        access.push(type === 'get' ? prop : `[${type}]${prop}`);
      },
    },
    consoleConfig: { log: new Function, info: new Function, warn: new Function, table: new Function, error: new Function },
    beforeParse: function (window, sdenv) {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
      // XHR 实例化监控(sdenv-extend request handle): VMP beacon 走 jsdom XHR = Node TLS 出口
      sdenv.getHandle('request')({ cb: ({ response, url, status }) => {
        callLog.push(`XHR ${url} -> ${status} | ${String(response).slice(0, 80)}`);
      } });
      // fetch 监控(若环境有)
      if (typeof window.fetch === 'function') {
        const origFetch = window.fetch;
        window.fetch = function (input, init) {
          const u = typeof input === 'string' ? input : (input && input.url) || '';
          callLog.push(`fetch ${u} ${(init && init.method) || 'GET'}`);
          return origFetch.apply(this, arguments);
        };
        try { sdenv.tools.setFuncNative(window.fetch, 'fetch'); } catch (e) {}
      }
      const setFuncNative = sdenv.tools.setFuncNative;

      // 属性读值监控: 包一层getter记录(值不变)
      const logRead = (obj, name, label) => {
        if (!obj) return;
        try {
          const d = Object.getOwnPropertyDescriptor(obj, name);
          if (!d || d.get && !d.configurable) return;
          Object.defineProperty(obj, name, {
            configurable: true,
            get() { const v = d.get ? d.get.call(this) : d.value; readLog.push(`${label}.${name}=${v === null ? 'null' : typeof v === 'object' || typeof v === 'function' ? typeof v : String(v).slice(0, 50)}`); return v; },
            set(v) { if (d.set) d.set.call(this, v); else d.value = v; },
          });
        } catch (e) {}
      };
      ['userAgent','appVersion','platform','vendor','language','languages','hardwareConcurrency','deviceMemory','maxTouchPoints','pdfViewerEnabled','plugins','mimeTypes','connection','webdriver','doNotTrack','cookieEnabled','onLine','product','productSub','oscpu','buildID','storage','permissions','mediaDevices','credentials','serviceWorker','userActivation','globalPrivacyControl','wakeLock','hid','usb','serial','bluetooth','gamepadGesture','xr'].forEach(k => logRead(window.navigator, k, 'nav'));
      ['cookie','referrer','title','URL','domain','characterSet','compatMode','hidden','visibilityState','fonts','pictureInPictureEnabled','fullscreenEnabled','designMode','referrerPolicy'].forEach(k => logRead(window.document, k, 'doc'));
      ['width','height','availWidth','availHeight','colorDepth','pixelDepth','availLeft','availTop','orientation'].forEach(k => logRead(window.screen, k, 'screen'));
      ['devicePixelRatio','innerWidth','innerHeight','outerWidth','outerHeight','chrome','Notification','speechSynthesis','AudioContext','OfflineAudioContext','webkitAudioContext','performance','statusbar','menubar','scrollbars','toolbars'].forEach(k => logRead(window, k, 'win'));

      // API调用监控(返回值不变)
      const wrapCall = (obj, name, label) => {
        const fn = obj && obj[name];
        if (typeof fn !== 'function') return;
        const wrapped = function (...args) {
          callLog.push(`${label}.${name}(${args.map(a => typeof a === 'string' ? JSON.stringify(a.slice(0, 24)) : typeof a).join(', ')})`);
          return fn.apply(this, args);
        };
        try { setFuncNative(wrapped, name); } catch (e) {}
        try { obj[name] = wrapped; } catch (e) {}
      };
      wrapCall(window.performance, 'now', 'perf');
      wrapCall(window.performance, 'getEntries', 'perf');
      wrapCall(window.performance, 'getEntriesByType', 'perf');
      wrapCall(window.performance, 'mark', 'perf');
      wrapCall(window.Date.prototype, 'getTimezoneOffset', 'Date');
      if (window.Intl && window.Intl.DateTimeFormat) wrapCall(window.Intl.DateTimeFormat.prototype, 'resolvedOptions', 'Intl');
      if (window.document.fonts) ['check', 'entries', 'values', 'forEach'].forEach(m => wrapCall(window.document.fonts, m, 'fonts'));
      if (window.speechSynthesis) wrapCall(window.speechSynthesis, 'getVoices', 'tts');
      if (window.Notification) wrapCall(window.Notification, 'requestPermission', 'notif');
      if (window.navigator.permissions) wrapCall(window.navigator.permissions, 'query', 'perm');
      if (window.navigator.mediaDevices) wrapCall(window.navigator.mediaDevices, 'enumerateDevices', 'media');
      if (window.navigator.plugins) ['item', 'namedItem', 'refresh'].forEach(m => wrapCall(window.navigator.plugins, m, 'plugins'));
      logger.info(`[${ts()}] beforeParse探针挂载完成`);
    },
  });
  const { window, cookieJar } = dom;
  logger.info(`[${ts()}] 页面加载 nsd=${window.$_ts && window.$_ts.nsd}`);
  window.addEventListener('sdenv:exit', (e) => finish(`EXIT(${e.detail.eventId})`, window));

  let done = false;
  setInterval(() => {
    const c = cookieJar.getCookieStringSync(url);
    if (!done && /P$/.test(c.split(/;\s*/).map(kv => kv.split('=')[0]).find(n => /P$/.test(n)) || '')) {
      // P cookie出现后再等5秒让收尾探针跑完
      setTimeout(() => finish('P就绪+5s', window), 5000);
      done = true;
    }
    if (Date.now() - t0 > 90 * 1000) finish('总超时90s', window);
  }, 1000);

  function finish(reason, win) {
    if (finish.ran) return; finish.ran = true;
    logger.info(`[${ts()}] 结束: ${reason} | 访问${access.length}次/去重${new Set(access).size} | 读值${readLog.length} | 调用${callLog.length}`);
    fs.writeFileSync(outFile, access.join('\n'));
    // 分析: 被访问的window属性中当前值为undefined的(排除内部键与纯数字)
    const uniq = [...new Set(access.map(p => p.replace(/^\[\w+\]/, '')))];
    const missing = [];
    for (const p of uniq) {
      if (/^\d+$/.test(p) || /^[A-Za-z_$][\w$]*$/.test(p) === false) continue;
      try { if (win[p] === undefined) missing.push(p); } catch (e) {}
    }
    console.log('\n===== 被访问但值为undefined的window属性(环境缺失候选) =====');
    console.log(missing.join(', ') || '(无)');
    console.log('\n===== navigator/document/screen 读值(null/undefined项优先) =====');
    const reads = [...new Set(readLog)];
    reads.filter(r => /=null$|=undefined$/.test(r)).forEach(r => console.log('  ' + r));
    console.log(`  (其余读值${reads.filter(r => !/=null$|=undefined$/.test(r)).length}项正常, 全量见stderr)`);
    console.error(reads.filter(r => !/=null$|=undefined$/.test(r)).join('\n'));
    console.log('\n===== API调用记录 =====');
    console.log([...new Set(callLog)].join('\n') || '(无)');
    process.exit(0);
  }
}
main().catch(e => { logger.error(e.message); process.exit(1); });
