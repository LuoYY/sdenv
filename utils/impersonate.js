/*
 * curl-impersonate 出口: 所有对外 HTTP 请求走 Chrome TLS/h2 指纹
 * 用法: node xxx.js (内置函数) 或 CLI: node impersonate.js <url> [cookie]
 * jsdom ResourceLoader 集成见 utils/impersonate-loader.js
 *
 * 头/体拆分: curl 经 -D/-o 分别落两个临时文件, 避免从 stdout 字符串拆分造成 body 有损;
 * 重定向: -L 跟随, -D 文件含全部跳次的响应头, set-cookie 逐跳收集, 状态码取末次(-w);
 * 压缩: wrapper(curl_chrome142) 自带 --compressed, 自动发送 Chrome 同款
 *   Accept-Encoding(gzip, deflate, br, zstd) 并解压响应, 故 FP.headers 不手动设置该项
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FP } = require('../browser/chrome/fingerprint');

const CURL_BIN = process.env.CURL_IMPERSONATE || 'curl_chrome142';

function buildArgs(url, { headers = {}, proxy, method = 'GET', body } = {}) {
  const args = ['-s', '--max-time', '30', '-L', '--compressed'];
  if (proxy) args.push('-x', proxy);
  if (method !== 'GET') args.push('-X', method);
  if (body) args.push('--data-binary', body);
  // FP.headers 是导航场景默认头, 调用方可覆盖
  const merged = { ...FP.headers, ...headers };
  for (const [k, v] of Object.entries(merged)) args.push('-H', `${k}: ${v}`);
  args.push(url);
  return args;
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdenv-imp-'));
    const headerFile = path.join(dir, 'h.txt');
    const bodyFile = path.join(dir, 'b.bin');
    // -w 依次输出末次状态码与最终URL(-L 跟随后的落点), 换行分隔
    const args = [...buildArgs(url, opts), '-D', headerFile, '-o', bodyFile, '-w', '%{response_code}\n%{url_effective}'];
    execFile(CURL_BIN, args, { maxBuffer: 1024 * 1024, timeout: 35000 }, (err, stdout) => {
      const finish = (fn, val) => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
        fn(val);
      };
      const [statusLine, ...hrefLines] = String(stdout || '').split('\n');
      const status = parseInt((statusLine || '').trim(), 10) || 0;
      if (err && !status) return finish(reject, err);
      try {
        const href = hrefLines.join('\n').trim() || url;
        const headerRaw = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, 'utf8') : '';
        // 代理 CONNECT 响应头也会进 -D 文件, 按块剔除
        const blocks = headerRaw.split(/\r?\n\r?\n/).filter(b => b.trim() && !/Connection established/i.test(b));
        const setCookies = [];
        for (const b of blocks) {
          for (const m of b.matchAll(/^set-cookie: ?(.+)$/gim)) setCookies.push(m[1].split(';')[0]);
        }
        // 末次响应头解析为小写映射(fromURL 需读 content-type)
        const headerMap = {};
        for (const line of (blocks[blocks.length - 1] || '').split(/\r?\n/)) {
          const m = line.match(/^([^:]+):\s*(.*)$/);
          if (m && m[1].toLowerCase() !== 'set-cookie') headerMap[m[1].toLowerCase()] = m[2].trim();
        }
        const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile) : Buffer.alloc(0);
        finish(resolve, { status, href, headers: blocks[blocks.length - 1] || '', headerMap, setCookies, body });
      } catch (e) {
        finish(reject, e);
      }
    });
  });
}

module.exports = { request, CURL_BIN };

// CLI: node utils/impersonate.js <url> [--proxy http://...] [--cookie "..."]
if (require.main === module) {
  const url = process.argv[2];
  const proxyIdx = process.argv.indexOf('--proxy');
  const cookieIdx = process.argv.indexOf('--cookie');
  request(url, {
    proxy: proxyIdx > -1 ? process.argv[proxyIdx + 1] : process.env.proxy,
    headers: cookieIdx > -1 ? { cookie: process.argv[cookieIdx + 1] } : {},
  }).then(r => {
    console.log('status:', r.status);
    console.log('set-cookie:', r.setCookies.join(' | ') || '无');
    console.log('body长度:', r.body.length, r.body.includes('$_ts') ? '(含RS挑战)' : '');
  }).catch(e => { console.error('ERR:', e.message); process.exit(1); });
}
