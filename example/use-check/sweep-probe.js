#!/usr/bin/env node
// 排雷验证: window 代理 + errorKeys + undefinedKeys(隐藏sdenv/jsdom内部属性) + 电池/随机数
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = process.argv[2];
if (!url) throw new Error('用法: node sweep-probe.js <url>');
const { FP } = require('../../browser/chrome/fingerprint');
const UA = FP.ua;
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

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
  logger.info(`[${ts()}] nsd: ${window.$_ts && window.$_ts.nsd}`);
  const seen = new Set();
  setInterval(() => {
    cookieJar.getCookieStringSync(url).split(/;\s*/).filter(Boolean).forEach(kv => {
      const name = kv.split('=')[0];
      if (!seen.has(name)) { seen.add(name); logger.info(`[${ts()}] COOKIE+ ${name}`); }
    });
  }, 300);
  window.addEventListener('sdenv:exit', async (e) => {
    if (['location.replace', 'location.assign'].includes(e.detail.eventId)) {
      const cookies = cookieJar.getCookieStringSync(url);
      logger.info(`[${ts()}] EXIT ${e.detail.eventId}`);
      logger.info('cookie: ' + cookies.slice(0, 110));
      try {
        const res = await fetch(url, { headers: { Cookie: cookies, 'user-agent': UA } });
        const text = await res.text();
        const m = text.match(/<title>([^<]*)<\/title>/);
        logger.info(`二次请求: ${res.status} 标题: ${(m && m[1] || '').trim() || '无'}`);
        process.exit(res.status === 200 ? 0 : 1);
      } catch(err) { logger.error('二次请求失败: ' + err.message); process.exit(1); }
    }
  });
  setTimeout(() => { logger.error(`[${ts()}] 超时4分钟 cookies:${[...seen].join(',')}`); process.exit(1); }, 4 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
