#!/usr/bin/env node
// 四川组合矩阵测试: 删sdenv × canvas桩(卸载包与否由外部控制) —— 输出60秒内cookie生成状态
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const delSdenv = process.env.DEL_SDENV === '1';
const url = 'https://pmos.sc.sgcc.com.cn/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const INTERNAL_KEYS = ['_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers','_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy','_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual','_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject','_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top','_virtualConsole','sdenv'];

(async () => {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    windowProxyConfig: {
      windowGetterErrorKeys: ['process','global','require','module','__dirname','__filename','Buffer'],
      windowGetterUndefinedKeys: INTERNAL_KEYS,
    },
    consoleConfig: { error: new Function },
    beforeParse: (window, sdenv) => {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
      if (delSdenv) delete window.sdenv;
    },
  });
  setTimeout(() => {
    const c = dom.cookieJar.getCookieStringSync(url);
    const names = c.split(/;\s*/).map(kv => kv.split('=')[0]);
    const p1 = names.includes('PLOb9dbGTCt1P') ? '✓' : '✗';
    const t2 = names.includes('RP2kXhpV57gmT') ? '✓' : '✗';
    console.log(`RESULT delSdenv=${delSdenv} P1=${p1} T2=${t2} | ${names.join(',')}`);
    process.exit(0);
  }, 60000);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
