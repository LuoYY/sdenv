#!/usr/bin/env node
// 通用验证: 等目标cookie生成后二次请求, 以Set-Cookie重发为判据
// SDENV_IMPERSONATE=1 时 jsdom 资源加载与二次请求均走 curl-impersonate (Chrome TLS/h2 + Chrome144头)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');
const { FP } = require('../../browser/chrome/fingerprint');
const impersonate = require('../../utils/impersonate');

const url = process.argv[2] || 'https://pmos.sc.sgcc.com.cn/';
const needAll = (process.argv[3] || 'PLOb9dbGTCt1P,RP2kXhpV57gmT').split(',');
const UA = FP.ua;
const INTERNAL_KEYS = [
  '_commonForOrigin', '_currentEvent', '_currentOriginData', '_document', '_eventHandlers',
  '_frameElement', '_getEventHandlerFor', '_getEventHandlerTarget', '_globalEventChanged', '_globalProxy',
  '_initGlobalEvents', '_length', '_localStorage', '_origin', '_parent', '_pretendToBeVisual',
  '_proxyWindowEventsToWindow', '_registeredHandlers', '_resourceLoader', '_runScripts', '_sdGlobalObject',
  '_selection', '_sessionHistory', '_sessionStorage', '_setEventHandlerFor', '_storageQuota', '_top',
  '_virtualConsole', 'sdenv',
];
const SLB_COOKIES = ['cookie_persist', '4795e646f6f2323f05', 'BQ9IQ', 'AlteonP', 'd7e0ed82bbc395b309'];
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function main() {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    proxy: process.env.proxy,
    windowProxyConfig: {
      windowGetterErrorKeys: ['process', 'global', 'require', 'module', '__dirname', '__filename', 'Buffer'],
      windowGetterUndefinedKeys: INTERNAL_KEYS,
    },
    consoleConfig: { error: new Function },
    beforeParse: function (window, sdenv) {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
      delete window.sdenv;
    },
  });
  const { window, cookieJar } = dom;
  logger.info(`[${ts()}] nsd: ${window.$_ts && window.$_ts.nsd}`);
  const t = setInterval(() => {
    const c = cookieJar.getCookieStringSync(url);
    const names = c.split(/;\s*/).map(kv => kv.split('=')[0]);
    if (needAll.every(n => names.includes(n))) {
      clearInterval(t);
      logger.info(`[${ts()}] 目标cookie就绪`);
      (async () => {
        try {
          const isRsCookie = (n) => !SLB_COOKIES.includes(n) && !/^(JSESSIONID|BIGip|Alteon)/i.test(n);
          let res;
          if (process.env.SDENV_IMPERSONATE === '1') {
            const r = await impersonate.request(url, {
              headers: { cookie: c, 'sec-fetch-site': 'none' },
              proxy: process.env.proxy,
            });
            const challenge = r.setCookies.some(s => isRsCookie(s.split('=')[0]));
            logger.info(`二次请求(impersonate): ${r.status}`);
            logger.info(`服务端Set-Cookie: ${r.setCookies.map(s => s.split('=')[0]).join(', ') || '无'}`);
            logger.info(challenge ? `未通过：仍重发瑞数cookie` : '★ 通过：服务端不再重发挑战cookie');
            process.exit(challenge ? 1 : 0);
          }
          res = await fetch(url, { headers: { Cookie: c, 'user-agent': UA }, ...(process.env.proxy ? { dispatcher: new (require('undici').ProxyAgent)(process.env.proxy) } : {}) });
          const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
          const names2 = sc.map(s => s.split('=')[0]);
          const challenge = names2.some(isRsCookie);
          logger.info(`二次请求: ${res.status}`);
          logger.info(`服务端Set-Cookie: ${names2.length ? names2.join(', ') : '无'}`);
          logger.info(challenge ? `未通过：仍重发瑞数cookie` : '★ 通过：服务端不再重发挑战cookie');
          process.exit(challenge ? 1 : 0);
        } catch(err) { logger.error('二次请求失败: ' + err.message); process.exit(1); }
      })();
    }
  }, 1000);
  setTimeout(() => { clearInterval(t); logger.error(`[${ts()}] 超时3分钟`); process.exit(1); }, 3 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
