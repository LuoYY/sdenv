// 本地集成验证: impersonate.request 单测 + jsdom(SDENV_IMPERSONATE=1) 端到端, 零外网
// 覆盖: 重定向跟随、gzip 解压、多跳 Set-Cookie、Buffer body、fromURL 接口、导航/子资源请求头分流
process.env.SDENV_IMPERSONATE = '1';
const http = require('http');
const zlib = require('zlib');
try { require('module-alias')(require('../../utils/paths').basePath) } catch (err) {};

const HTML = '<html><head><script src="/sub.js"></script></head><body><h1>PAGE</h1></body></html>';
const PORT = 18345;
const seen = {}; // 服务端视角记录每个路径收到的请求头

const server = http.createServer((req, res) => {
  seen[req.url] = req.headers;
  if (req.url === '/redir302') {
    res.writeHead(302, { location: '/page', 'set-cookie': 'hop1=xyz; Path=/' });
    res.end();
  } else if (req.url === '/page') {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'set-cookie': 'page=pv1; Path=/' });
    res.end(zlib.gzipSync(Buffer.from(HTML)));
  } else if (req.url === '/sub.js') {
    res.writeHead(200, { 'content-type': 'application/javascript', 'set-cookie': 'sub=sv2; Path=/' });
    res.end('window.__SUB_LOADED = true; document.title = "SUB_OK";');
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  let fail = 0;
  const check = (label, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ' | ' + detail : ''}`);
    if (!ok) fail = 1;
  };
  try {
    // 1. 单测: 重定向 + gzip 解压 + 双跳 Set-Cookie 收集
    const impersonate = require('sdenv/utils/impersonate');
    const r = await impersonate.request(`http://127.0.0.1:${PORT}/redir302`);
    check('单测 status=200(末次)', r.status === 200, `status=${r.status}`);
    check('单测 两跳Set-Cookie均收集', r.setCookies.includes('hop1=xyz') && r.setCookies.includes('page=pv1'), r.setCookies.join(','));
    check('单测 gzip已解压', r.body.toString() === HTML, r.body.toString().slice(0, 30));
    check('单测 body是Buffer', Buffer.isBuffer(r.body));
    const nav0 = seen['/page'];
    check('单测 导航头: dest/mode/user/uir齐全', ['document', 'navigate', '?1', '1'].every((v, i) =>
      [nav0['sec-fetch-dest'], nav0['sec-fetch-mode'], nav0['sec-fetch-user'], nav0['upgrade-insecure-requests']][i] === v));
    check('单测 导航头: accept为Chrome完整版(含image/avif)', (nav0.accept || '').includes('image/avif'), nav0.accept);
    check('单测 导航头: accept-encoding与Chrome144一致', nav0['accept-encoding'] === 'gzip, deflate, br, zstd', nav0['accept-encoding']);

    // 2. E2E: jsdomFromUrl 走 impersonate 出口(主文档302->gzip + 子资源script + cookie入jar)
    const { jsdomFromUrl } = require('sdenv');
    const dom = await jsdomFromUrl(`http://127.0.0.1:${PORT}/redir302`, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      consoleConfig: { error: new Function },
    });
    setTimeout(() => {
      const cookies = dom.cookieJar.getCookieStringSync(`http://127.0.0.1:${PORT}/`);
      check('E2E 主文档加载+gzip解压', dom.window.document.body && /PAGE/.test(dom.window.document.body.textContent || ''));
      check('E2E 重定向后文档URL正确(req.href)', dom.window.location.href === `http://127.0.0.1:${PORT}/page`, dom.window.location.href);
      check('E2E 子资源script经impersonate加载并执行', dom.window.__SUB_LOADED === true && dom.window.document.title === 'SUB_OK');
      check('E2E 三枚cookie均入jar', ['hop1=xyz', 'page=pv1', 'sub=sv2'].every(c => cookies.includes(c)), cookies);
      const sub = seen['/sub.js'];
      check('E2E 子资源头: dest=script/mode=no-cors/site=same-origin',
        sub['sec-fetch-dest'] === 'script' && sub['sec-fetch-mode'] === 'no-cors' && sub['sec-fetch-site'] === 'same-origin',
        `${sub['sec-fetch-dest']}/${sub['sec-fetch-mode']}/${sub['sec-fetch-site']}`);
      check('E2E 子资源头: 无导航专用头(uir/sec-fetch-user)', sub['upgrade-insecure-requests'] === undefined && sub['sec-fetch-user'] === undefined);
      check('E2E 子资源头: accept=*/*、referer为页面URL', sub.accept === '*/*' && sub.referer === `http://127.0.0.1:${PORT}/page`, `${sub.accept} <- ${sub.referer}`);
      check('E2E 子资源头: accept-encoding与Chrome144一致', sub['accept-encoding'] === 'gzip, deflate, br, zstd', sub['accept-encoding']);
      console.log(fail === 0 ? '\n全部通过' : '\n存在失败项');
      server.close(() => process.exit(fail));
    }, 1500);
  } catch (e) {
    console.error('ERR:', e && e.stack || e);
    server.close(() => process.exit(1));
  }
});
