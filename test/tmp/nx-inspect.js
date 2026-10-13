#!/usr/bin/env node
// Inspector 抓 VMP 异常现场: 拉起离线装置(--inspect-brk), CDP setPauseOnExceptions:all,
// 记录所有异常(含被catch的)消息+顶层帧位置+源码片段, 时间线与cookie写对齐
// 用法: node test/tmp/nx-inspect.js
const { spawn } = require('child_process');
const PORT = 9233;
const MAX_PAUSES = 400;

const child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:' + PORT, 'test/tmp/nx-offline.js', 'run'], {
  cwd: __dirname + '/../..',
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => process.stdout.write('[child] ' + d));
child.stderr.on('data', d => { const s = String(d); if (!s.includes('Debugger listening') && !s.includes('For help')) process.stdout.write('[child-err] ' + s); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      wsUrl = (await res.json()).find(t => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch (e) {}
    await sleep(300);
  }
  if (!wsUrl) throw new Error('inspector 未就绪');
  console.log('[drv] 已连接 inspector');

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    } else onEvent(msg);
  };

  const scripts = new Map();
  let pauses = 0, skipped = 0;
  const started = Date.now();
  let collecting = true;

  async function onEvent(msg) {
    if (msg.method === 'Debugger.scriptParsed') {
      scripts.set(msg.params.scriptId, { url: msg.params.url, src: null });
    }
    if (msg.method === 'Debugger.paused' && collecting) {
      const p = msg.params;
      // 只记录真异常; VMP的debugger;反调试语句(reason=other)静默跳过(避免污染其计时检测)
      if (p.reason !== 'exception') {
        skipped++;
        ws.send(JSON.stringify({ id: ++id, method: 'Debugger.resume' }));
        return;
      }
      const t = ((Date.now() - started) / 1000).toFixed(2);
      pauses++;
      try {
        let line = `[${t}s #${pauses}] ${p.reason}`;
        const exc = p.data || p.exception;
        const desc = (exc && exc.description) ? exc.description.split('\n')[0] : (p.text || '');
        line += ' | ' + desc.slice(0, 160);
        const top = p.callFrames[0];
        if (top) {
          const s = await getSource(top.location.scriptId);
          line += `\n    at ${s.url || '(vm)'}:${top.location.lineNumber + 1}:${top.location.columnNumber + 1}(${(s.src || '').length}B)`;
          const snip = snippet(s, top.location);
          if (snip) line += '\n    src: ' + snip;
          // vm内异常: 从消息提取标识符, 沿调用栈逐帧求值直到拿到非undefined结果
          if ((s.url || '') === '' && top.callFrameId) {
            const ident = (desc.match(/([A-Za-z_$][\w$]*) is not a (constructor|function)/) || [])[1];
            if (ident) {
              for (let fi = 0; fi < Math.min(p.callFrames.length, 6); fi++) {
                const fr = p.callFrames[fi];
                if (!fr.callFrameId) continue;
                try {
                  const r = await send('Debugger.evaluateOnCallFrame', {
                    callFrameId: fr.callFrameId,
                    expression: `(function(){try{var v=${ident};if(v===undefined)return '';var t=typeof v;var extra='';if(t==='object'&&v){var p=Object.getPrototypeOf(v);extra='ctor='+(p&&p.constructor&&p.constructor.name)+' proto1='+(p&&Object.keys(p).slice(0,8).join(','))+' keys='+Object.keys(v).slice(0,15).join(',')}else if(t==='function'){extra='name='+(v.name||'')+' src='+Function.prototype.toString.call(v).slice(0,120)}return '帧'+${fi}+': '+t+' '+extra}catch(e){return ''}})()`,
                    returnByValue: true,
                  });
                  if (r && r.result && r.result.value) { line += `\n    >>> ${ident} = ${String(r.result.value).slice(0, 240)}`; break; }
                } catch (e) {}
              }
            }
          }
        }
        console.log(line);
      } catch (e) { console.log(`[${t}s #${pauses}] (帧解析失败: ${e.message})`); }
      ws.send(JSON.stringify({ id: ++id, method: 'Debugger.resume' }));
      if (pauses >= MAX_PAUSES) { collecting = false; console.log('[drv] 达到记录上限'); }
    }
  }
  async function getSource(scriptId) {
    const rec = scripts.get(scriptId) || { url: '?', src: '' };
    if (!rec.src) { try { rec.src = (await send('Debugger.getScriptSource', { scriptId })).scriptSource; } catch (e) { rec.src = ''; } }
    return rec;
  }
  function snippet(s, loc) {
    try {
      const L = (s.src.split('\n')[loc.lineNumber] || '');
      return L.slice(Math.max(0, loc.columnNumber - 60), loc.columnNumber + 140).replace(/\s+/g, ' ').slice(0, 220);
    } catch (e) { return ''; }
  }

  await send('Runtime.enable');
  await send('Debugger.enable');
  await send('Debugger.setPauseOnExceptions', { state: 'all' });
  console.log('[drv] setPauseOnExceptions=all, 放行启动断点');
  try { await send('Runtime.runIfWaitingForDebugger'); } catch (e) { try { await send('Debugger.resume'); } catch (e2) {} }

  setTimeout(async () => {
    collecting = false;
    console.log(`[drv] 采集结束, 真异常${pauses}次(debugger语句跳过${skipped}次)`);
    try { await send('Debugger.setPauseOnExceptions', { state: 'none' }); } catch (e) {}
    child.kill('SIGTERM');
    process.exit(0);
  }, 25000);
}
main().catch(e => { console.error('[drv] ERR:', e.message); child.kill(); process.exit(1); });
