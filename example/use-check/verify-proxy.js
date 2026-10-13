#!/usr/bin/env node
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl } = require('sdenv');
const { FP } = require('../../browser/chrome/fingerprint');
const INTERNAL_KEYS = ['_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers','_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy','_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual','_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject','_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top','_virtualConsole','sdenv'];
const impersonate = require('../../utils/impersonate');
const UA = FP.ua;
const sites = JSON.parse(process.env.SITES || 'null') || [

  { name: '宁夏', url: 'https://pmos.nx.sgcc.com.cn:10443', pCookie: '3RKyaeh47p9P' },
];
(async () => {
  for (const s of sites) {
    try {
      const dom = await jsdomFromUrl(s.url, {
        userAgent: UA, proxy: process.env.proxy,
        windowProxyConfig: { windowGetterErrorKeys: ['process','global','require','module','__dirname','__filename','Buffer'], windowGetterUndefinedKeys: INTERNAL_KEYS },
        consoleConfig: { error: new Function },
        beforeParse: (w, sd) => { sd.getHandle('battery')('charging_success'); sd.getHandle('dateAndRandom')({}); },
      });
      await new Promise((resolve) => {
        const t0 = Date.now();
        const timer = setInterval(() => {
          const c = dom.cookieJar.getCookieStringSync(s.url);
          if (c.includes(s.pCookie) && Date.now() - t0 > 10000) {
            clearInterval(timer);
            impersonate.request(s.url, { headers: { cookie: c }, proxy: process.env.proxy }).then(r => {
              const sc = r.setCookies;
              console.log(`${!sc.some(x => new RegExp(s.pCookie.replace(/P$/, '[OP]$')).test(x.split('=')[0])) ? 'PASS' : 'FAIL'} ${s.name} ${r.status} ${sc.length === 0 ? '无Set-Cookie' : '重发:' + sc.map(x=>x.split('=')[0]).join(',')}`);
              resolve();
            }).catch(e => { console.log(`FAIL ${s.name} 二次请求失败 ${String(e.message).slice(0, 40)}`); resolve(); });
          }
        }, 1000);
        setTimeout(() => { clearInterval(timer); console.log(`FAIL ${s.name} 超时`); resolve(); }, 180000);
      });
    } catch(e) { console.log(`FAIL ${s.name} ${e.message.slice(0, 40)}`); }
  }
  process.exit(0);
})();
