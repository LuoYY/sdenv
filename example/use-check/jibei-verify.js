#!/usr/bin/env node
// 冀北验证: 生成cookie后直接二次请求验证（不等跳转事件）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = 'https://pmos.jibei.sgcc.com.cn';
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
  // P cookie 出现后等10秒即验证
  const timer = setInterval(() => {
    const c = cookieJar.getCookieStringSync(url);
    if (/sC0HezowWBq0P=/.test(c) && Date.now() - t0 > 12000) {
      clearInterval(timer);
      logger.info('cookie: ' + c.slice(0, 120));
      (async () => {
        try {
          const res = await fetch(url, { headers: { Cookie: c, 'user-agent': UA } });
          const text = await res.text();
          const m = text.match(/<title>([^<]*)<\/title>/);
          const isChallenge = text.includes('$_ts');
          logger.info(`二次请求: ${res.status} 标题: ${(m && m[1] || '').trim() || '无'} 含挑战页: ${isChallenge}`);
          process.exit(0);
        } catch(err) { logger.error('二次请求失败: ' + err.message); process.exit(1); }
      })();
    }
  }, 1000);
  setTimeout(() => { logger.error('超时2分钟'); process.exit(1); }, 2 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
