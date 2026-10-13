# 国网电力交易平台瑞数适配完整方案

> 2026-09 攻坚成果。上游 sdenv 已停维护，本方案为自研适配。
> 目标：IoT 设备（无浏览器）通过 cookie 网关访问瑞数防护的国网电力交易平台。
> 2026-10 增补 TLS/HTTP 出口层（curl-impersonate，指纹统一 Chrome 144/Win10），详见 [TLS-FINGERPRINT-PLAN.md](./TLS-FINGERPRINT-PLAN.md)。

## 一、结论总览

对 28 个省/区域站点的全量摸排与验证（2026-09-18 ~ 2026-09-21）：

### 分组结果

| 分组 | 数量 | 站点 |
|------|------|------|
| **瑞数站（sdenv 可用）** | 8 | 新疆、福建、湖北、河南、陕西、冀北、四川（双瑞数）、安徽（需代理） |
| 瑞数站（环境已过，出口受阻） | 1 | 宁夏（WAF 拦代理段，24-48h 窗口期复测） |
| 无瑞数（直连即可） | 15 | 吉林、辽宁、蒙东、首都、山西、上海、湖南、江西、北京、青海、浙江、重庆、黑龙江、河北、山东 |
| 站点自身故障 | 1 | 甘肃（502 HTTPS 卸载配置错误，与瑞数无关） |
| 网络不可达（需内网） | 3 | 天津、江苏、西藏 |

### 验证判据（严格）

**不是看 200/标题**——这些站无 cookie 也返回 200 带标题。权威判据：

> 带生成的动态 cookie（...P）二次请求，**服务端不再 Set-Cookie 重发瑞数挑战 cookie（...O/...P）**。
> SLB 类 cookie（AlteonP、cookie_persist、BIGipServer）重发不算失败。

```bash
# 一键验证全部直连站
node example/use-check/verify-all.js
# 需代理的站（安徽/宁夏）
proxy="http://user:pass@ip:port" node example/use-check/verify-proxy.js
```

## 二、9 个瑞数站配置

见 `example/use-check/rs-sites.json`（verify-all.js 的数据源）。关键差异：

| 站点 | 瑞数层数 | 动态 cookie | 备注 |
|------|---------|------------|------|
| 新疆 pmos.xj.sgcc.com.cn:20080 | 1 | CyFIZHvBqps2P | |
| 福建 pmos.fj.sgcc.com.cn | 1 | OsRHYuEzHQgBP | |
| 湖北 newpmos.hb.sgcc.com.cn | 1 | TsU0fa3o3m18P | |
| 河南 pmos.ha.sgcc.com.cn | 1 | nNp645dDHuIXP | |
| 陕西 pmos.sn.sgcc.com.cn | 1 | REg0WU8vqCaDP | |
| 冀北 pmos.jibei.sgcc.com.cn | 1 | sC0HezowWBq0P | 首包 200 带 RS（非 412），首层多一个 `enable_xxx` cookie |
| **四川 pmos.sc.sgcc.com.cn** | **2** | PLOb9dbGTCt1P + RP2kXhpV57gmT | 两层 VMP 串行（inline1→ext1→inline2→ext2），共用 `$_ts` 全局 |
| 安徽 pmos.ah.sgcc.com.cn:20080 | 1 | aRzUAYpFuoMPP | 需代理访问 |
| 宁夏 pmos.nx.sgcc.com.cn:10443 | 1 | 3RKyaeh47p9P | 需代理；当前 WAF 拦截所有代理段 |

注意：瑞数 cookie 名（`xxxO`/`xxxP`）按站点固定，但若站点重新部署会变化——verify-all.js 报"超时(P cookie未生成)"时先 curl 首包确认 cookie 名，更新 rs-sites.json。

## 三、代码修改清单

### 仓库结构

```
rs-alltool/
├── sdenv/            # 主仓（fork 自 pysunday/sdenv v1.1.3）
├── sdenv-jsdom/      # clone，软链入 sdenv/node_modules（lib 已含 generated/ 产物）
├── sdenv-extend/     # clone，软链入 sdenv/node_modules（改 src 后需 npm run build）
└── sdenv-extract/    # （未使用）
```

### 修改 1：sdenv/browser/chrome/window.js（load 回调闭包化）

```diff
- } while (window.sdenv.memory.timeout?.index.filter(...).length || --mintime > 0);
+ } while (sdenv.memory.timeout?.index.filter(...).length || --mintime > 0);
```

原因：运行时读 `window.sdenv` 会在删除/隐藏该全局后崩溃，也暴露框架特征。

### 修改 2：sdenv-extend/src/handle/window.js（gOPD 泄漏修复）★关键

```diff
 getOwnPropertyDescriptor(target, prop) {
   ...
+  if (config.windowGetterUndefinedKeys.includes(prop)) {
+    return undefined;
+  }
```

原因：`get`/`has`/`ownKeys` 三个 trap 都过滤了 undefinedKeys，唯独 `getOwnPropertyDescriptor` 没过滤。VMP 用 `Object.getOwnPropertyDescriptor(window, '_runScripts')` 探测时拿到真实描述符，全部隐藏形同虚设。这是冀北/四川一度无法通过的主因。

### 修改 3：sdenv/browser/chrome/fingerprint.js（新文件）指纹对齐

**2026-10-12 更新**：已重构为 Chrome 144 / Windows 10 单一来源——`FP` 数据对象（UA/sec-ch-ua/screen/window/导航头 `headers`/子资源头 `subHeaders`）+ 环境注入函数双导出，全仓脚本与 impersonate 出口统一引用，原 Mac 采集值废弃。

原始版本（2026-09）用真实浏览器采集值覆盖：
- `screen`：0x0 → 2056x1329（availHeight 1226, colorDepth/pixelDepth 30）
- `navigator.languages`：en-US/en → zh-CN/zh-Hans-CN；`language`、`deviceMemory=32`、`hardwareConcurrency=18`、`pdfViewerEnabled=true`
- `window`：devicePixelRatio=2、innerWidth/Height 723/1019、outerWidth/Height、screenX/Y

### 修改 4：sdenv/browser/chrome/HTMLCanvasElement.js（新文件，当前注释禁用）

- `toDataURL` 返回真实浏览器完整指纹（15266B，`fingerprint/canvas-fp.txt`，采集自 280x60 标准指纹画布）
- `getContext('webgl')` 返回最小 WebGL stub（UNMASKED_VENDOR/RENDERER 返回 Chrome/ANGLE 真实值）

**状态：当前注释禁用**（`browser/chrome/index.js` 中该行被注释）。实测四川通过不需要它——jsdom 无 canvas 时 `getContext` 返回 null 的行为与部分真实环境一致，且 fingerprint.js 已覆盖非 canvas 指纹项。保留备用：若瑞数升级开始严格校验 canvas 哈希，取消注释即可。

### 修改 5：sdenv-extend 其它两个文件的既有 patch（clone 时已带）

- `evalHandle.js`：`SDENV_KEEP_EVAL=1` 环境变量可跳过 eval 拦截（setFuncNative 触发瑞数 Date.toString 跨 realm 判型异常）
- `dateAndRandomHandle.js`：`self._valueOf` 替代 `sdenv.memory.Date.prototype.valueOf`

**改 sdenv-extend/src 后必须重建**：`cd sdenv-extend && npm run build`（主入口是 build/sdenv-extend-cjs.js）。

### 修改 6：TLS/HTTP 出口（2026-10 增补）

- 出口：`SDENV_IMPERSONATE=1` 时 jsdom 所有 http(s) 请求（含 fromURL 首包与外链 JS）经 curl-impersonate（`curl_chrome142` wrapper，Chrome TLS/h2 指纹），verify-all/verify-proxy 二次请求与 site-scan 探测同出口，Node 进程不再对目标站裸 TLS 出网
- 请求头分流：导航用 `FP.headers`（Chrome144 完整导航头），子资源用 `FP.subHeaders` 并按 `element` 推断 `sec-fetch-dest/mode/site`；`--impersonate` 预置的导航专用头在子资源请求已用 `-H 'name:'` 清除
- 本地回归：`test/tmp/imp-e2e.js`（127.0.0.1 零外网，15 项断言含请求头）；JA4 对比与残留差异记录见 [TLS-FINGERPRINT-PLAN.md](./TLS-FINGERPRINT-PLAN.md)

## 四、运行配置（攻克瑞数站的完整参数）

```javascript
const { jsdomFromUrl } = require('sdenv');

const INTERNAL_KEYS = [ /* 29 个隐藏键，见下 */ ];
// '_commonForOrigin','_currentEvent','_currentOriginData','_document','_eventHandlers',
// '_frameElement','_getEventHandlerFor','_getEventHandlerTarget','_globalEventChanged','_globalProxy',
// '_initGlobalEvents','_length','_localStorage','_origin','_parent','_pretendToBeVisual',
// '_proxyWindowEventsToWindow','_registeredHandlers','_resourceLoader','_runScripts','_sdGlobalObject',
// '_selection','_sessionHistory','_sessionStorage','_setEventHandlerFor','_storageQuota','_top',
// '_virtualConsole','sdenv'

const dom = await jsdomFromUrl(url, {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  proxy, // 可选
  windowProxyConfig: {
    // Node 全局对 VMP 抛 ReferenceError（真实浏览器行为）
    windowGetterErrorKeys: ['process','global','require','module','__dirname','__filename','Buffer'],
    // 隐藏 sdenv + jsdom 内部属性
    windowGetterUndefinedKeys: INTERNAL_KEYS,
  },
  consoleConfig: { error: new Function }, // 静默 jsdomError
  beforeParse: (window, sdenv) => {
    sdenv.getHandle('battery')('charging_success'); // navigator.getBattery 检测
    sdenv.getHandle('dateAndRandom')({});           // 固定 Date/Math.random
  },
});
// 等 cookieJar 中目标 P cookie 出现（通常 2-30s）即得可用 cookie
```

要点：
- `windowProxyConfig` 必须作为**顶层参数**传（utils/jsdom.js 在 beforeParse 之前就用它初始化 window 代理，在 beforeParse 里用 getConfig('window') 配置为时已晚）
- UA 全程一致（生成与二次请求）
- battery/dateAndRandom 默认不启用，必须手动注册

## 五、探测到的瑞数检测点（按发现顺序）

| # | 检测项 | 站点 | 对策 |
|---|--------|------|------|
| 1 | `navigator.getBattery` 缺失 | 四川 | battery handle |
| 2 | Node 全局 `process` 等 | 通用 | windowGetterErrorKeys |
| 3 | 内部构造器 `X is not a constructor`（URL 解析类） | 四川 | dateAndRandom handle |
| 4 | **`window.sdenv` 框架全局名** | 冀北/四川 | undefinedKeys 隐藏 + gOPD 修复 |
| 5 | **`getOwnPropertyDescriptor` 旁路探测内部属性** | 冀北/四川 | gOPD trap 过滤（修改 2） |
| 6 | jsdom 29 个 `_xxx` 内部属性 | 冀北/四川 | undefinedKeys 隐藏 |
| 7 | screen/languages/deviceMemory 等指纹值 | 四川 | fingerprint.js |
| 8 | canvas/WebGL 指纹 | 四川二层 | jsdom 无 canvas 的 null 行为可过；严格校验时启用 HTMLCanvasElement.js |
| 9 | TLS/HTTP 层指纹（JA4 非 Chrome、HTTP/1.1）与 Chrome UA 矛盾 | 宁夏/河南（拉黑推断） | curl-impersonate 出口（修改 6） |

定位方法论（可复用于新检测项）：
- **属性访问 diff**：`example/use-check/prop-diff.js` 对比通过站/挂起站的 VMP window get 序列（冀北曾在 `Object` 上死循环 2467 次、第 18 步扫到 `sdenv`）
- **cookie 时间线**：`example/use-check/sc-watch.js` 观察动态 cookie 生成时序与 jsdomError
- **Inspector 协议**：`setPauseOnExceptions: all` + evaluateOnCallFrame 抓 TypeError 现场变量（VMP 每请求重新混淆，静态列号分析无效）

## 六、IoT cookie 网关部署建议

```
IoT设备(纯HTTP) ──► cookie网关(sdenv, Node 22+) ──► 9个瑞数站
                     │
                     ├─ cookie池: 每站预生成N份, TTL刷新(动态cookie约7天有效期, 建议按天轮换)
                     ├─ 412/挑战检测: 响应重发O cookie即触发重新生成
                     └─ 出口: 安徽需代理; 宁夏待窗口期; 其余直连
```

- 判定 cookie 失效：二次请求响应头出现瑞数 `Set-Cookie: xxxO=` → 该 cookie 作废重生
- 网关固定 UA 与 cookie 生成时一致
- 并发：cookie 按站共享（UA 一致即可），无需每请求一份
- 生产环境勿装 `canvas` npm 包（当前通过不依赖它）

## 七、已知坑

1. **软链杀手**：在 `sdenv/` 目录跑 `npm install/uninstall` 会把 `node_modules/sdenv-jsdom`、`sdenv-extend` 的软链**替换成目录拷贝**，源码修改全部静默失效（症状：莫名全站超时）。修复：删掉两个目录重建软链。依赖操作一律去 clone 仓库里执行。
2. 判据陷阱：所有站无 cookie 也返回 200+标题，"能打开"≠通过。
3. 瑞数 VMP 每次请求重新生成（nsd 变化），混淆变量名不同属正常，勿按变量名定位问题。
4. `example/use-check/` 下其余脚本是攻坚期调试工具（double-rs/sc-matrix/sweep-probe 等），日常巡检只需 verify-all.js / verify-proxy.js。
5. 代理账号有并发/时长限制；机房 IP 段（222.75.x、110.18.x、36.212.x、61.159.x）会被宁夏站 WAF 首次即拦并拉黑。

## 八、验证记录

- 2026-09-21 终验（严格判据）：新疆/福建/湖北/河南/陕西/冀北/四川 直连全过；安徽经山东电信代理过；宁夏代理段全拦（环境层 09-18 已验证通过）。
- 回归基线：河南/新疆在每次修改后均复测通过。
