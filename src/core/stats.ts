import type { GuaInstance } from './types.ts';
import { CONFIG } from '../data/config.ts';

// 有效属性 = 基础 × 等级倍率（走高）+ statMod 词条（走宽）。GDD §6 / §8.3。
// 这是「statMod」动词的执行：把所有 statMod 词条折算进最终攻击属性。

export interface EffStats {
  damage: number;
  cooldown: number;
  range: number;
  aoe: number;
}

export function effectiveStats(g: GuaInstance): EffStats {
  const m = g.def.levelMultipliers[g.level - 1] ?? 1;
  let damage = g.def.base.damage * m;
  let cooldown = g.def.base.cooldown;
  let range = CONFIG.range[g.def.base.range];
  let aoe = g.def.base.aoe;

  for (const r of g.activeRiders) {
    if (r.verb !== 'statMod') continue;
    const p = r.params;
    switch (String(p.stat)) {
      case 'damage':
        if (p.mul) damage *= Number(p.mul);
        if (p.add) damage += Number(p.add);
        break;
      case 'range':
        if (p.mul) range *= Number(p.mul);
        if (p.add) range += Number(p.add);
        break;
      case 'aoe':
        if (p.mul) aoe *= Number(p.mul);
        if (p.add) aoe += Number(p.add);
        break;
      case 'cooldown':
        if (p.mul) cooldown *= Number(p.mul);
        break;
    }
  }
  return { damage, cooldown, range, aoe };
}
