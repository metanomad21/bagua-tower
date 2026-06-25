// ─────────────────────────────────────────────────────────────
// 全局可调参数（占位值，最终数值见 GDD §14③/§14④）。策划可热改。
// ─────────────────────────────────────────────────────────────

export const CONFIG = {
  board: { rows: 4, cols: 10 },
  qi: {
    starting: 12, // 开局灵气
    drawCost: 3, // 每次起卦消耗
    costStep: 1, // 每次起卦成本递增（整局累加，不重置）
  },
  stashSlots: 6, // 暂存槽上限（一次起卦清空并填满 6 个）
  // 射程档位 → 格单位（占位）
  range: { short: 2, mid: 3.5, long: 6 },
  // 核心耐久（败北条件，MVP 默认，待 §14②）
  core: { hp: 20 },
  enemy: { leakDamage: 1, endT: 0.97 }, // 终点 orbitPos 阈值；抵达扣核心耐久
  combat: { aoeFalloff: 0.5, retryCd: 0.1 },
} as const;
