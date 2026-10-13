# TLS/HTTP 指纹伪装方案（三层指纹全对齐）

> 2026-10-12 定稿。前置结论：JS 层指纹（canvas/navigator）已对齐，但 TLS/HTTP 层裸奔是 WAF 拉黑主因。
> 工具选型：lexiforest/curl-impersonate v2.2.3（已安装），后续演进 Go utls 网关。

## 一、问题：三层指纹只做了一层

实测对比（JA4 指纹，2026-10-12）：

| 客户端 | JA4 | HTTP | 结论 |
|--------|-----|------|------|
| 真实 Chrome | `t13d1516h2_8daaf...` | h2 | 基准 |
| Node/undici（sdenv 现状） | `t13d5212h1_b262b...` | **HTTP/1.1** | ❌ 一眼非浏览器（52 cipher、无 h2） |
| curl（探测脚本现状） | `t13d497h2_0d8fe...` | h2 | ❌ 已知工具特征（49 cipher） |
| curl-impersonate chrome142 | `t13d1516h2_8daaf6152771_...` | h2 | ✅ 与 Chrome 前两段完全一致 |

被封机制推断（解释了宁夏/河南的所有现象）：
1. WAF 看 TLS 指纹与 UA 矛盾（Chrome UA + Node TLS）→ 标记可疑
2. 瑞数挑战正常下发（WAF 先放行观察），JS 层我们过得去
3. 几次完整流程后，速率 + 矛盾指纹 → IP 拉黑（403"安全威胁"页 → 连接黑洞）

## 二、统一指纹规格：Chrome 144 / Windows 10

**单一来源**：`sdenv/browser/chrome/fingerprint.js` 的 `FP` 对象（已实现）。全站统一：

| 项 | 值 |
|----|-----|
| UA | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36`（网站官方推荐版本） |
| sec-ch-ua | `"Chromium";v="144", "Google Chrome";v="144", "Not?A_Brand";v="99"` |
| sec-ch-ua-platform | `"Windows"`；sec-ch-ua-mobile: `?0` |
| accept / accept-language | `text/html,...` / `zh-CN,zh;q=0.9` |
| sec-fetch-* | document / navigate / none / ?1 |
| navigator | platform=Win32、hardwareConcurrency=8、deviceMemory=8、languages=[zh-CN,zh] |
| screen/window | 1920x1080(24bit)、dpr=1、inner 1536x746 |

**版本配套说明**：curl-impersonate 无 chrome144 目标，用 `chrome142`（TLS 栈相同——Chrome 116+ 的 Chromium 系 ClientHello 除 GREASE 随机外一致），再以 `-H` 覆盖 UA/sec-ch-ua 为 144。JA4 的 GREASE 部分（第三段）本就随机，不影响。

## 三、出口架构：curl-impersonate 接管全部对站请求

```
┌─ sdenv(jsdom) ── 生成cookie ──┐
│   ResourceLoader 拉页面/外链JS │  SDENV_IMPERSONATE=1
│   (不再用 Node TLS 出网)       │
└──────────┬────────────────────┘
           ▼ 全部经 curl-impersonate chrome142 (Chrome TLS/h2 + 144 头)
   目标站（9 瑞数站）
           ▲
   二次验证/业务请求 同一出口、同 UA、同 sec-ch-ua
```

**原则：Node 进程不对目标站发任何裸 TLS 请求**（包括 curl 探测脚本，全部换 curl-impersonate）。

## 四、代码改动清单

| 文件 | 状态 | 内容 |
|------|------|------|
| `browser/chrome/fingerprint.js` | ✅ 已改 | 重构为单一来源：FP 数据对象 + 环境注入函数双导出；UA 144/Win、sec-ch-ua 头、Win 指纹全套；新增 `FP.subHeaders`（子资源身份头基线） |
| `browser/chrome/navigator.js` | ✅ 已改 | userAgent/appVersion/platform 改引 `FP`（消除 131/Mac 旧值） |
| `utils/impersonate.js` | ✅ 新建 | curl-impersonate 封装：默认 `curl_chrome142`（wrapper 自带 `--compressed`/`--impersonate`，实测 Accept-Encoding 与 Chrome144 逐字一致）、`-L` 重定向、头/体临时文件无损拆分、body 为 Buffer、全跳次 Set-Cookie 收集、`href`/`headerMap` 返回、`mode: navigate/sub` 请求头分流（sub 模式用 `-H 'name:'` 清除预设导航头） |
| `sdenv-jsdom/.../resource-loader.js` | ✅ 已改 | `SDENV_IMPERSONATE=1` 且 `global.__sdenvImpersonate` 存在时 jsdom 拉资源走 impersonate（含 cookie 进出）；补齐 fromURL 依赖的 `response`/`href`/`getHeader` 接口；导航/子资源分流——子资源按 `element` 推断 `sec-fetch-dest/mode/site`（site 按 referrer 同源启发式） |
| `sdenv/index.js` | ✅ 已改 | SDENV_IMPERSONATE=1 时挂 `global.__sdenvImpersonate` |
| `example/use-check/*.js` 全部 | ✅ 已改 | 14 脚本 UA 切 `FP.ua`；verify-all/verify-proxy 二次请求、site-scan 探测全走 impersonate（零裸 TLS） |
| `example/use-remote/{passive,active}.js` | ✅ 已改 | 示例 UA 切 `FP.ua` |
| `test/tmp/imp-e2e.js` | ✅ 新建 | 本地回归（127.0.0.1 零外网）：重定向/gzip/多跳 Set-Cookie/Buffer/fromURL 接口/导航与子资源请求头，15 项断言 |
| `docs/RS-BYPASS-SOLUTION.md` | ✅ 已更新 | 指纹小节补充 TLS 层与 Chrome144 单一来源 |

## 五、验证结果与待办

已验证（均零外网，本地 localhost）：
- chrome142 JA4 = 真实 Chrome 前两段 ✅（tls.peet.ws 实测；注意 JA4 第三段确定性，116≠142，故默认 chrome142）
- navigator/UA/头三层同源 144 ✅（单测）
- wrapper `--compressed` 自动发送 `Accept-Encoding: gzip, deflate, br, zstd` 与 Chrome144 逐字一致，gzip/br 自动解压 ✅
- 导航请求头全套（dest=document/mode=navigate/user=?1/uir=1/accept 完整版）✅
- 子资源请求头（dest=script/mode=no-cors/site=same-origin、accept=\*/\*、referer、无导航专用头）✅，`--impersonate` 预置导航头已清除 ✅
- jsdom 全链路（302→gzip 主文档、script 子资源、三枚 cookie 入 jar、重定向后 URL）✅（`test/tmp/imp-e2e.js`）
- impersonate CLI 拉四川首包正常（200 + 4 cookie + RS 挑战）✅（2026-10-12 早前实测）

待验证（需目标站配合，注意节奏防拉黑）：
1. ~~四川全链路~~ ✅ 2026-10-12 九站 A/B 归因测试（`test/tmp/rs8-loop.js`，SDENV_IMPERSONATE=1 全链路）：**8 站二次请求均 200**（全导航头 A 与最小头 B 均通过、无挑战重发）——整套 TLS/指纹/请求头改动未破坏 cookie；唯宁夏 400
2. ~~宁夏闭环~~ ✅ 2026-10-12：P cookie 2-4s 生成（cookie 名已变 `3RKyaeh47p90P`），二次请求无挑战重发但状态 400，且 **A 全导航头/B 最小头均 400**——排除请求头因素，指向 cookie 内容（nx VMP 调 4 次 canvas getContext）或站点新部署的额外校验；后续：抓 400 body 分析、必要时启用 canvas 桩（RS 方案修改 4 预案）
3. 压测节奏：同一 IP 对单站完整流程 ≤2 次/小时（从宁夏经验反推，未实测阈值）

附带发现（2026-10-12）：**河南对本机直连 IP 已 TCP 黑洞**（单 GET 连接超时，代理出口 412 正常）——9 月攻坚遗留的 IP 级拉黑，cookie 网关部署时河南必须走代理。

已知残留差异（低风险记录在案）：
- plain HTTP 目标会带 `Upgrade: h2c`/`HTTP2-Settings` 头（curl h2 升级机制，真实 Chrome 不发）——9 站全为 HTTPS，h2 走 ALPN 不受影响
- jsdom 的 XHR（living/xhr）不经 ResourceLoader，页面内 XHR 仍走 Node TLS——当前 9 站 cookie 生成链路不涉及，若后续站点需要 XHR 出网需另行接管

## 六、后续演进：Go utls 网关

IoT 采集端是 Go，终态架构：

```
IoT设备(Go) ──► 本机 utls+Chrome144指纹 HTTP客户端 ──► 瑞数站
                     │ cookie 过期时
                     ▼
              cookie生成服务(sdenv) 内网调用
```

- Go 侧：`refraction-networking/utls` + `bogdanfinn/tls-client`（现成 Chrome 指纹库，支持 144 级 ClientHello/X25519MLKEM/ECH），替代 curl-impersonate 子进程
- cookie 生成服务：sdenv 常驻进程，接收"刷新 XX 站 cookie"指令，内部经同一 utls 出口
- 优点：无子进程开销、Go 生态与采集端统一、指纹库可持续升级
- 迁移触发条件：curl-impersonate 方案验证稳定后（预计 1-2 周）

## 七、风险与注意

1. **JA4 第三段（GREASE/扩展顺序）**：curl-impersonate 与真实 Chrome 有细微差异，顶级 WAF（如 Akamai）可识别，但国内 WAF/瑞数主要看前两段 + h2 行为，当前组合够用
2. HTTP/2 帧序、SETTINGS 帧等 h2 层指纹：curl-impersonate 已模拟 Chrome；Go utls 需选 Chrome preset
3. 指纹切换后（Mac→Win、121→144）首次验证若失败：可能旧 cookie/会话关联了旧指纹，清 cookie 池重试
4. curl-impersonate 是子进程调用：网关并发高时注意进程池；Go utls 阶段消除
