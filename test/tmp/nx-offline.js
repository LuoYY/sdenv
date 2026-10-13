#!/usr/bin/env node
// nx 离线复现: 联网抓一次挑战页(HTML+O cookie)存盘, 之后本地反复跑VMP做环境差分(零对站消耗)
// 用法: node nx-offline.js fetch   (联网取材, 需 proxy=http://...)
//       node nx-offline.js run    (离线跑VMP; NAV_LOG=1 打印全部navigator读取; 目标: P长度343→356)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
const fs = require('fs');
try{require('module-alias')(require('../../utils/paths').basePath)}catch(err){};
const { jsdomFromUrl, jsdomFromText, jsdom, logger } = require('sdenv');
const impersonate = require('../../utils/impersonate');

const url = 'https://pmos.nx.sgcc.com.cn:10443/';
const HTMLF = '/tmp/nx-challenge.html', OF = '/tmp/nx-o.txt', VMPF = '/tmp/nx-vmp.js';

async function fetchMaterial() {
  const r = await impersonate.request(url, { proxy: process.env.proxy, insecure: true, timeout: 60 });
  const o = r.setCookies.find(s => s.startsWith('3RKyaeh47p90O='));
  if (!o) throw new Error('首包无O cookie: ' + r.setCookies.join(','));
  fs.writeFileSync(HTMLF, r.body);
  fs.writeFileSync(OF, o);
  const html = r.body.toString();
  const src = (html.match(/src="(\/[^"]+\.js)"/) || [])[1];
  if (!src) throw new Error('挑战页未找到外链VMP: ' + html.slice(0, 200));
  const vr = await impersonate.request(new URL(url).origin + src, {
    proxy: process.env.proxy, insecure: true, timeout: 60,
    headers: { cookie: o, referer: url }, mode: 'sub',
  });
  fs.writeFileSync(VMPF, vr.body);
  console.log(`材料已存: HTML(${r.body.length}B) + O(${o.split('=').pop().length}字符) + VMP ${src}(${vr.body.length}B)`);
}

function runOffline() {
  const html = fs.readFileSync(HTMLF);
  const vmp = fs.readFileSync(VMPF);
  const jar = new jsdom.CookieJar();
  jar.setCookieSync(fs.readFileSync(OF, 'utf8').trim(), url, { ignoreError: true });
  const navReads = [];
  // 外链VMP本地供给, 离线零网络
  class LocalLoader extends jsdom.ResourceLoader {
    fetch(u, opts) {
      if (u.includes('/c9qYRt1w5yKr/')) return Promise.resolve(vmp);
      return super.fetch(u, opts);
    }
  }
  const dom = jsdomFromText(html, {
    url, cookieJar: jar, runScripts: 'dangerously', resources: new LocalLoader(),
    consoleConfig: { log: new Function, info: new Function, warn: new Function, table: new Function, error: new Function },
    beforeParse: (window, sdenv) => {
      sdenv.getHandle('battery')('charging_success');
      sdenv.getHandle('dateAndRandom')({});
      // VMP 的每次 document.cookie 写入都打出来(签名: val, key, count)——含完整属性
      sdenv.getHandle('cookie')({ setCb: (val, key, count) => {
        console.log(`[cookie写#${count}] ${String(val)}`);
        const now = jar.getCookieStringSync(url);
        console.log(`  写后jar: ${now.split(/;\s*/).map(kv => kv.split('=')[0]).join(',') || '(空)'}`);
      } });
      if (process.env.MUTATE === 'apis') {
        // 补真实Chrome桌面有而jsdom缺的API(navigator全量读日志发现)
        const n = window.navigator;
        const def = (k, v) => { try {
          Object.defineProperty(n, k, { value: v, configurable: true });
          if (typeof v === 'function') sdenv.tools.setFuncNative(v, k);
        } catch (e) {} };
        def('sendBeacon', function sendBeacon() { return true; });
        def('webkitPersistentStorage', { queryUsageAndQuota: function () {}, requestQuota: function () {} });
        def('vibrate', function vibrate() { return false; });
        def('locks', { request: function () { return new Promise(() => {}); }, query: function () { return Promise.resolve(undefined); } });
      }
      if (process.env.MUTATE === 'stack') {
        // 栈擦洗: 把 file:///node: 帧改写为VMP脚本URL, 模拟真实浏览器的stack内容
        const VMPURL = 'https://pmos.nx.sgcc.com.cn:10443/c9qYRt1w5yKr/83bw0aTvAW7K.2437991.js';
        window.Error.prepareStackTrace = (err, frames) => {
          const lines = [`${err && err.name || 'Error'}: ${err && err.message || ''}`];
          for (const f of frames.slice(0, 10)) {
            let fn = f.getFileName() || '';
            if (fn.startsWith('file:') || fn.startsWith('node:') || fn === '') fn = VMPURL;
            lines.push(`    at ${f.getFunctionName() || ''} (${fn}:${f.getLineNumber()}:${f.getColumnNumber()})`);
          }
          return lines.join('\n');
        };
      }
      if (process.env.NAV_LOG === '1') {
        try {
          const orig = window.navigator;
          const p = new Proxy(orig, { get(t, k) { if (typeof k === 'string') navReads.push(k); return t[k]; } });
          Object.defineProperty(window, 'navigator', { value: p, configurable: true });
        } catch (e) { logger.error('navigator代理失败: ' + e.message); }
      }
    },
  });
  setTimeout(() => {
    jar.getCookieStringSync(url).split(/;\s*/).forEach(kv => {
      const [n, ...v] = kv.split('=');
      if (n) logger.info(`cookie ${n} 长度${v.join('=').length}`);
    });
    if (process.env.NAV_LOG === '1') logger.info('navigator全部读取(按首现序): ' + [...new Set(navReads)].join(', '));
    process.exit(0);
  }, 20000);
}

(process.argv[2] === 'fetch' ? fetchMaterial() : Promise.resolve()).then(() => {
  if (process.argv[2] === 'fetch') process.exit(0); // fetch模式不自动跑run
  runOffline();
}).catch(e => { console.error('ERR:', e.curlErr || e.message); process.exit(1); });
// 附: 时间基检查(独立子进程避免污染主流程)
