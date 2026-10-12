#!/usr/bin/env node
// 四川最终验证(含canvas): 等双cookie后二次请求, 以Set-Cookie重发为判据
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = process.argv[2] || 'https://pmos.sc.sgcc.com.cn/';
const needAll = (process.argv[3] || 'PLOb9dbGTCt1P,RP2kXhpV57gmT').split(',');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const INTERNAL_KEYS = [
  '_commonForOrigin', '_currentEvent', '_currentOriginData', '_document', '_eventHandlers',
  '_frameElement', '_getEventHandlerFor', '_getEventHandlerTarget', '_globalEventChanged', '_globalProxy',
  '_initGlobalEvents', '_length', '_localStorage', '_origin', '_parent', '_pretendToBeVisual',
  '_proxyWindowEventsToWindow', '_registeredHandlers', '_resourceLoader', '_runScripts', '_sdGlobalObject',
  '_selection', '_sessionHistory', '_sessionStorage', '_setEventHandlerFor', '_storageQuota', '_top',
  '_virtualConsole', 'sdenv',
];
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function main() {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
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
      logger.info(`[${ts()}] 双cookie就绪`);
      (async () => {
        try {
          const res = await fetch(url, { headers: { Cookie: c, 'user-agent': UA } });
          const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
          const names2 = sc.map(s => s.split('=')[0]);
          logger.info(`二次请求: ${res.status}`);
          logger.info(`服务端Set-Cookie: ${names2.length ? names2.join(', ') : '无'}`);
          logger.info(names2.length === 0 ? '★ 通过：服务端不再重发挑战cookie' : `未通过：仍重发 ${names2.filter(n => n !== 'cookie_persist' && n !== '4795e646f6f2323f05' && n !== 'BQ9IQ').join(',')}`);
          process.exit(0);
        } catch(err) { logger.error('二次请求失败: ' + err.message); process.exit(1); }
      })();
    }
  }, 1000);
  setTimeout(() => { clearInterval(t); logger.error(`[${ts()}] 超时3分钟`); process.exit(1); }, 3 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
