#!/usr/bin/env node
// 代理连通性测试: 经curl-impersonate(Chrome TLS/h2 + Chrome144导航头)对目标站单次GET, 返回412即视为通(RS挑战正常)
// 用法: node proxy-check.js [代理列表文件] [目标URL]   CONC=5 可调并发
// 只做连通性: 每代理仅发一次请求, 不跑挑战流程
const fs = require('fs');
const impersonate = require('../../utils/impersonate');

const listFile = process.argv[2] || '/tmp/proxy-urls.txt';
const target = process.argv[3] || 'https://pmos.nx.sgcc.com.cn:10443';
const CONC = parseInt(process.env.CONC || '5', 10);

const proxies = fs.readFileSync(listFile, 'utf8')
  .split('\n').map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

const verdict = (status) =>
  status === 412 ? '✅通(412挑战)' :
  status === 403 ? '⛔WAF拦(403)' :
  status === 200 ? '⚠️200' : `⚠️${status}`;

(async () => {
  console.log(`目标: ${target}\n代理数: ${proxies.length} | 并发: ${CONC} | 单请求上限15s\n`);
  let idx = 0, ok = 0, blocked = 0;
  const worker = async () => {
    while (idx < proxies.length) {
      const p = proxies[idx++];
      const t0 = Date.now();
      try {
        const r = await impersonate.request(target, { proxy: p, insecure: true, timeout: 15 });
        if (r.status === 412) ok++;
        else if (r.status === 403) blocked++;
        const s = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`${verdict(r.status)} ${s}s cookie:${r.setCookies.map(c => c.split('=')[0]).join(',') || '无'} <- ${p}`);
      } catch (e) {
        const reason = e.curlErr || String(e.message || e).split('\n').filter(Boolean).pop() || 'error';
        console.log(`❌失败 ${((Date.now() - t0) / 1000).toFixed(1)}s ${reason.slice(0, 70)} <- ${p}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, proxies.length) }, worker));
  console.log(`\n汇总: 412通=${ok} | 403拦=${blocked} | 其它/失败=${proxies.length - ok - blocked} | 共${proxies.length}`);
})();
