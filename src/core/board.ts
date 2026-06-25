import type { GuaInstance } from './types.ts';
import type { Topology } from './topology.ts';

// ─────────────────────────────────────────────────────────────
// 与形状无关的棋盘：持有占用数组 + 一个拓扑。
// combo 引擎只通过 Board 访问占用与相邻，不感知具体形状。
// ─────────────────────────────────────────────────────────────

export class Board {
  private cells: (GuaInstance | null)[];

  constructor(readonly topo: Topology) {
    this.cells = new Array(topo.cellCount).fill(null);
  }

  get cellCount(): number {
    return this.topo.cellCount;
  }

  neighbors(i: number): number[] {
    return this.topo.neighbors(i);
  }

  occupant(i: number): GuaInstance | null {
    return this.cells[i] ?? null;
  }

  setOccupant(i: number, g: GuaInstance | null): void {
    this.cells[i] = g;
  }

  occupiedIndices(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i]) out.push(i);
    }
    return out;
  }
}
