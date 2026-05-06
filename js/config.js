// =====================================================================
// CONFIG — All gameplay-tuning knobs in one place.
//
// 调这里的值会改变游戏感觉（难度曲线、生命数、星级评定、手势灵敏度等）。
// 不要把"安全/反作弊钳位"放进来——那些在 storage.js 里，调松了会削弱安全。
//
// 修改 LEVEL_CONFIG / BOSS_CONFIG 后必须重新生成预计算关卡数据：
//   node tools/generate-levels-data.mjs
//
// 修改 GAME_CONFIG / INPUT_CONFIG 立即生效（重启浏览器即可）。
// =====================================================================

/**
 * 关卡难度曲线 ── 决定每一关的箭头数量、网格大小、复杂度
 *
 * 经验值参考：
 *   Lv  1：27 箭头, 15×20, 80秒, 10 个可点击
 *   Lv 10：45 箭头, 20×26, 98秒, 4  个可点击
 *   Lv 30：85 箭头, ~30×38, 138秒, 1 个可点击（强制顺序）
 *   Lv 50：125 箭头, ~40×52, 178秒, 1 个可点击
 *   Lv 51：240 箭头, 42×54, 89秒（Boss 减半）, 1 个可点击
 */
export const LEVEL_CONFIG = {
  // ── 整体进度 ──────────────────────────────────────────
  // BOSS 关编号（同时也是预计算关卡的天花板）。BOSS 通关后游戏不结束，
  // 继续按公式生成无尽关卡（第 52、53… 关），难度按 levelParams 公式
  // 自然延伸。所以这个值更准确的叫法是 "BOSS 关号"。
  MAX_LEVEL: 51,
  HARD_THRESHOLD: 10,             // 第几关之后进入"难"曲线
  FORCED_SEQ_LEVEL: 30,           // 第几关之后强制可点击数 = 1（每步唯一解）

  // ── 时间限制：TIME(n) = TIME_BASE_SEC + (n-1) * TIME_STEP_SEC ──
  // Boss 关 = (普通公式得到的时间) / BOSS_TIME_DIVISOR
  TIME_BASE_SEC: 80,              // Lv 1 的秒数
  TIME_STEP_SEC: 2,               // 每升一关增加的秒数
  BOSS_TIME_DIVISOR: 2,           // Boss 时间 = 公式时间的 1/N

  // ── 箭头数量：minArrows = MIN_ARROWS_BASE + n * MIN_ARROWS_STEP ──
  MIN_ARROWS_BASE: 25,
  MIN_ARROWS_STEP: 2,             // 每升一关多 N 根线条
  CAP_ARROWS_SLACK: 8,            // 简单关：箭头数硬上限 = minArrows + N

  // ── 可点击数量斜坡：从 CHOICES_AT_LV1 → 1 ──
  // 实际公式：max(1, round(CHOICES_AT_LV1 - (n-1) * (CHOICES_AT_LV1 - 1) / (FORCED_SEQ_LEVEL - 1)))
  CHOICES_AT_LV1: 10,             // 第 1 关玩家平均能看到的可点击箭头数
  TIGHT_DENOM: 11,                // tightFrac 公式分母（影响"紧凑步数"判定）

  // ── 箭头长度分布（每关箭头按这个比例混合）──
  LENGTH_RATIO_LONG: 0.50,        // 长箭头占比
  LENGTH_RATIO_MEDIUM: 0.42,      // 中等长度占比
  LENGTH_RATIO_SHORT: 0.08,       // 短箭头占比
  AVG_MEDIUM_LEN: 7,              // 中等箭头平均格数
  AVG_SHORT_LEN: 3,               // 短箭头平均格数
  // 长箭头长度公式（hard 与 easy 不同）
  AVG_LONG_HARD_BASE: 14,         // hard 长箭头基数
  AVG_LONG_HARD_STEP: 0.15,       // hard 长箭头每关增长
  AVG_LONG_HARD_CAP: 20,          // hard 长箭头封顶
  AVG_LONG_EASY_BASE: 6,
  AVG_LONG_EASY_STEP: 0.5,
  AVG_LONG_EASY_CAP: 12,
  SHORT_STUB_LIMIT: 5,            // 每关最多允许多少 2 格短箭头（生成器硬上限）

  // ── 网格尺寸 ──
  GRID_ASPECT: 1.30,              // 行/列比，> 1 即"竖屏长方形"
  MIN_COLS: 14,
  MIN_ROWS: 19,
  EASY_MAX_COLS: 32,
  EASY_MAX_ROWS: 40,
  HARD_MAX_COLS_BASE: 22,         // hard 上限基数
  HARD_MAX_COLS_GROWTH: 0.35,     // hard 每关列增长
  HARD_MAX_COLS_CAP: 40,
  HARD_MAX_ROWS_BASE: 28,
  HARD_MAX_ROWS_GROWTH: 0.45,
  HARD_MAX_ROWS_CAP: 52,

  // ── 覆盖率（视觉密度，超过 ~0.85 会显得堵塞）──
  COVERAGE_HARD_BASE: 0.78,
  COVERAGE_HARD_STEP: 0.0015,
  COVERAGE_HARD_CAP: 0.85,
  COVERAGE_EASY_BASE: 0.60,
  COVERAGE_EASY_STEP: 0.015,

  // ── maxBody（单条箭头身体最大长度）──
  MAX_BODY_HARD_BASE: 12,
  MAX_BODY_HARD_STEP: 0.25,
  MAX_BODY_HARD_CAP: 22,
  MAX_BODY_EASY_BASE: 8,
  MAX_BODY_EASY_STEP: 1,
  MAX_BODY_EASY_CAP: 16,

  // ── longBias（生成器把多少箭头分给"长箭头通道"，0~1）──
  LONG_BIAS_HARD_BASE: 0.30,
  LONG_BIAS_HARD_STEP: 0.005,
  LONG_BIAS_HARD_CAP: 0.50,
  LONG_BIAS_EASY_BASE: 0.25,
  LONG_BIAS_EASY_STEP: 0.025,
  LONG_BIAS_EASY_CAP: 0.55,

  // ── depBias（依赖偏置：新箭头被旧箭头挡住的倾向，0~1）──
  // 高 depBias = 起手可点击的箭头少 = 难
  DEP_BIAS_FORCED: 0.95,          // Lv 30+ 强制顺序时
  DEP_BIAS_TIGHT_BASE: 0.65,      // 当目标可点击 ≤ 5 时
  DEP_BIAS_TIGHT_STEP: 0.06,      // 每减少 1 个目标可点击增长
  DEP_BIAS_TIGHT_CAP: 0.90,
  DEP_BIAS_HARD_BASE: 0.40,
  DEP_BIAS_HARD_STEP: 0.020,
  DEP_BIAS_HARD_CAP: 0.75,
  DEP_BIAS_EASY_BASE: 0.10,
  DEP_BIAS_EASY_STEP: 0.015,

  // ── enforceInitialClickable 迭代上限 ──
  ENFORCE_MAX_ITERS_FAST: 300,    // 浏览器内 endless 模式
  ENFORCE_MAX_ITERS_FULL: 800,    // 离线 build
  ENFORCE_NO_PROGRESS_FAST: 12,   // 连续多少轮无进展就放弃（fast）
  ENFORCE_NO_PROGRESS_FULL: 40,
};

/**
 * Boss 关（Lv 51）专属配置
 * 普通公式不适用——这是手工调出的极限难度。
 */
export const BOSS_CONFIG = {
  LEVEL: 51,
  MIN_ARROWS: 240,
  COUNT: 240,
  COLS: 42,
  ROWS: 54,
  MAX_BODY: 24,
  LONG_BIAS: 0.95,
  DEP_BIAS: 0.70,
  TARGET_TIGHT: 0.95,
  COVERAGE: 0.85,
  TARGET_MAX_CHOICES: 1,
};

/**
 * 游戏会话默认值与奖励经济
 */
export const GAME_CONFIG = {
  DEFAULT_LIVES: 3,               // 关卡未指定 lives 时的默认值
  DEFAULT_TIME_LIMIT: 120,        // 关卡未指定 timeLimit 时的默认值（秒）

  // ── 连击 ──
  COMBO_WINDOW_MS: 800,           // 连续消除的最大间隔（ms）

  // ── 星级评定（只看失误次数，不看用时）──
  // 3★ = 零失误（满血通关）
  // 2★ = 1 次失误（剩 maxLives - 1 颗心）
  // 1★ = 2 次及以上失误（仍通关）
  // 注：时间已经是"耗尽即输"的硬性条件，不再叠加用时星级。

  // ── 金币奖励 ──
  COINS_PER_STAR: 5,              // 1★ = 5, 2★ = 10, 3★ = 15
  MAX_STAR_COINS: 15,             // 星金币硬上限（防超上限 bug）
  MAX_COMBO_COINS_PER_LEVEL: 5,   // 单关连击金币上限
  // 单关一次性发放金币硬上限（防作弊）。需 ≥ MAX_STAR_COINS +
  // MAX_COMBO_COINS_PER_LEVEL + (COIN_EVENT_CONFIG.MAX_COINS_PER_EVENT
  // × max(EVENT_PROBABILITIES.length, EVENT_PROBABILITIES_ENDLESS.length))，
  // 否则随机金币在结算时会被截掉。当前预算：15 + 5 + 5×5 = 45（余 5 缓冲）
  HARD_COIN_GRANT_CAP: 50,
  MIN_LEVEL_PLAY_SEC: 1.0,        // 通关最少需玩多少秒才发金币（防作弊）
};

/**
 * 道具兑换价格（金币）
 * - 道具（魔法棒）: 100 金币兑换 1 次
 * - 提示: 80 金币兑换 1 次
 */
export const ITEM_SHOP_CONFIG = {
  WAND_COST_COINS: 100,
  HINT_COST_COINS: 80,
};

/**
 * 输入手势识别阈值
 * 调小 → 更容易触发拖动；调大 → 更容易触发点击
 */
export const INPUT_CONFIG = {
  TAP_DIST_PX: 10,                // 手指/鼠标移动 ≤ N px 才算点击（否则视为拖动）
  TAP_TIME_MS: 280,               // 按下后 ≤ N ms 才算点击（否则视为长按/拖动）
};

/**
 * 关卡进行中的"金币随机事件"
 *
 * 规则：
 *  - 每个彩色关卡按 EVENT_PROBABILITIES 数组逐次条件掷骰决定触发次数
 *  - 每次在某个箭头"头部飞出方向"前方的空格上放置 1~MAX_COINS_PER_EVENT 枚金币
 *  - 当玩家点击该箭头消除时，箭头头部沿着这条必经之路飞出 → 自动收集金币 → 播音效
 *  - 收到的金币累计在 session 里，胜利时一并加进玩家总金币
 *
 * 不会出现在黑白关卡（用 COLORED_LEVELS_ONLY 控制）。
 *
 * 调小 MIN_CLEARS_BEFORE_FIRST 让事件来得更早；
 * 调大 MAX_COINS_PER_EVENT 让单次收益更高（但要小心和 GAME_CONFIG.HARD_COIN_GRANT_CAP 的关系）。
 */
export const COIN_EVENT_CONFIG = {
  ENABLED: true,                  // 总开关
  COLORED_LEVELS_ONLY: true,      // 仅彩色关卡

  // ── 每关事件次数（按顺序条件掷骰）──
  // 数组每一项 = "前面的事件都已发生"的前提下，本次事件的触发概率。
  // 第 i 次失败后，后面的事件不再尝试（事件次数是连续的，不会跳号）。
  //
  // 普通关（Lv 1–51）实际分布：
  //   • 0 次：40%        (1 - 0.60)
  //   • 1 次：42%        (0.60 × 0.70)
  //   • 2 次：18%        (0.60 × 0.30)
  //
  // 想加第 3 次就把数组延长，例如 [0.60, 0.30, 0.10]。
  // 想完全关闭随机金币事件：设为 [] 或 ENABLED=false。
  EVENT_PROBABILITIES: [0.60, 0.30],
  // 无尽模式（Lv 52+，BOSS 之后的所有关）金币事件更频繁，
  // 因为这些关本身更难、时间更长，作为额外奖励的诱惑。
  // 当前 [0.60, 0.40, 0.40, 0.40, 0.40] 实际分布：
  //   • 0 次：40.0%
  //   • 1 次：36.0%   (0.60 × 0.60)
  //   • 2 次：14.4%   (0.60 × 0.40 × 0.60)
  //   • 3 次：5.76%
  //   • 4 次：2.30%
  //   • 5 次：1.54%
  EVENT_PROBABILITIES_ENDLESS: [0.60, 0.40, 0.40, 0.40, 0.40],

  MIN_COINS_PER_EVENT: 1,
  MAX_COINS_PER_EVENT: 5,
  // 第一次事件触发前必须先成功消除多少根线条
  MIN_CLEARS_BEFORE_FIRST: 2,
  // 两次事件之间的最小消除间隔
  MIN_CLEARS_BETWEEN: 4,
  // 优先把金币放在"当前还不可点击"的箭头路径上（更有挑战、更慢被收）；
  // 如果没有合适的就退回到任意 idle 箭头
  PREFER_BLOCKED_ARROWS: true,
};
