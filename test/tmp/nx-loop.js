#!/usr/bin/env node
// 宁夏闭环诊断版: jsdomError可见 + cookie时间线 + 180s超时 + 失败时dump页面状态; 二次请求走impersonate
// 用法: SDENV_IMPERSONATE=1 proxy=http://... node nx-loop.js [url] [Pcookie名,...]
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');
const { FP } = require('../../browser/chrome/fingerprint');
const impersonate = require('../../utils/impersonate');

const url = process.argv[2] || 'https://pmos.nx.sgcc.com.cn:10443';
const need = (process.argv[3] || '3RKyaeh47p9P').split(',');
const UA = FP.ua;
const INTERNAL_KEYS = ['_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers','_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy','_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual','_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject','_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top','_virtualConsole','sdenv'];
const SLB_COOKIES = ['cookie_persist', '4795e646f6f2323f05', 'BQ9IQ', 'AlteonP', 'd7e0ed82bbc395b309'];
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

(async () => {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    proxy: process.env.proxy,
    windowProxyConfig: {
      windowGetterErrorKeys: ['process', 'global', 'require', 'module', '__dirname', '__filename', 'Buffer'],
      windowGetterUndefinedKeys: INTERNAL_KEYS,
    },
    consoleConfig: {
      log: new Function, info: new Function, warn: new Function, table: new Function, // 页面console静默(上轮858KB刷屏教训)
      error: (e) => logger.error(`[${ts()}] jsdomError: ${e && e.message}${e && e.cause ? ' | cause: ' + (e.cause.curlErr || e.cause.message || '?') : ''}`),
    },
    beforeParse: (window, sdenv) => {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
      logger.info(`[${ts()}] beforeParse完成`);
    },
  });
  logger.info(`[${ts()}] 页面加载 nsd=${dom.window.$_ts && dom.window.$_ts.nsd}`);

  const timer = setInterval(() => {
    const names = dom.cookieJar.getCookieStringSync(url).split(/;\s*/).map(kv => kv.split('=')[0]).filter(Boolean);
    logger.info(`[${ts()}] cookies: ${names.join(',') || '无'} | readyState: ${dom.window.document.readyState}`);
    if (need.every(n => names.includes(n))) {
      clearInterval(timer);
      logger.info(`[${ts()}] P cookie就绪`);
      const c = dom.cookieJar.getCookieStringSync(url);
      impersonate.request(url, { headers: { cookie: c, 'sec-fetch-site': 'none' }, proxy: process.env.proxy }).then(r => {
        const isRs = (n) => !SLB_COOKIES.includes(n) && !/^(JSESSIONID|BIGip|Alteon)/i.test(n);
        const challenge = r.setCookies.some(s => isRs(s.split('=')[0]));
        logger.info(`二次请求(impersonate): ${r.status} | Set-Cookie: ${r.setCookies.map(s => s.split('=')[0]).join(', ') || '无'}`);
        logger.info(challenge ? '未通过: 仍重发瑞数cookie' : '★ 通过: 服务端不再重发挑战cookie');
        process.exit(challenge ? 1 : 0);
      }).catch(e => { logger.error('二次请求失败: ' + (e.curlErr || e.message)); process.exit(1); });
    }
  }, 2000);

  setTimeout(() => {
    clearInterval(timer);
    const d = dom.window.document;
    logger.error(`[${ts()}] 超时, P cookie未生成。诊断:`);
    logger.error(`  scripts: ${[...d.scripts].map(s => s.src || '(inline)').join(' | ')}`);
    logger.error(`  readyState: ${d.readyState} | $_ts: ${dom.window.$_ts ? '存在' : '不存在'} | location: ${dom.window.location.href}`);
    process.exit(1);
  }, 180000);
})();
