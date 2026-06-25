import type { GuaDef } from '../core/types.ts';

// ─────────────────────────────────────────────────────────────
// 八卦定义表（GDD §9）。base 数值与 levelMultipliers 为占位，
// 待 §14③ 数值原型锁定。渲染颜色不在此处（表现层私有）。
//
// 等级倍率次线性（GDD §6.1）：Lv2 ≈ +38%，Lv3 累计 ≈ +78%。
// ─────────────────────────────────────────────────────────────

const LEVELS = [1.0, 1.4, 1.85, 2.4]; // Lv1 / Lv2 / Lv3 / Lv4（自走棋合成，占位）

export const GUA_TABLE: GuaDef[] = [
  {
    id: 'qian', name: '乾', element: '金',
    role: '单体高伤·阵眼', attackType: '飞剑直线穿透',
    base: { damage: 14, cooldown: 1.4, range: 'long', aoe: 0 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
  {
    id: 'kun', name: '坤', element: '土',
    role: '召唤/防御', attackType: '土偶阻挡',
    base: { damage: 6, cooldown: 1.6, range: 'short', aoe: 0 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
  {
    id: 'zhen', name: '震', element: '雷',
    role: '连锁伤害', attackType: '闪电弹跳',
    base: { damage: 8, cooldown: 1.0, range: 'mid', aoe: 0 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
  {
    id: 'xun', name: '巽', element: '风',
    role: '攻速/多段', attackType: '风刃高速切割',
    base: { damage: 4, cooldown: 0.5, range: 'short', aoe: 0 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
  {
    id: 'kan', name: '坎', element: '水',
    role: '控制/减速', attackType: '水波减速',
    base: { damage: 5, cooldown: 1.2, range: 'mid', aoe: 1 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
  {
    id: 'li', name: '离', element: '火',
    role: 'AOE爆发·阵眼', attackType: '火球爆炸灼烧',
    base: { damage: 10, cooldown: 1.2, range: 'long', aoe: 2 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
  {
    id: 'gen', name: '艮', element: '土',
    role: '阻挡/反伤', attackType: '山石砸落',
    base: { damage: 9, cooldown: 1.8, range: 'short', aoe: 1 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
  {
    id: 'dui', name: '兑', element: '金',
    role: '经济/暴击', attackType: '铜钱弹/暴击',
    base: { damage: 7, cooldown: 1.1, range: 'mid', aoe: 0 },
    levelMultipliers: LEVELS, maxLevel: 4,
  },
];

/** 按 id 取卦定义（Phase 4 起卦/放置会用） */
export function guaById(id: string): GuaDef | undefined {
  return GUA_TABLE.find((g) => g.id === id);
}
