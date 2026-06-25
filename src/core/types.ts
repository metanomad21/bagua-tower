// ─────────────────────────────────────────────────────────────
// 核心数据模型（GDD §12）。纯类型，零渲染依赖。
// ─────────────────────────────────────────────────────────────

export type Element = '金' | '水' | '火' | '土' | '雷' | '风';

/** 射程档位（GDD §9）：决定一个卦能在哪些格子有效输出 */
export type RangeBand = 'short' | 'mid' | 'long';

export type GuaId =
  | 'qian' // 乾
  | 'kun'  // 坤
  | 'zhen' // 震
  | 'xun'  // 巽
  | 'kan'  // 坎
  | 'li'   // 离
  | 'gen'  // 艮
  | 'dui'; // 兑

/** 词条五动词（GDD §8.3）：引擎只需实现这 5 个，combo 全是它们的配置组合 */
export type RiderVerb = 'onHit' | 'onKill' | 'statMod' | 'applyStatus' | 'zone';

export interface Rider {
  verb: RiderVerb;
  target: 'self' | 'enemy' | 'ground';
  /** 动词参数（占位，最终数值见 GDD §14③） */
  params: Record<string, number | string>;
  /** 是否随卦等级放大（走高放大走宽，GDD §6.1） */
  scalesWithLevel?: boolean;
}

/** 卦定义（静态，来自配置表 data/gua.ts） */
export interface GuaDef {
  id: GuaId;
  name: string;
  element: Element;
  role: string;
  attackType: string;
  base: {
    damage: number;
    cooldown: number; // 秒
    range: RangeBand;
    aoe: number;
  };
  /** 等级倍率，index 0 = Lv1。次线性（GDD §6.1） */
  levelMultipliers: number[];
  maxLevel: number; // MVP 封顶 3
}

/** 组合定义（静态，来自配置表 data/combos.ts）。pair 为无序卦对 */
export interface ComboDef {
  pair: [GuaId, GuaId];
  name: string;
  desc: string;
  /** 这条边把词条分发给哪个卦（to）。两头各一个，GDD §8.1 */
  riders: { to: GuaId; rider: Rider }[];
}

/** 盘上的卦实例（运行时） */
export interface GuaInstance {
  def: GuaDef;
  level: number; // 1..maxLevel
  cellIndex: number;
  /** 由 ComboEngine 每次放卦后重算；几何封顶 ≤4 条（GDD §8.2） */
  activeRiders: Rider[];
}

/** 暂存区一项：卦定义 + 当前等级（暂存内可合成升级，GDD §7） */
export interface StashItem {
  def: GuaDef;
  level: number;
}

/** 方位 id（九宫方位层，MVP 休眠，GDD §4） */
export type ZoneId = GuaId | 'center';

/** 格子元数据（方位层 MVP 休眠；占用由 Board 统一管理） */
export interface Cell {
  index: number;
  zone?: ZoneId;
}

export interface EnemyStatus {
  kind: 'slow' | 'burn' | 'wet' | 'mark';
  amount?: number;
  until?: number; // 剩余秒
}

/** 环绕进攻的怪（GDD §4） */
export interface Enemy {
  id: number;
  hp: number;
  maxHp: number;
  speed: number;
  /** 环绕进度 0~1 */
  orbitPos: number;
  statuses: EnemyStatus[];
  /** 抵达终点被抵消（本帧移除，不触发 onKill） */
  reachedEnd?: boolean;
}
