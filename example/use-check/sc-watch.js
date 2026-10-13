#!/usr/bin/env node
// 四川第二层观察: 持续报告两个动态cookie状态5分钟
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = 'https://pmos.sc.sgcc.com.cn/';
const { FP } = require('../../browser/chrome/fingerprint');
const UA = FP.ua;
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
    consoleConfig: {
      error: (e) => logger.error(`jsdomError: ${String(e && e.message || e).slice(0, 100)}`),
    },
    beforeParse: function (window, sdenv) {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
    },
  });
  const { window, cookieJar } = dom;
  const t0 = Date.now();
  const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const state = {};
  setInterval(() => {
    const c = cookieJar.getCookieStringSync(url);
    for (const n of ['PLOb9dbGTCt1P', 'RP2kXhpV57gmT']) {
      const has = c.includes(n + '=');
      if (has !== state[n]) {
        state[n] = has;
        logger.info(`[${ts()}] ${n} ${has ? '已生成!' : '消失'}`);
      }
    }
  }, 500);
  setTimeout(() => { logger.error(`[${ts()}] 结束`); process.exit(0); }, 4 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
