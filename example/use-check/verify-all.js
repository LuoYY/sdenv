#!/usr/bin/env node
// 全网严格验证: 等目标cookie生成后二次请求, 判据=服务端不再Set-Cookie挑战
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');
const { FP } = require('../../browser/chrome/fingerprint');
const sites = JSON.parse(require('fs').readFileSync(process.argv[2] || __dirname + '/rs-sites.json', 'utf8'));
const INTERNAL_KEYS = ['_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers','_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy','_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual','_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject','_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top','_virtualConsole','sdenv'];
const impersonate = require('../../utils/impersonate');
const UA = FP.ua;

async function verifyOne(name, url, pCookie) {
  return new Promise(async (resolve) => {
    const done = (r) => { resolve(r); };
    try {
      const dom = await jsdomFromUrl(url, {
        userAgent: UA,
        proxy: process.env.proxy,
        windowProxyConfig: {
          windowGetterErrorKeys: ['process','global','require','module','__dirname','__filename','Buffer'],
          windowGetterUndefinedKeys: INTERNAL_KEYS,
        },
        consoleConfig: { error: new Function },
        beforeParse: (window, sdenv) => {
          sdenv.getHandle('battery')('charging_success');
          sdenv.getHandle('dateAndRandom')({});
        },
      });
      const t0 = Date.now();
      const timer = setInterval(() => {
        const c = dom.cookieJar.getCookieStringSync(url);
        if (c.includes(pCookie) && Date.now() - t0 > 10000) {
          clearInterval(timer);
          (async () => {
            try {
              const r = await impersonate.request(url, { headers: { cookie: c }, proxy: process.env.proxy });
              const sc = r.setCookies;
              const challenge = sc.some(s => new RegExp('^' + pCookie.replace(/P$/, '[OP]$')).test(s.split('=')[0]));
              done({ name, pass: !challenge, status: r.status, note: sc.length === 0 ? '无Set-Cookie' : '重发:' + sc.map(s=>s.split('=')[0]).join(',') });
            } catch(e) { done({ name, pass: false, note: '二次请求失败 ' + e.message.slice(0, 40) }); }
          })();
        }
      }, 1000);
      setTimeout(() => { clearInterval(timer); done({ name, pass: false, note: '超时(P cookie未生成)' }); }, 150000);
    } catch(e) { done({ name, pass: false, note: e.message.slice(0, 50) }); }
  });
}

(async () => {
  for (const s of sites) {
    const r = await verifyOne(s.name, s.url, s.pCookie);
    console.log(`${r.pass ? '✅' : '❌'} ${r.name} ${r.status || ''} ${r.note}`);
  }
  process.exit(0);
})();
