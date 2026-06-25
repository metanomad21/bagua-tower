import type { ComboDef } from '../core/types.ts';

// ─────────────────────────────────────────────────────────────
// 六组合配置表（GDD §10）。combo = 5 个词条动词的配置组合，引擎不写死特例。
// pair 为无序卦对；riders 把词条按 to 分发给两头各一个。
// params 为占位，待 §14③ 数值原型。
//
// 覆盖（GDD §10 校验）：
//   8 卦全部出现 — 乾坤震巽坎离艮兑
//   5 动词全部用到 — onHit / onKill / statMod / applyStatus / zone
// ─────────────────────────────────────────────────────────────

export const COMBO_TABLE: ComboDef[] = [
  {
    pair: ['li', 'zhen'], name: '火雷阵', desc: '火球命中额外闪电 / 闪电留火片',
    riders: [
      { to: 'li', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'chainLightning', dmg: 6 }, scalesWithLevel: true } },
      { to: 'zhen', rider: { verb: 'zone', target: 'ground', params: { effect: 'firePatch', dmg: 3, dur: 2 }, scalesWithLevel: true } },
    ],
  },
  {
    pair: ['kan', 'gen'], name: '水山阵', desc: '减速 + 生成冰墙，撞墙冰爆',
    riders: [
      { to: 'kan', rider: { verb: 'applyStatus', target: 'enemy', params: { status: 'slow', amount: 0.3, dur: 2 } } },
      { to: 'gen', rider: { verb: 'zone', target: 'ground', params: { effect: 'iceWall', hp: 30 } } },
    ],
  },
  {
    pair: ['xun', 'li'], name: '风火阵', desc: '给短射程的巽 +射程，火球变移动火龙卷',
    riders: [
      { to: 'xun', rider: { verb: 'statMod', target: 'self', params: { stat: 'range', add: 2 } } },
      { to: 'li', rider: { verb: 'statMod', target: 'self', params: { stat: 'aoe', mul: 1.3 } } },
    ],
  },
  {
    pair: ['dui', 'qian'], name: '泽天阵', desc: '暴击射金剑 / 击杀掉灵气',
    riders: [
      { to: 'qian', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'goldSword', dmg: 8, chance: 0.3 } } },
      { to: 'dui', rider: { verb: 'onKill', target: 'self', params: { drop: 'coin', amount: 1 } } },
    ],
  },
  {
    pair: ['kun', 'dui'], name: '地泽阵', desc: '召唤物击杀掉灵气',
    riders: [
      { to: 'kun', rider: { verb: 'onKill', target: 'self', params: { drop: 'coin', amount: 1 } } },
      { to: 'dui', rider: { verb: 'statMod', target: 'self', params: { stat: 'damage', mul: 1.15 } } },
    ],
  },
  {
    pair: ['kan', 'li'], name: '水火阵', desc: '冰火交替蒸汽爆',
    riders: [
      { to: 'kan', rider: { verb: 'applyStatus', target: 'enemy', params: { status: 'wet', dur: 2 } } },
      { to: 'li', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'steamBurst', dmg: 7, condition: 'wet' } } },
    ],
  },

  // ── 扩展组合（第二批，GDD §10）──
  {
    pair: ['li', 'qian'], name: '火天大有阵', desc: '飞剑裹火穿透留火轨、火球射程拉满',
    riders: [
      { to: 'qian', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'flameSword', dmg: 6, dur: 1.5 }, scalesWithLevel: true } },
      { to: 'li', rider: { verb: 'statMod', target: 'self', params: { stat: 'range', add: 1.5 } } },
    ],
  },
  {
    pair: ['li', 'gen'], name: '山火贲阵', desc: '离挂灼烧，艮砸落引爆成火山喷发',
    riders: [
      { to: 'li', rider: { verb: 'applyStatus', target: 'enemy', params: { status: 'burn', amount: 4, dur: 3 } } },
      { to: 'gen', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'detonateBurn', dmg: 14 }, scalesWithLevel: true } },
    ],
  },
  {
    pair: ['xun', 'kan'], name: '风水涣阵', desc: '水波扩大并漩涡牵引聚怪',
    riders: [
      { to: 'kan', rider: { verb: 'statMod', target: 'self', params: { stat: 'aoe', mul: 1.6 } } },
      { to: 'kan', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'vortex' } } },
      { to: 'xun', rider: { verb: 'applyStatus', target: 'enemy', params: { status: 'slow', amount: 0.4, dur: 2.5 } } },
    ],
  },
  {
    pair: ['kan', 'zhen'], name: '水雷屯阵', desc: '潮湿之敌雷击必连锁、伤害翻倍',
    riders: [
      { to: 'kan', rider: { verb: 'applyStatus', target: 'enemy', params: { status: 'wet', dur: 2.5 } } },
      { to: 'zhen', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'conduct', dmg: 6 }, scalesWithLevel: true } },
    ],
  },
  {
    pair: ['qian', 'zhen'], name: '天雷无妄阵', desc: '雷击召唤追命飞剑、金气增伤',
    riders: [
      { to: 'zhen', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'summonSword', dmg: 8 }, scalesWithLevel: true } },
      { to: 'qian', rider: { verb: 'statMod', target: 'self', params: { stat: 'damage', mul: 1.2 } } },
    ],
  },
  {
    pair: ['kun', 'gen'], name: '地山谦阵', desc: '召石甲土偶，光环反伤减速',
    riders: [
      { to: 'kun', rider: { verb: 'onHit', target: 'enemy', params: { effect: 'summonGolem', hp: 40, dmg: 6, dur: 6 }, scalesWithLevel: true } },
      { to: 'gen', rider: { verb: 'statMod', target: 'self', params: { stat: 'damage', mul: 1.2 } } },
    ],
  },
];
