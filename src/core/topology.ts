// ─────────────────────────────────────────────────────────────
// 网格拓扑接口（GDD §11 形状无关原则）。
// combo 引擎只依赖 neighbors()；战斗依赖几何（cellCenter/orbitPoint）。
// 换形状（§4 放射八卦盘）只替换此处实现，逻辑层与 data 不动。
// 几何单位 = 格；View 负责缩放为像素。
// ─────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface Topology {
  readonly cellCount: number;
  /** 拓扑相邻（无序，单格 ≤4，对应 §8.2 几何封顶） */
  neighbors(i: number): number[];
  /** 格中心坐标（单位=格），战斗测距与 View 定位共用 */
  cellCenter(i: number): Vec2;
  /** 环绕路径点，t∈[0,1) 绕盘一圈（单位=格） */
  orbitPoint(t: number): Vec2;
  /** 盘占用尺寸（单位=格），供 View 布局 */
  readonly width: number;
  readonly height: number;
}

/** 4×10 方形拓扑（MVP）。额外暴露 rows/cols/coord 供 View 渲染定位。 */
export class RectTopology implements Topology {
  /** 怪道相对盘边的外扩量（格） */
  private static readonly ORBIT_MARGIN = 0.6;

  constructor(
    readonly rows: number,
    readonly cols: number,
  ) {}

  get cellCount(): number {
    return this.rows * this.cols;
  }

  get width(): number {
    return this.cols;
  }

  get height(): number {
    return this.rows;
  }

  index(r: number, c: number): number {
    return r * this.cols + c;
  }

  coord(i: number): { r: number; c: number } {
    return { r: Math.floor(i / this.cols), c: i % this.cols };
  }

  inBounds(r: number, c: number): boolean {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  neighbors(i: number): number[] {
    const { r, c } = this.coord(i);
    const out: number[] = [];
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (this.inBounds(nr, nc)) out.push(this.index(nr, nc));
    }
    return out;
  }

  cellCenter(i: number): Vec2 {
    const { r, c } = this.coord(i);
    return { x: c + 0.5, y: r + 0.5 };
  }

  orbitPoint(t: number): Vec2 {
    const m = RectTopology.ORBIT_MARGIN;
    const x0 = -m;
    const y0 = -m;
    const x1 = this.cols + m;
    const y1 = this.rows + m;
    const w = x1 - x0;
    const h = y1 - y0;
    const per = 2 * (w + h);
    let d = (((t % 1) + 1) % 1) * per; // 归一化到 [0, per)
    if (d < w) return { x: x0 + d, y: y0 }; // 上边 L→R
    d -= w;
    if (d < h) return { x: x1, y: y0 + d }; // 右边 T→B
    d -= h;
    if (d < w) return { x: x1 - d, y: y1 }; // 下边 R→L
    d -= w;
    return { x: x0, y: y1 - d }; // 左边 B→T
  }
}
