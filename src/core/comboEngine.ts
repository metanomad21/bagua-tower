import type { Board } from './board.ts';
import type { ComboDef, GuaId } from './types.ts';

// ─────────────────────────────────────────────────────────────
// Combo 词条引擎（GDD §8）。模型 B（叠加挂载）。
// combo = 一条相邻无序卦对，给双方各挂一个词条；词条挂在卦的基础攻击上。
// 引擎不关心盘形状，只通过 Board 访问占用与相邻。
// ─────────────────────────────────────────────────────────────

/** 无序卦对的 key */
export function comboKey(a: GuaId, b: GuaId): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

export interface ActiveCombo {
  def: ComboDef;
  cells: [number, number];
}

export class ComboEngine {
  private table = new Map<string, ComboDef>();

  constructor(combos: ComboDef[]) {
    for (const c of combos) {
      this.table.set(comboKey(c.pair[0], c.pair[1]), c);
    }
  }

  lookup(a: GuaId, b: GuaId): ComboDef | undefined {
    return this.table.get(comboKey(a, b));
  }

  /**
   * 每次放卦/叠级后调用：清空所有卦的 activeRiders，扫描相邻无序卦对，
   * 把每条边的词条挂回双方（单卦累计 ≤4，几何封顶 §8.2）。
   * 同卦相邻不触发 combo（同卦走原地叠级 §6.1）。
   * 返回激活的 combo 列表（供 UI 提示「成阵」）。
   */
  recompute(board: Board): ActiveCombo[] {
    const occupied = board.occupiedIndices();
    for (const i of occupied) {
      board.occupant(i)!.activeRiders = [];
    }

    const active: ActiveCombo[] = [];
    const seenEdge = new Set<string>();

    for (const i of occupied) {
      const a = board.occupant(i)!;
      for (const j of board.neighbors(i)) {
        const b = board.occupant(j);
        if (!b) continue;
        if (a.def.id === b.def.id) continue; // 同卦相邻无 combo

        const edge = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seenEdge.has(edge)) continue;
        seenEdge.add(edge);

        const def = this.lookup(a.def.id, b.def.id);
        if (!def) continue;

        // 把该 combo 的词条按 to 分发给对应的卦
        for (const { to, rider } of def.riders) {
          const target = a.def.id === to ? a : b.def.id === to ? b : null;
          if (target) target.activeRiders.push(rider);
        }
        active.push({ def, cells: [i, j] });
      }
    }
    return active;
  }
}
