#!/usr/bin/env node
// 8 瑞数站二次请求 A/B 归因测试: 挑战后带cookie二次请求, A=全导航头(现状) B=最小头(cookie+UA+accept, 对齐9月基线)
// 目的: 判别 nx 二次请求 400 是"我们的头引发"还是"cookie 本身坏"—— A非200而B=200则归因请求头
// 用法: SDENV_IMPERSONATE=1 proxy=http://... node rs8-loop.js   (proxy 仅安徽使用)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.env.OPENSSL_LEGACY_RENEGOTIATION = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, logger } = require('sdenv');
const { FP } = require('../../browser/chrome/fingerprint');
const impersonate = require('../../utils/impersonate');

const SITES = [
  { name: '新疆', url: 'https://pmos.xj.sgcc.com.cn:20080', minP: 1 },
  { name: '福建', url: 'https://pmos.fj.sgcc.com.cn', minP: 1 },
  { name: '湖北', url: 'https://newpmos.hb.sgcc.com.cn', minP: 1 },
  { name: '河南', url: 'https://pmos.ha.sgcc.com.cn', minP: 1, useProxy: true },
  { name: '陕西', url: 'https://pmos.sn.sgcc.com.cn', minP: 1 },
  { name: '冀北', url: 'https://pmos.jibei.sgcc.com.cn', minP: 1 },
  { name: '四川', url: 'https://pmos.sc.sgcc.com.cn', minP: 2 },
  { name: '安徽', url: 'https://pmos.ah.sgcc.com.cn:20080', minP: 1, useProxy: true },
  { name: '宁夏', url: 'https://pmos.nx.sgcc.com.cn:10443', minP: 1, useProxy: true },
];
const only = (process.argv[2] || '').split(',').filter(Boolean);
const RUN = only.length ? SITES.filter(s => only.includes(s.name)) : SITES;
const INTERNAL_KEYS = ['_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers','_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy','_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual','_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject','_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top','_virtualConsole','sdenv'];
const SLB = /^(cookie_persist|4795e646f6f2323f05|BQ9IQ|AlteonP|d7e0ed82bbc395b309|JSESSIONID|BIGip|Alteon)/i;
const isRs = (n) => !SLB.test(n) && /[OP]$/.test(n);
// 动态cookie后缀: 常见P, 四川第二层为T(RP2kXhpV57gmT)
const pNames = (jar, url) => jar.getCookieStringSync(url).split(/;\s*/).map(kv => kv.split('=')[0]).filter(n => n && !SLB.test(n) && /[PT]$/.test(n));

async function runSite(s) {
  const proxy = s.useProxy ? process.env.proxy : undefined;
  const t0 = Date.now();
  const ts = () => `${s.name}[${((Date.now() - t0) / 1000).toFixed(0)}s]`;
  let errShown = 0;
  return new Promise((resolve) => {
    jsdomFromUrl(s.url, {
      userAgent: FP.ua,
      proxy,
      windowProxyConfig: {
        windowGetterErrorKeys: ['process', 'global', 'require', 'module', '__dirname', '__filename', 'Buffer'],
        windowGetterUndefinedKeys: INTERNAL_KEYS,
      },
      consoleConfig: {
        log: new Function, info: new Function, warn: new Function, table: new Function,
        error: (e) => { if (errShown++ < 2) logger.error(`${ts()} jsdomError: ${e && e.message}`); },
      },
      beforeParse: (window, sdenv) => {
        sdenv.getHandle('battery')('charging_success');
        sdenv.getHandle('dateAndRandom')({});
      },
    }).then(dom => {
      const guard = setTimeout(() => {
        clearInterval(timer);
        logger.error(`${ts()} 超时, 实际cookies: ${dom.cookieJar.getCookieStringSync(s.url).split(/;\s*/).map(kv => kv.split('=')[0]).join(',') || '无'}`);
        resolve({ name: s.name, result: '超时未出P' });
      }, 150000);
      const timer = setInterval(() => {
        const pcs = pNames(dom.cookieJar, s.url);
        if (pcs.length >= s.minP) {
          clearInterval(timer); clearTimeout(guard);
          const c = dom.cookieJar.getCookieStringSync(s.url);
          logger.info(`${ts()} P就绪: ${pcs.join(',')} | 全部: ${c.split(/;\s*/).map(kv => kv.split('=')[0]).join(',')}`);
          (async () => {
            const one = (label, opts) => impersonate.request(s.url, opts).then(r => {
              const re = r.setCookies.filter(x => isRs(x.split('=')[0]));
              logger.info(`${ts()} ${label}: ${r.status} ${re.length ? '重发:' + re.map(x => x.split('=')[0]).join(',') : (r.setCookies.length ? '(' + r.setCookies.map(x => x.split('=')[0]).join(',') + ')' : '无Set-Cookie')}`);
              return r.status;
            }).catch(e => { logger.error(`${ts()} ${label} 失败: ${(e.curlErr || e.message || '').slice(0, 60)}`); return 'ERR'; });
            const a = await one('A全导航头', { headers: { cookie: c, 'sec-fetch-site': 'none' }, proxy });
            const b = await one('B最小头  ', { headers: { cookie: c, 'user-agent': FP.ua, accept: '*/*' }, proxy, mode: 'minimal' });
            resolve({ name: s.name, result: `A=${a} B=${b}`, pcs: pcs.join(',') });
          })();
        }
      }, 2000);
    }).catch(e => {
      logger.error(`${s.name} 页面加载失败: ${String(e.message).slice(0, 80)}`);
      resolve({ name: s.name, result: '加载失败' });
    });
  });
}

(async () => {
  const out = [];
  for (const s of RUN) {
    logger.info(`>>> ${s.name} 开始`);
    out.push(await runSite(s));
  }
  console.log('\n===== 汇总(状态码; 200=正常, 400=异常) =====');
  for (const o of out) console.log(`${o.name.padEnd(3)} ${o.result} ${o.pcs ? '| ' + o.pcs : ''}`);
  process.exit(0);
})();
