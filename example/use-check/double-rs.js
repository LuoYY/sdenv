#!/usr/bin/env node
// 双瑞数分层诊断: 记录外链脚本加载、jsdomError、cookie生成时间线
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = process.argv[2] || 'https://pmos.sc.sgcc.com.cn/';
const { FP } = require('../../browser/chrome/fingerprint');
const UA = FP.ua;
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function main() {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    consoleConfig: {
      error: (e) => {
        const msg = String(e && e.message || e).slice(0, 150);
        logger.error(`[${ts()}] jsdomError: ${msg}`);
      },
    },
    beforeParse: function (window, sdenv) {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
      logger.info(`[${ts()}] beforeParse 完成`);
    },
  });
  const { window, cookieJar } = dom;
  logger.info(`[${ts()}] $_ts: ${!!window.$_ts}`);
  const seen = new Set();
  setInterval(() => {
    cookieJar.getCookieStringSync(url).split(/;\s*/).filter(Boolean).forEach(kv => {
      const name = kv.split('=')[0];
      if (!seen.has(name)) {
        seen.add(name);
        logger.info(`[${ts()}] COOKIE+ ${name}=${kv.split('=')[1].slice(0, 40)}`);
      }
    });
  }, 300);
  window.addEventListener('sdenv:exit', (e) => {
    logger.info(`[${ts()}] EXIT ${e.detail.eventId} -> ${e.detail.url}`);
    process.exit(0);
  });
  setTimeout(() => {
    logger.error(`[${ts()}] 超时3分钟, 最终cookie名: ${[...seen].join(',')}`);
    process.exit(1);
  }, 3 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
