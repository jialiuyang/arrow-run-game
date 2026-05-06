
# 箭头快跑 · Arrow Run

> 一眼看懂的消除魔法 — 点击前方无阻挡的箭头，触发多米诺骨牌式连锁消除！
https://github.com/jialiuyang/arrow-run-game/blob/main/22.png
## 🎮 玩法说明

1. **目标**：消除关卡中所有的箭头。
2. **规则**：只有当箭头**沿着指向方向到棋盘边缘的整条直线都没有其他箭头**时，它才能被点击消除。
3. **消除**：点击有效箭头，箭头会沿着方向飞出棋盘，可能为后方箭头让出通路 — 形成连锁消除。
4. **失败**：
   - 点击被阻挡的箭头会扣除一颗心（共 3 颗）。
   - 心数清零或倒计时归零，挑战失败。
   - 局面僵死（无可消除箭头）也会失败 — 可使用「撤销」拯救。
5. **得星**：3 星完美通关 = 满血 + 用时 < 时限的 50%。

## ✨ 核心特性

- 🎯 **指向性消除核心玩法** — 完整实现需求文档中的「前方无阻挡 → 飞出 → 连锁」机制
- 🎨 **流畅渲染** — Canvas + DPR 适配 + Tween 动画 + 粒子特效
- 👆 **完美手势识别** — 单指点击 / 单指拖拽平移 / 双指缩放 / 鼠标滚轮缩放（严格区分 Tap & Drag）
- 💖 **完整游戏系统** — 生命值、倒计时、连击系统、星级评分、撤销、提示
- 📚 **关卡渐进** — 12 个手工设计关卡 + 无限程序化生成关卡
- 🔊 **WebAudio 音效** — 全部程序生成，无需音频文件
- 💾 **本地存档** — 关卡进度、星数、设置自动保存
- 📱 **移动端友好** — 安全区适配、触觉反馈、响应式 HUD

## 🏗️ 技术架构

| 层级 | 模块 | 职责 |
|------|------|------|
| 表现层 | `renderer.js` | Canvas 渲染、世界↔屏幕变换、缩放/平移、粒子 |
| 表现层 | `ui.js` | DOM HUD、模态框、关卡选择、连击提示 |
| 逻辑层 | `game.js` | 主控制器、游戏循环、生命/计时/胜负 |
| 逻辑层 | `board.js` | 棋盘网格、阻挡检测、连通性、可解性校验 |
| 逻辑层 | `arrow.js` | 箭头实体、状态机（IDLE/HOVER/FLYING/REMOVED/SHAKE）|
| 输入层 | `input.js` | Pointer Events 统一处理、Tap/Pan/Pinch 区分 |
| 数据层 | `levels.js` | 关卡定义 + 程序化生成器（保证可解） |
| 数据层 | `storage.js` | LocalStorage 存档 |
| 音效层 | `audio.js` | WebAudio 合成 SFX（whoosh/err/win/lose/combo） |

### 为什么用 Web 技术而非 Cocos Creator？

需求文档建议 Cocos Creator 3.8+，但本项目采用 **HTML5 Canvas + 原生 JavaScript ES Modules** 实现：

✅ **零构建步骤** — 双击 `index.html` 即可运行（或用任意 http 服务器托管）
✅ **跨平台** — 同一份代码可在 PC 浏览器、移动浏览器、PWA、微信内置浏览器中运行
✅ **小游戏适配** — 微信小游戏、抖音小游戏均原生支持 Canvas，可几乎无修改移植
✅ **轻量** — 整个游戏 <50KB（无依赖、无图片资源、SFX 程序合成）
✅ **方便迭代** — 任何文本编辑器即可修改关卡数据和参数

技术栈对比下表展示了本实现如何满足需求文档中的关键技术点：

| 需求文档要求 | 本实现 |
|---|---|
| Grid 网格系统 | `Board` 类用 `Map<"x,y", Arrow>` |
| 点击检测（射线/坐标转换） | `Renderer.pickArrow()` + `screenToWorld()` |
| 平滑 Pinch-to-Zoom + Pan | `InputManager` + `Renderer.zoomAt()/pan()/_clampPan()` |
| Tap vs Drag 区分（重点风险） | 阈值 `TAP_DIST=10px`、`TAP_TIME=280ms` |
| 连通性预计算 | `Board.isSolvable()`（贪心模拟） |
| Trail Renderer | `Renderer.spawnTrail()` 粒子轨迹 |
| 状态机管理 | `STATE` 枚举 + 状态化动画 |
| 死局判定 | 主循环中调用 `findClearable()` |
| TiledMap 性能 | 单 Canvas 整体绘制，DrawCall 恒为 1 |
| 安全区适配 | `env(safe-area-inset-*)` |
| 关卡 JSON | `LEVELS` 数组同形结构 |

### 关卡可解性保证

`levels.js` 中的 `makeRandomArrows()` 使用**反向构造法**生成关卡：每次新增的箭头要求其指向方向到边缘没有已存在的箭头。这保证按**插入逆序**消除一定可解，因此整个关卡至少有一个解。

## 🚀 运行方式

### 方式一：内置 Node 服务器（推荐）
```bash
npm start
# 然后浏览器打开 http://localhost:8765/
```

### 方式二：直接打开 index.html
浏览器对 ES Modules 的本地文件（`file://`）有 CORS 限制；若双击空白请改用方式一。

### 方式三：任意静态服务器
```bash
python -m http.server 8080         # Python 3
npx serve .                         # Node
```

### 自动化测试
```bash
npm test                            # 单元测试 — Board 逻辑、关卡可解性 (40 个断言)
npm run verify-levels               # 仅验证关卡可解性
node security-test.mjs              # 静态服务器安全回归测试
node anticheat-test.mjs             # 防刷金币 / 防篡改存档回归测试
```

### 方式三：移植到微信小游戏
1. 用 Cocos Creator 创建空 Web 项目
2. 将 `js/`、`css/`、`index.html` 内容粘入对应位置
3. 修改 `Renderer` 使用 `wx.createCanvas()` 接口
4. `localStorage` 替换为 `wx.setStorageSync` / `wx.getStorageSync`

## 🎨 关卡设计指南

在 `js/levels.js` 中添加新关卡：

```javascript
{
  name: "你的关卡名",
  cols: 8, rows: 10,        // 棋盘尺寸
  timeLimit: 120,            // 秒
  lives: 3,                  // 心数
  arrows: [
    { x: 1, y: 2, dir: "UP" },
    { x: 3, y: 4, dir: "LEFT" },
    // ...
  ],
}
```

`dir` 可取：`UP` / `DOWN` / `LEFT` / `RIGHT`（坐标系：`x` 向右、`y` 向下）。

## 🐛 调试技巧

打开浏览器控制台，可访问 `__game` 对象：

```javascript
__game.loadLevel(7)              // 跳转到关卡 8
__game.board.isSolvable()        // 检查当前关卡是否可解
__game.board.findClearable()     // 找到任意可消除的箭头
__game.state                     // 查看存档状态
localStorage.removeItem("arrow_run_v1")  // 清空存档
```

## 📁 文件结构

```
arrow-run-game/
├── index.html              # 入口
├── css/style.css           # 全部样式
├── js/
│   ├── main.js             # 入口脚本
│   ├── game.js             # 游戏主控
│   ├── board.js            # 棋盘逻辑
│   ├── arrow.js            # 箭头实体
│   ├── renderer.js         # Canvas 渲染
│   ├── input.js            # 手势输入
│   ├── ui.js               # DOM UI
│   ├── audio.js            # WebAudio SFX
│   ├── storage.js          # LocalStorage 存档
│   └── levels.js           # 关卡 + 生成器
└── README.md
```

## 🛣️ 后续可扩展

- [ ] 网络排行榜（关卡用时 PK）
- [ ] 每日挑战 — 同一种子的关卡
- [ ] 特殊砖块：冰箭头（一次只能减速）、彩色箭头（连色加分）
- [ ] 道具系统：定向消除卡、时间冻结卡、双击解锁
- [ ] 主题皮肤系统
- [ ] 广告 / 分享接入（小游戏平台）
