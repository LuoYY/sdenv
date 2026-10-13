#!/usr/bin/env node
// 宁夏重载形态验证: replace实参已证为同URL无query(纯重载).
// 实验: C=重载形态头(same-origin+referer, 无sec-fetch-user/uir, minimal精确构造);
//      再做完整二次页面加载(jsdom同cookieJar重载)后A/B对比
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');
const { FP } = require('../../browser/chrome/fingerprint');
const impersonate = require('../../utils/impersonate');

const url = process.argv[2] || 'https://pmos.nx.sgcc.com.cn:10443';
const SLB = /^(cookie_persist|4795e646f6f2323f05|BQ9IQ|AlteonP|d7e0ed82bbc395b309|JSESSIONID|BIGip|Alteon)/i;
const isRs = (n) => !SLB.test(n) && /[OP]$/.test(n);
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const OPTS = () => ({
  userAgent: FP.ua,
  proxy: process.env.proxy,
  windowProxyConfig: {
    windowGetterErrorKeys: ['process', 'global', 'require', 'module', '__dirname', '__filename', 'Buffer'],
    windowGetterUndefinedKeys: ['_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers','_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy','_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual','_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject','_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top','_virtualConsole','sdenv'],
  },
  consoleConfig: { log: new Function, info: new Function, warn: new Function, table: new Function, error: new Function },
  beforeParse: (window, sdenv) => {
    sdenv.getHandle('battery')('charging_success');
    sdenv.getHandle('dateAndRandom')({});
  },
});

const req = (label, cookieStr, opts) => impersonate.request(url, { ...opts, headers: { ...opts.headers, cookie: cookieStr }, proxy: process.env.proxy }).then(r => {
  const re = r.setCookies.filter(x => isRs(x.split('=')[0]));
  logger.info(`${ts()} ${label}: ${r.status} ${re.length ? '重发:' + re.map(x => x.split('=')[0]).join(',') : (r.setCookies.length ? '(' + r.setCookies.map(x => x.split('=')[0]).join(',') + ')' : '无Set-Cookie')}`);
  return r.status;
}).catch(err => { logger.error(`${label} 失败: ${(err.curlErr || err.message || '').slice(0, 60)}`); return 'ERR'; });

async function main() {
  const dom = await jsdomFromUrl(url, OPTS());
  const jar = dom.cookieJar; // 必须在 close() 前捕获(getter 在文档死后返回null)
  logger.info(`[${ts()}] 首页加载 cookies: ${jar.getCookieStringSync(url).split(/;\s*/).map(kv => kv.split('=')[0]).join(',') || '无'}`);
  dom.window.addEventListener('sdenv:exit', async (e) => {
    logger.info(`[${ts()}] EXIT(${e.detail.eventId}) replace实参: ${e.detail.url}`);
    // C: 重载形态——脚本发起导航: same-origin + referer, 无 sec-fetch-user/uir
    const reloadHeaders = { ...FP.headers, referer: url, 'sec-fetch-site': 'same-origin' };
    delete reloadHeaders['sec-fetch-user'];
    delete reloadHeaders['upgrade-insecure-requests'];
    const c = await req('C重载形态头', jar.getCookieStringSync(url), { mode: 'minimal', headers: reloadHeaders });
    e.target.close();
    if (c === 200) { logger.info(`结论: ★ 重载形态头即通过——400根因=请求头形态(直敲导航头 vs 脚本重载)`); process.exit(0); }
    // 完整浏览器重载模拟: 同jar二次加载replace目标
    try {
      const dom2 = await jsdomFromUrl(e.detail.url, { ...OPTS(), cookieJar: jar });
      logger.info(`[${ts()}] 二次页面加载完成 title=${JSON.stringify(dom2.window.document.title).slice(0, 40)} cookies: ${jar.getCookieStringSync(url).split(/;\s*/).map(kv => kv.split('=')[0]).join(',') || '无'}`);
      dom2.window.addEventListener('sdenv:exit', (e2) => { logger.info(`[${ts()}] 二次EXIT(${e2.detail.eventId}): ${e2.detail.url}`); e2.target.close(); });
      setTimeout(async () => {
        const c2 = jar.getCookieStringSync(url);
        const a = await req('A全导航头', c2, { headers: { 'sec-fetch-site': 'none' } });
        const b = await req('B最小头  ', c2, { mode: 'minimal', headers: { 'user-agent': FP.ua, accept: '*/*' } });
        logger.info(`结论: C=${c} A=${a} B=${b} ${a === 200 || b === 200 ? '★ 二次加载后通过!' : '仍非200'}`);
        process.exit(a === 200 || b === 200 ? 0 : 1);
      }, 5000);
    } catch (err) {
      logger.error(`二次页面加载失败: ${err.message}`);
      process.exit(1);
    }
  });
  setTimeout(() => { logger.error('总超时(未等到exit)'); process.exit(1); }, 90 * 1000);
}
main().catch(e => { logger.error(e.message); process.exit(1); });
