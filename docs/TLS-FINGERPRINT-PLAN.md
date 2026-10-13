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
| `browser/chrome/fingerprint.js` | ✅ 已改 | 重构为单一来源：FP 数据对象 + 环境注入函数双导出；UA 144/Win、sec-ch-ua 头、Win 指纹全套 |
| `browser/chrome/navigator.js` | ✅ 已改 | userAgent/appVersion/platform 改引 `FP`（消除 131/Mac 旧值） |
| `utils/impersonate.js` | ✅ 新建 | curl-impersonate 封装：FP.headers 默认头、`--impersonate chrome142`、代理透传、Set-Cookie 解析、CLI 模式 |
| `sdenv-jsdom/.../resource-loader.js` | ✅ 已改 | `SDENV_IMPERSONATE=1` 且 `global.__sdenvImpersonate` 存在时，jsdom 拉资源走 impersonate（含 cookie 进出） |
| `sdenv/index.js` | ✅ 已改 | SDENV_IMPERSONATE=1 时挂 `global.__sdenvImpersonate` |
| `example/use-check/sc-final.js` | ✅ 已改 | UA 引 FP；二次验证走 impersonate；SLB cookie 判定白名单 |
| `example/use-check/*.js` 其余 | ⬜ 待改 | verify-all/verify-proxy/site-scan 同步换 FP + impersonate |
| `docs/RS-BYPASS-SOLUTION.md` | ⬜ 待更新 | 指纹小节补充 TLS 层 |

## 五、验证结果与待办

已验证：
- chrome142 JA4 = 真实 Chrome 前两段 ✅（tls.peet.ws 实测）
- navigator/UA/头三层同源 144 ✅（单测）
- impersonate CLI 拉四川首包正常（200 + 4 cookie + RS 挑战）✅

待验证（需目标站配合，注意节奏防拉黑）：
1. `SDENV_IMPERSONATE=1 node example/use-check/sc-final.js <四川>` 全链路（jsdom 资源也走 Chrome TLS）
2. 宁夏：新 IP + impersonate 出口，单次跑完 P cookie + 二次验证闭环（9 月至今未完成过服务端认可验证）
3. 压测节奏：同一 IP 对单站完整流程 ≤2 次/小时（从宁夏经验反推，未实测阈值）

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
