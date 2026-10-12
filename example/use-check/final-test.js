#!/usr/bin/env node
// 最终验证: 删除 window.sdenv 后跑瑞数站（框架内部已改用闭包引用）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');

const url = process.argv[2];
if (!url) throw new Error('用法: node final-test.js <url>');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function main() {
  const dom = await jsdomFromUrl(url, {
    userAgent: UA,
    consoleConfig: { error: new Function },
    beforeParse: function (window, sdenv) {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
      delete window.sdenv;
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
      // 二次验证
      try {
        const res = await fetch(url, { headers: { Cookie: cookies, 'user-agent': UA } });
        const text = await res.text();
        const m = text.match(/<title>([^<]*)<\/title>/);
        logger.info(`二次请求: ${res.status} 标题: ${(m && m[1] || '').trim() || '无'}`);
        process.exit(res.status === 200 ? 0 : 1);
      } catch(err) { logger.error('二次请求失败: ' + err.message); process.exit(1); }
    }
  });
  setTimeout(() => { logger.error(`[${ts()}] 超时5分钟 cookies:${[...seen].join(',')}`); process.exit(1); }, 5 * 60 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
