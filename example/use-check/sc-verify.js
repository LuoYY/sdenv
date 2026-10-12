#!/usr/bin/env node
// 通用验证: P/T cookie 齐全后二次请求
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = process.argv[2];
const waitAll = (process.argv[3] || '').split(',').filter(Boolean); // 需要等待的cookie名
if (!url) throw new Error('用法: node sc-verify.js <url> [cookie1,cookie2]');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const INTERNAL_KEYS = [
  '_commonForOrigin', '_currentEvent', '_currentOriginData', '_document', '_eventHandlers',
  '_frameElement', '_getEventHandlerFor', '_getEventHandlerTarget', '_globalEventChanged', '_globalProxy',
  '_initGlobalEvents', '_length', '_localStorage', '_origin', '_parent', '_pretendToBeVisual',
  '_proxyWindowEventsToWindow', '_registeredHandlers', '_resourceLoader', '_runScripts', '_sdGlobalObject',
  '_selection', '_sessionHistory', '_sessionStorage', '_setEventHandlerFor', '_storageQuota', '_top',
  '_virtualConsole', 'sdenv',
];

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
    },
  });
  const { window, cookieJar } = dom;
  const t0 = Date.now();
  logger.info(`nsd: ${window.$_ts && window.$_ts.nsd}`);
  const timer = setInterval(() => {
    const c = cookieJar.getCookieStringSync(url);
    const names = c.split(/;\s*/).map(kv => kv.split('=')[0]);
    const ok = waitAll.every(n => names.includes(n));
    if (ok && Date.now() - t0 > 15000) {
      clearInterval(timer);
      logger.info('cookie: ' + c.slice(0, 140));
      (async () => {
        try {
          const res = await fetch(url, { headers: { Cookie: c, 'user-agent': UA } });
          const text = await res.text();
          const m = text.match(/<title>([^<]*)<\/title>/);
          logger.info(`二次请求: ${res.status} 标题: ${(m && m[1] || '').trim() || '无'} 含挑战页: ${text.includes('$_ts')}`);
          process.exit(0);
        } catch(err) { logger.error('二次请求失败: ' + err.message); process.exit(1); }
      })();
    }
  }, 1000);
  setTimeout(() => {
    clearInterval(timer);
    logger.error(`超时2.5分钟, cookies: ${cookieJar.getCookieStringSync(url).split(/;\s*/).map(kv=>kv.split('=')[0]).join(',')}`);
    process.exit(1);
  }, 150 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
