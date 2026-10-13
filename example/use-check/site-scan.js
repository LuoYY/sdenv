#!/usr/bin/env node
// 9 瑞数站全貌扫描: HTTP指纹 + TLS证书 + RS结构 + SLB识别
const { execSync } = require('child_process');
const { FP } = require('../../browser/chrome/fingerprint');
const sites = [
  { name: '新疆', url: 'https://pmos.xj.sgcc.com.cn:20080/' },
  { name: '福建', url: 'https://pmos.fj.sgcc.com.cn' },
  { name: '湖北', url: 'https://newpmos.hb.sgcc.com.cn' },
  { name: '河南', url: 'https://pmos.ha.sgcc.com.cn' },
  { name: '陕西', url: 'https://pmos.sn.sgcc.com.cn' },
  { name: '冀北', url: 'https://pmos.jibei.sgcc.com.cn' },
  { name: '四川', url: 'https://pmos.sc.sgcc.com.cn/' },
  { name: '安徽', url: 'https://pmos.ah.sgcc.com.cn:20080' },
  { name: '宁夏', url: 'https://pmos.nx.sgcc.com.cn:10443' },
];
const UA = FP.ua;
const { ProxyAgent } = require('undici');

async function scanSite(s, proxy) {
  const row = { name: s.name, url: s.url };
  try {
    const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
    const res = await fetch(s.url, {
      headers: { 'user-agent': UA },
      dispatcher,
      signal: AbortSignal.timeout(25000),
    });
    row.code = res.status;
    row.server = res.headers.get('server') || '';
    row.cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map(c => c.split('=')[0]);
    const text = await res.text();
    row.rsLayers = (text.match(/\$_ts\.nsd/g) || []).length;
    row.rsScripts = [...text.matchAll(/src="(\/[A-Za-z0-9]+\/[A-Za-z0-9.]+\.js)"/g)].map(m => m[1]);
    row.title = (text.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    row.bodyKB = Math.round(text.length / 1024);
    row.slb = row.cookies.some(c => /persist|BIGip|Alteon|JSession/i.test(c)) ? 'SLB-cookie' : '';
  } catch (e) {
    row.code = 'ERR:' + String(e.cause ? e.cause.code || e.cause.message : e.message).slice(0, 30);
  }
  // TLS
  try {
    const u = new URL(s.url);
    const cert = execSync(
      `echo | openssl s_client -connect ${u.hostname}:${u.port || 443} -servername ${u.hostname} 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 }
    );
    row.tls = cert.replace(/\n/g, '; ').replace(/subject=/i, 'S:').replace(/issuer=/i, 'I:').replace(/notBefore=/i, '从').replace(/notAfter=/i, '到');
  } catch (e) { row.tls = ''; }
  return row;
}

(async () => {
  const proxy = process.env.proxy;
  for (const s of sites) {
    const r = await scanSite(s, proxy && (s.name === '安徽' || s.name === '宁夏') ? proxy : undefined);
    console.log(JSON.stringify(r));
  }
})();
