# 安全模型与防御措施

本文档记录"箭头快跑"项目的威胁模型、已实施的安全控制以及生产部署时还需注意的事项。所有安全相关测试都集中在 `security-test.mjs`。

---

## 1. 项目特征

| 维度 | 说明 |
|------|------|
| 应用类型 | 纯前端 HTML5 单机游戏（Vanilla JS Modules） |
| 后端 | 无（仅 `serve.mjs` 一个 Node 静态文件服务，仅供开发） |
| 用户数据 | 仅 `localStorage` 内的本地存档（关卡进度、星星、金币、设置） |
| 个人信息 (PII) | 不收集 |
| 第三方依赖 | 0 — 没有任何 npm 运行时依赖 |
| 网络请求 | 仅同源静态资源 |
| 用户输入 | 仅触摸/点击/键盘事件，**没有**任何输入框、URL 参数、表单或 API |

低攻击面但仍按防御纵深 (defense-in-depth) 原则加固。

---

## 2. 威胁模型 (STRIDE)

| 威胁 | 攻击者动机 | 项目暴露面 | 防御层 |
|------|-----------|-----------|--------|
| **路径穿越 / 文件读取** | LAN 内攻击者从 dev server 拉取项目源码或系统文件 | `serve.mjs` | §3.1 |
| **隐藏文件泄露** | 抓取 `.git/`, `.env`, `.DS_Store` | `serve.mjs` | §3.1 |
| **方法滥用** | PUT / DELETE / 探测路由 | `serve.mjs` | §3.1 |
| **慢连接 DoS / Slowloris** | 占满 socket 让服务挂死 | `serve.mjs` | §3.1 |
| **客户端 XSS** | 注入 `<script>` 窃取 localStorage、植入挖矿 | 前端 DOM | §3.2 |
| **二阶 XSS（localStorage）** | 通过浏览器扩展/devtools 写入恶意字符串，等游戏代码内联到 DOM 时执行 | `js/storage.js` | §3.3 |
| **点击劫持** | 用 iframe 套住游戏诱导误操作 | 整个站点 | §3.1 + §3.2 (`frame-ancestors`) |
| **MIME 嗅探** | 误把 `.png` 当 `.html` 执行 | 浏览器 | `X-Content-Type-Options: nosniff` |
| **Referrer 泄露** | 通过 Referer 头泄露内部 URL | 浏览器 | `Referrer-Policy: no-referrer` |
| **存档被篡改导致 UI 崩溃** | 损坏的 JSON、负数关卡号、Infinity 等 | `js/storage.js` | §3.3 |
| **第三方供应链攻击** | 引入恶意 npm 包 | `package.json` | 项目运行时**零依赖**；CI 静态分析即可 |

---

## 3. 已实施的防御措施

### 3.1 服务端 (`serve.mjs`)

| 控制 | 说明 |
|------|------|
| **方法白名单** | 仅响应 `GET` / `HEAD`，其他方法直接 405 |
| **URL 长度限制** | 上限 2048，超过返回 414 |
| **NUL 字节 / 控制字符过滤** | 在 sanitize 阶段直接 400 |
| **`..` 段拒绝** | 任何 path 段为 `..` 直接 400 |
| **隐藏文件拒绝** | 任何 path 段以 `.` 开头（`.git/`, `.env` 等）直接 400 |
| **`path.resolve` + `startsWith(ROOT + sep)`** | 处理 Windows 大小写和混合分隔符 |
| **`fs.realpath` 复检** | 防止符号链接逃逸出项目目录 |
| **扩展名白名单** | 仅 `.html/.js/.mjs/.css/.json/.svg/.png/.jpg/.jpeg/.webp/.ico/.txt/.woff/.woff2/.map`；`.bak/.orig/.swp/.zip/...` 一律 404 |
| **`headersTimeout: 10s`** | 防 Slowloris：headers 必须 10 秒内发完 |
| **`requestTimeout: 30s`** | 整个请求最多 30 秒 |
| **`keepAliveTimeout: 5s`** | 空闲连接快速回收 |
| **`maxHeadersCount: 50`** | 防 header-bomb |
| **`clientError` → `socket.destroy`** | 协议层垃圾输入直接断开，不回包 |
| **不读 body** | 静态服务无须 body parser，从根源消除 body DoS |
| **错误信息脱敏** | 永远只回简短文案，不回 stack / 路径 |
| **去掉 `Server` 头** | 减少指纹 |

### 3.2 前端 (`index.html`)

通过 **HTTP 响应头**（`serve.mjs` 设置）+ **`<meta>` 标签**（兜底）双重下发：

```
Content-Security-Policy: default-src 'self'; script-src 'self';
                         style-src 'self' 'unsafe-inline';
                         img-src 'self' data:; font-src 'self';
                         media-src 'self' blob:; connect-src 'self';
                         object-src 'none'; frame-ancestors 'none';
                         base-uri 'self'; form-action 'self';
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), …
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-DNS-Prefetch-Control: off
```

要点：

- `script-src 'self'` —— 没有 `'unsafe-inline'` / `'unsafe-eval'`，是 XSS 防御的核心红线。
- `style-src 'self' 'unsafe-inline'` —— 启用是因为 boot-splash CSS 内联在 `<head>`，而且若干 SVG 用了 `style=""`。这条放宽**只允许样式注入**，不允许脚本注入。
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` —— 双重阻止 iframe 嵌入（`X-Frame-Options` 是给老浏览器，新浏览器看 CSP）。
- `connect-src 'self'` —— 即使代码被注入也无法 fetch 到外部攻击者服务器。
- `Permissions-Policy` —— 摄像头/麦克风/地理位置等敏感能力一律默认禁用。

### 3.3 存档 (`js/storage.js`)

加载时对 localStorage 字段**严格类型/范围校验**：

- 整型字段（`currentLevel/maxUnlocked/coins/stars[i]`）→ `Math.floor` + min/max 钳位
- 浮点字段（`bestTimes[i]`）→ `Number.isFinite` 检查 + 范围钳位
- 布尔字段（`settings.sfx/vibrate`）→ 仅接受 `true/false`
- 字典最多保留 300 个键，防内存炸弹
- 整个存档 50 KB 上限，超出直接重置默认值
- 任何 parse 异常 → 返回默认值，绝不抛错

副作用：即使有人通过 devtools 把 `currentLevel` 改成 `"<img src=x onerror=alert(1)>"`，加载后这个字段一定是 0~200 之间的整数，渲染到 DOM 时不会执行任何脚本。

---

## 3.4 反刷金币 / 反作弊（防 cheating）

> **诚实声明**：纯前端单机游戏**不可能**对一个有源码访问权限的攻击者做到真正的不可作弊（验证逻辑和被验证数据都在用户机器上）。这一节的目标是把"打开 devtools 改个值就有 9999 金币"的难度，从 **5 秒** 提到 **需要读懂三个文件、复用密钥、重新签名**——足以挡住 99% 的好奇玩家。

### 攻击面

| 攻击 | 攻击者操作 |
|------|-----------|
| **直接改存档** | `localStorage.setItem('arrow_run_v1', '{"coins":99999}')` |
| **控制台调通关** | `__game._endWin()` |
| **控制台改字段** | `__game.state.coins = 99999; __game.save()` |
| **时钟篡改** | 把 `timeLeft` 改大、`startedAt` 改小 |
| **重放快照** | 通关一次，复制 localStorage，花完后还原 |
| **预解锁所有关** | `localStorage` 里直接写 `maxUnlocked: 200` |

### 三层防御

**A. 存档完整性签名（`storage.js`）**

存档格式：

```json
{ "v": 1, "d": "<内层 state JSON>", "s": "<签名>" }
```

- `signState(d)` 是 FNV-1a + Murmur 风格的双 32-bit 混合 keyed hash，密钥 `_SIG_K` 拆成 16 个字节常量数组（防止 grep 整数）。
- 加载时若 `signState(wrapper.d) !== wrapper.s` → 静默重置为默认值（不打 log，避免提示攻击者哪一关失败）。
- 保存时**总是重新签名 + 重新 sanitize**——确保 game 代码意外写入非法值也不会落盘。
- 旧的无签名格式（早期版本）会被一次性接受并在下次写入时升级到带签名格式（向后兼容）。

**B. 关卡 session token + `_endWin` 强校验（`game.js`）**

每次 `loadLevel` 生成 `this._session = { levelIdx, startedAt, nonce, coinsAwarded:false }`。`_endWin` 必须满足全部条件才发金币：

1. session 存在且未发过金币（防双发）
2. session 的 levelIdx 等于 `currentLevel`（防 console 切关后调）
3. `board.isCleared() === true`（防虚假通关）
4. 没有正在飞的箭头（防中途调用）
5. 实际游戏耗时 ≥ 1 秒（防即时通关）
6. `timeLeft >= 0`（防超时仍领奖）

任何一项失败 → `_endWin` 直接 return，**不修改状态**。

**C. 金币硬上限（`game.js`）**

即便所有上面的检查都被绕过：

- `coinsFromStars` 钳到 `[0, 15]`（3★×5）
- `comboBonus` 钳到 `[0, MAX_COMBO_COINS_PER_LEVEL=5]`
- `totalCoinsEarned` 钳到 `[0, HARD_COIN_GRANT_CAP=25]`

`storage.js` 的 sanitize 还会做最后一道闸：

- `coins ≤ MAX_COINS = 1_000_000`（绝对上限）
- `coins ≤ (maxUnlocked + 1) × 20 × 50` （动态信封：解锁 N 关，最多累计 N×20×50 金币——给重玩刷分留 50× 余量但不允许"零关卡 99M 金币"）
- `bestTimes[i] < 1.0` 直接丢弃（不可能的最快记录）
- `currentLevel > maxUnlocked` 自动夹回

**D. 隐藏调试钩子（`main.js`）**

```js
// Before:  window.__game = game;            ← 一行命令通关
// After:
if (new URLSearchParams(location.search).get("dev") === "1") {
  window.__game = game;
}
```

普通玩家拿不到 `__game`。开发者用 `?dev=1` 临时开启。即便开启，B+C 的双层 gate 仍然挡住 console 直接调 `_endWin()`。

### 攻击效果矩阵

| 攻击 | 防御层 | 结果 |
|------|--------|------|
| 改 `coins` 字段 | A 签名失败 | 整个存档重置为 0 |
| 改 `coins` + 重算签名 | C 信封钳位 | 钳到 `(maxUnlocked+1) × 1000` |
| 改 `maxUnlocked = 200` | C 动态信封基于此值放大 | 不能凭空获得金币（解锁本身不发币） |
| `__game._endWin()` 控制台调 | D 钩子隐藏 + B 多重校验 | 没有 `__game`；即使有，board 未清空也 return |
| 通关后回退 startedAt 再调 | B 第 1 项 `coinsAwarded` 锁 | 同一 session 只发一次 |
| 改 `bestTimes[0] = 0.001` | A 签名 + 加载时 < 1s 丢弃 | 重置或丢弃该条 |
| 大尺寸 localStorage DoS | sanitize 100KB 上限 | 直接重置 |

### 保留的"灰色地带"

这些是设计上**允许**的，不当作攻击：

1. **重玩刷金币** —— 通关一次给 5~25 金币，玩家反复打第 1 关也合法。50× 信封覆盖了 ~~10 万次~~ 重玩。
2. **`window.localStorage.clear()` 清档** —— 玩家自愿放弃进度，没必要保护。
3. **修改 settings.sfx/vibrate** —— 没有经济影响。

---

## 4. 自动化验证

```
node smoke-test.mjs       # 60 项游戏逻辑回归
node security-test.mjs    # 35 项服务端安全硬化（路径穿越、headers、超时等）
node anticheat-test.mjs   # 28 项反作弊（签名、重放、字段钳位等）
```

`security-test.mjs` 在 `serve.mjs` 上跑下面这些 case：

- `GET /../etc/passwd` → 400/403
- `GET /%2e%2e/etc/passwd` → 400/403
- `GET /index.html%00.txt` → 400
- `GET /.git/config` → 400/404
- `GET /package.json.bak` → 404（白名单未命中）
- `POST /` → 405（方法不允许）
- `GET /` → 200 且包含完整安全头集合
- 超长 URL → 414
- 等等

`anticheat-test.mjs` 模拟攻击者直接编辑 localStorage：

- 修改 `coins` 不更新签名 → 整个存档被拒
- 伪造签名（空、`abc.def`、最后字符截断等常见 brute force） → 全部拒绝
- 旧版无签名存档塞 9.99 亿金币 → 钳到信封内
- `bestTimes[0] = 0.001` → 加载时被丢弃
- 100KB+ payload → 拒绝

---

## 5. 生产部署须知

`serve.mjs` 是 **开发服务**，不要直接拿来给公网用户用。生产应放在：

- nginx / caddy / traefik
- Cloudflare Pages / Netlify / Vercel / GitHub Pages
- 任何静态对象存储 + CDN

并启用：

- **HTTPS** + HSTS
- 同样的安全响应头（参考 §3.2 的清单）
- 边缘 Rate Limiting / WAF
- 长期缓存（带 hash 的 asset URL；目前 dev server 用 `Cache-Control: no-store`）

---

## 6. 报告漏洞

如果发现安全问题，请通过项目仓库的 issue 私下联系作者，**不要**提交 PR 直接公开 PoC。
