#!/usr/bin/env node
// 属性访问记录器: 通过 window 代理 log 钩子记录 VMP get 访问序列，用于 diff 正常站/挂起站
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const fs = require('fs');
const { jsdomFromUrl, logger } = require('sdenv');

const url = process.argv[2];
const outFile = process.argv[3] || '/tmp/props.log';
if (!url) throw new Error('用法: node prop-diff.js <url> <输出文件>');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const t0 = Date.now();
const access = [];   // 按序记录
let dumping = false;

function finish(reason) {
  if (dumping) return; dumping = true;
  const uniq = [...new Set(access)];
  fs.writeFileSync(outFile, access.join('\n'));
  logger.info(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${reason}，共 ${access.length} 次访问 / ${uniq.length} 去重，已写 ${outFile}`);
  process.exit(0);
}

async function main() {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    windowProxyConfig: {
      log: (type, prop) => {
        if (type === 'get' && typeof prop === 'string') access.push(prop);
      },
    },
    consoleConfig: { error: new Function },
    beforeParse: function (window, sdenv) {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
    },
  });
  const { window, cookieJar } = dom;
  logger.info(`nsd: ${window.$_ts && window.$_ts.nsd}`);
  window.addEventListener('sdenv:exit', (e) => {
    finish(`EXIT ${e.detail.eventId}`);
  });
  // 挂起站不会 exit: 等CPU稳定(2分钟无新访问)或总超时
  setInterval(() => {
    if (Date.now() - t0 > 4 * 60 * 1000) finish('总超时');
  }, 5000);
  process.on('SIGTERM', () => finish('SIGTERM'));
}
main().catch(e => { logger.error(e.message); finish('ERROR'); });
