#!/usr/bin/env node
// 冀北观察: 时间线 + cookie监控 + CPU采样，判断是慢还是卡死
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = process.argv[2] || 'https://pmos.jibei.sgcc.com.cn';
const { FP } = require('../../browser/chrome/fingerprint');
const UA = FP.ua;
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function main() {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    consoleConfig: { error: new Function },
    beforeParse: function (window, sdenv) {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
    },
  });
  const { window, cookieJar } = dom;
  logger.info(`[${ts()}] $_ts.nsd: ${window.$_ts && window.$_ts.nsd}`);
  const seen = new Set();
  setInterval(() => {
    cookieJar.getCookieStringSync(url).split(/;\s*/).filter(Boolean).forEach(kv => {
      const name = kv.split('=')[0];
      if (!seen.has(name)) { seen.add(name); logger.info(`[${ts()}] COOKIE+ ${name}`); }
    });
  }, 500);
  window.addEventListener('sdenv:exit', (e) => {
    logger.info(`[${ts()}] EXIT ${e.detail.eventId}`);
    logger.info('cookie: ' + cookieJar.getCookieStringSync(url).slice(0, 100));
    process.exit(0);
  });
  // 每30秒输出心跳
  setInterval(() => {
    const cpu = process.cpuUsage();
    logger.info(`[${ts()}] 心跳 cpu:${((cpu.user + cpu.system) / 1000000).toFixed(1)}s cookies:${[...seen].length}`);
  }, 30000);
  setTimeout(() => { logger.error(`[${ts()}] 超时15分钟`); process.exit(1); }, 15 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
