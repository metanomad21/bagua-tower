import { Application, Container, Graphics, Text } from 'pixi.js';
import type { RectTopology, Vec2 } from '../core/topology.ts';
import type { GameState } from '../core/gameState.ts';
import type { GuaId, RangeBand } from '../core/types.ts';
import { COMBO_TABLE } from '../data/combos.ts';
import { GUA_TABLE } from '../data/gua.ts';
import { CONFIG } from '../data/config.ts';

// ─────────────────────────────────────────────────────────────
// 表现层（GDD §11 View）。只订阅 core 状态来画，不持有游戏逻辑。
// 渲染战场 + 卦 + 环绕怪 + 词条特效 + HUD + 右侧合成列表 + 拖拽交互。
// ─────────────────────────────────────────────────────────────

const SCALE = 56;
const GUA_COLOR: Record<GuaId, number> = {
  qian: 0xf4d35e, kun: 0xb08968, zhen: 0x9b5de5, xun: 0x90be6d,
  kan: 0x4ea8de, li: 0xef476f, gen: 0x8d99ae, dui: 0xffd166,
};
const EL_COLOR: Record<string, number> = {
  金: 0xf4d35e, 水: 0x4ea8de, 火: 0xef476f, 土: 0xb08968, 雷: 0x9b5de5, 风: 0x90be6d,
};
const C_MOVE = 0x9d8cff;
const C_MERGE = 0xffd166;
const C_SWAP = 0xd98c5f;
const C_COMBO = 0x66e0c0;

const NAME: Record<string, string> = {};
for (const g of GUA_TABLE) NAME[g.id] = g.name;

type DragSource = { kind: 'stash'; index: number } | { kind: 'board'; cell: number } | null;

interface Vfx {
  type: 'proj' | 'flash' | 'num';
  pos: Vec2;
  kind: string;
  t: number;
  dur: number;
  from?: Vec2;
  amt?: number;
}

export class BoardView {
  readonly root = new Container();
  private boardLayer = new Container();
  private dynLayer = new Container();
  private vfxLayer = new Container();
  private stashLayer = new Container();
  private hud = new Container();
  private panel = new Container();
  private overlay = new Container();

  private infoText: Text;
  private hintText: Text;
  private drawBtn: Container;
  private waveBtn: Container;

  private vfx: Vfx[] = [];
  private drag: DragSource = null;
  private dragGhost: Container | null = null;
  private lastPhase = '';
  private clock = 0;
  private wasWave = false;
  private dragPointer: { x: number; y: number } | null = null;

  private boardW: number;
  private boardH: number;

  constructor(
    private app: Application,
    private state: GameState,
    private topo: RectTopology,
  ) {
    this.boardW = topo.cols * SCALE;
    this.boardH = topo.rows * SCALE;
    this.root.addChild(this.boardLayer, this.dynLayer, this.vfxLayer, this.stashLayer, this.hud, this.panel, this.overlay);

    this.buildBoard();
    this.buildMarkers();
    this.buildPanel();
    this.infoText = new Text({ text: '', style: { fill: 0xe8e3ff, fontSize: 16 } });
    this.hintText = new Text({ text: '', style: { fill: 0x9d8cff, fontSize: 15 } });
    this.drawBtn = this.makeButton('起卦', 90, 36, () => this.state.drawGua());
    this.waveBtn = this.makeButton('开始守波', 110, 36, () => this.state.startWave());
    this.buildHud();

    this.setupDragSurface();
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  // ── 静态战场 + 右侧面板 ─────────────────────────────────

  private buildBoard(): void {
    const m = 0.6 * SCALE;
    this.boardLayer.addChild(
      new Graphics().roundRect(-m, -m, this.boardW + m * 2, this.boardH + m * 2, 14).stroke({ width: 2, color: 0x3a3550 }),
    );
    for (let i = 0; i < this.topo.cellCount; i++) {
      const { r, c } = this.topo.coord(i);
      this.boardLayer.addChild(
        new Graphics().roundRect(c * SCALE + 2, r * SCALE + 2, SCALE - 4, SCALE - 4, 8).fill({ color: 0x171426 }).stroke({ width: 1, color: 0x2a2640 }),
      );
    }
  }

  private buildPanel(): void {
    this.panel.position.set(this.boardW + 0.6 * SCALE + 28, -0.4 * SCALE);
    let y = 0;
    this.panel.addChild(this.text('组合阵法', 0, y, 16, 0xffd166, false));
    y += 26;
    for (const c of COMBO_TABLE) {
      const head = `${NAME[c.pair[0]]}+${NAME[c.pair[1]]}  ${c.name}`;
      this.panel.addChild(this.text(head, 0, y, 13, 0xe8e3ff, false));
      this.panel.addChild(this.text(c.desc, 12, y + 16, 11, 0x9d8cff, false));
      y += 38;
    }
    y += 6;
    this.panel.addChild(this.text('合成升级', 0, y, 16, 0xffd166, false));
    this.panel.addChild(this.text('两个同卦同级 → 高一级', 0, y + 24, 12, 0xe8e3ff, false));
    this.panel.addChild(this.text('Lv1 · Lv2 · Lv3 · Lv4（封顶）', 0, y + 42, 12, 0x9d8cff, false));
  }

  /** 怪物起点（绿）/ 终点（红）标识，落在外圈怪道上（GDD §14②） */
  private buildMarkers(): void {
    const start = this.topo.orbitPoint(0);
    const end = this.topo.orbitPoint(CONFIG.enemy.endT);
    this.boardLayer.addChild(new Graphics().circle(start.x * SCALE, start.y * SCALE, 12).fill({ color: 0x6fe0a0 }).stroke({ width: 2, color: 0x0d0b14 }));
    this.boardLayer.addChild(this.text('起', start.x * SCALE, start.y * SCALE, 12, 0x0d2b18));
    this.boardLayer.addChild(new Graphics().circle(end.x * SCALE, end.y * SCALE, 12).fill({ color: 0xef476f }).stroke({ width: 2, color: 0x0d0b14 }));
    this.boardLayer.addChild(this.text('终', end.x * SCALE, end.y * SCALE, 12, 0x2b0d14));
  }

  // ── 每帧动态渲染 ───────────────────────────────────────

  private redrawDynamic(): void {
    this.dynLayer.removeChildren();
    const cb = this.state.combat;

    for (const z of cb.zones) {
      const col = z.kind === 'iceWall' ? 0x4ea8de : 0xef476f;
      this.dynLayer.addChild(new Graphics().circle(z.pos.x * SCALE, z.pos.y * SCALE, z.radius * SCALE).fill({ color: col, alpha: 0.15 }));
    }

    for (const i of this.state.board.occupiedIndices()) {
      const inst = this.state.board.occupant(i)!;
      const { r, c } = this.topo.coord(i);
      const x = c * SCALE;
      const y = r * SCALE;
      const tile = new Graphics().roundRect(x + 4, y + 4, SCALE - 8, SCALE - 8, 6).fill({ color: GUA_COLOR[inst.def.id] });
      if (inst.activeRiders.length > 0) tile.roundRect(x + 4, y + 4, SCALE - 8, SCALE - 8, 6).stroke({ width: 3, color: 0xffffff });
      this.dynLayer.addChild(tile);
      this.dynLayer.addChild(this.text(inst.def.name, x + SCALE / 2, y + SCALE / 2 - 5, 24, 0x141018));
      this.dynLayer.addChild(this.text(`Lv${inst.level}`, x + SCALE / 2, y + SCALE - 13, 11, 0x141018));
    }

    for (const e of cb.enemies) {
      const p = cb.enemyPos(e);
      const frac = Math.max(0.15, e.hp / e.maxHp);
      const slow = e.statuses.some((s) => s.kind === 'slow');
      const wet = e.statuses.some((s) => s.kind === 'wet');
      const col = slow ? 0x6fd0e0 : wet ? 0x4ea8de : 0xc94b6a;
      this.dynLayer.addChild(new Graphics().circle(p.x * SCALE, p.y * SCALE, 9).fill({ color: col }));
      this.dynLayer.addChild(new Graphics().rect(p.x * SCALE - 10, p.y * SCALE - 15, 20 * frac, 3).fill({ color: 0x7cfc8a }));
    }

    if (this.drag) this.drawDragHints();
  }

  private drawDragHints(): void {
    // 半透明攻击范围圈，跟随悬停格
    const hover = this.dragPointer ? this.cellOf(this.dragPointer.x, this.dragPointer.y) : null;
    const band = this.draggedRangeBand();
    if (hover != null && band) {
      const cc = this.topo.cellCenter(hover);
      const range = CONFIG.range[band] * SCALE;
      const col = this.draggedColor();
      this.dynLayer.addChild(
        new Graphics().circle(cc.x * SCALE, cc.y * SCALE, range).fill({ color: col, alpha: 0.08 }).stroke({ width: 1.5, color: col, alpha: 0.35 }),
      );
    }
    // 合法格高亮；可组合 / 可合成格闪烁反馈
    const pulse = 0.55 + 0.45 * Math.sin(this.clock * 9);
    for (let i = 0; i < this.topo.cellCount; i++) {
      const color = this.hintColor(i);
      if (color == null) continue;
      const blink = color === C_COMBO || color === C_MERGE;
      const { r, c } = this.topo.coord(i);
      this.dynLayer.addChild(
        new Graphics().roundRect(c * SCALE + 2, r * SCALE + 2, SCALE - 4, SCALE - 4, 8).stroke({ width: blink ? 4 : 3, color, alpha: blink ? pulse : 0.9 }),
      );
    }
  }

  private draggedRangeBand(): RangeBand | null {
    if (!this.drag) return null;
    if (this.drag.kind === 'stash') return this.state.stash[this.drag.index]?.base.range ?? null;
    return this.state.board.occupant(this.drag.cell)?.def.base.range ?? null;
  }

  private draggedColor(): number {
    if (!this.drag) return 0xffffff;
    const id = this.drag.kind === 'stash' ? this.state.stash[this.drag.index]?.id : this.state.board.occupant(this.drag.cell)?.def.id;
    return id ? GUA_COLOR[id] : 0xffffff;
  }

  private hintColor(i: number): number | null {
    const occ = this.state.board.occupant(i);
    if (this.drag!.kind === 'stash') {
      const def = this.state.stash[this.drag!.index];
      if (!def) return null;
      if (!occ) return this.wouldCombo(i, def.id) ? C_COMBO : C_MOVE;
      if (occ.def.id === def.id && occ.level === 1 && occ.level < def.maxLevel) return C_MERGE;
      return null;
    }
    const from = this.drag!.cell;
    if (i === from) return null;
    const src = this.state.board.occupant(from);
    if (!src) return null;
    if (!occ) return C_MOVE;
    if (occ.def.id === src.def.id && occ.level === src.level && occ.level < src.def.maxLevel) return C_MERGE;
    return C_SWAP;
  }

  private wouldCombo(cell: number, id: GuaId): boolean {
    for (const nb of this.topo.neighbors(cell)) {
      const o = this.state.board.occupant(nb);
      if (o && o.def.id !== id && this.state.combo.lookup(id, o.def.id)) return true;
    }
    return false;
  }

  // ── 特效系统（弹道 / 闪光 / 伤害数字）──────────────────

  private updateVfx(dt: number): void {
    for (const f of this.state.combat.fx) {
      if (f.from) this.vfx.push({ type: 'proj', from: f.from, pos: f.pos, kind: f.kind, t: 0, dur: 0.12 });
      this.vfx.push({ type: 'flash', pos: f.pos, kind: f.kind, t: 0, dur: 0.3 });
      if (f.amt) this.vfx.push({ type: 'num', pos: f.pos, kind: f.kind, amt: f.amt, t: 0, dur: 0.6 });
    }
    for (const v of this.vfx) v.t += dt;
    this.vfx = this.vfx.filter((v) => v.t < v.dur);

    this.vfxLayer.removeChildren();
    for (const v of this.vfx) {
      const col = EL_COLOR[v.kind] ?? 0xffffff;
      const p = v.t / v.dur;
      if (v.type === 'proj' && v.from) {
        const x = (v.from.x + (v.pos.x - v.from.x) * p) * SCALE;
        const y = (v.from.y + (v.pos.y - v.from.y) * p) * SCALE;
        this.vfxLayer.addChild(new Graphics().circle(x, y, 5).fill({ color: col }));
      } else if (v.type === 'flash') {
        this.vfxLayer.addChild(new Graphics().circle(v.pos.x * SCALE, v.pos.y * SCALE, 10 + p * 16).fill({ color: col, alpha: 0.55 * (1 - p) }));
      } else if (v.type === 'num' && v.amt) {
        const t = this.text(`-${Math.round(v.amt)}`, v.pos.x * SCALE, v.pos.y * SCALE - p * 28, 13, col);
        t.alpha = 1 - p;
        this.vfxLayer.addChild(t);
      }
    }
  }

  // ── HUD / 暂存 ─────────────────────────────────────────

  private buildHud(): void {
    this.infoText.position.set(0, -0.6 * SCALE - 30);
    this.hintText.position.set(0, this.boardH + 0.6 * SCALE + 10);
    this.drawBtn.position.set(0, this.boardH + 0.6 * SCALE + 38);
    this.waveBtn.position.set(100, this.boardH + 0.6 * SCALE + 38);
    this.stashLayer.position.set(0, this.boardH + 0.6 * SCALE + 84);
    this.hud.addChild(this.infoText, this.hintText, this.drawBtn, this.waveBtn);
  }

  private updateHud(): void {
    const s = this.state;
    const waveNo = s.waveIndex < 0 ? 0 : s.waveIndex + 1;
    this.infoText.text = `灵气 ${s.qi}    核心 ${s.combat.coreHp}    波次 ${waveNo}/${s.totalWaves}    ${this.phaseLabel()}`;
    const names = [...new Set(s.activeCombos.map((a) => a.def.name))];
    this.hintText.text = names.length ? `成阵：${names.join('  ')}` : '（相邻不同卦成阵；同卦同级合成）';
    this.waveBtn.visible = s.phase === 'building';
    this.drawBtn.visible = s.phase === 'building' || s.phase === 'wave';
  }

  private phaseLabel(): string {
    switch (this.state.phase) {
      case 'building': return '布阵中';
      case 'wave': return '守波中';
      case 'won': return '通关';
      case 'lost': return '败北';
    }
  }

  private buildStash(): void {
    this.stashLayer.removeChildren();
    this.stashLayer.addChild(this.text('暂存', 18, 14, 13, 0x9d8cff));
    this.state.stash.forEach((def, idx) => {
      const tile = new Container();
      tile.addChild(new Graphics().roundRect(0, 0, 44, 44, 6).fill({ color: GUA_COLOR[def.id] }));
      tile.addChild(this.text(def.name, 22, 22, 22, 0x141018));
      tile.position.set(48 + idx * 52, -8);
      tile.eventMode = 'static';
      tile.cursor = 'grab';
      tile.on('pointerdown', (e) => {
        e.stopPropagation();
        this.startDrag({ kind: 'stash', index: idx }, e.global.x, e.global.y, def.id);
      });
      this.stashLayer.addChild(tile);
    });
  }

  // ── 拖拽（暂存 + 盘上）─────────────────────────────────

  private setupDragSurface(): void {
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointerdown', (e) => this.onBoardPointerDown(e.global.x, e.global.y));
    this.app.stage.on('globalpointermove', (e) => this.onDragMove(e.global.x, e.global.y));
    this.app.stage.on('pointerup', (e) => this.endDrag(e.global.x, e.global.y));
    this.app.stage.on('pointerupoutside', () => this.cancelDrag());
  }

  private onBoardPointerDown(gx: number, gy: number): void {
    if (this.dragGhost) return;
    if (this.state.phase === 'won' || this.state.phase === 'lost') return;
    const cell = this.cellOf(gx, gy);
    if (cell == null) return;
    const occ = this.state.board.occupant(cell);
    if (!occ) return;
    this.startDrag({ kind: 'board', cell }, gx, gy, occ.def.id);
  }

  private startDrag(src: DragSource, gx: number, gy: number, id: GuaId): void {
    this.drag = src;
    this.dragPointer = { x: gx, y: gy };
    const ghost = new Container();
    ghost.addChild(new Graphics().roundRect(-22, -22, 44, 44, 6).fill({ color: GUA_COLOR[id], alpha: 0.85 }));
    ghost.addChild(this.text(NAME[id], 0, 0, 22, 0x141018));
    ghost.position.set(gx, gy);
    this.app.stage.addChild(ghost);
    this.dragGhost = ghost;
  }

  private onDragMove(gx: number, gy: number): void {
    this.dragPointer = { x: gx, y: gy };
    if (this.dragGhost) this.dragGhost.position.set(gx, gy);
  }

  private endDrag(gx: number, gy: number): void {
    if (!this.dragGhost || !this.drag) {
      this.cancelDrag();
      return;
    }
    const cell = this.cellOf(gx, gy);
    if (cell != null) {
      if (this.drag.kind === 'stash') this.state.dropFromStash(this.drag.index, cell);
      else this.state.dropFromBoard(this.drag.cell, cell);
    }
    this.cancelDrag();
  }

  private cancelDrag(): void {
    if (this.dragGhost) {
      this.dragGhost.destroy();
      this.dragGhost = null;
    }
    this.drag = null;
    this.dragPointer = null;
  }

  private cellOf(gx: number, gy: number): number | null {
    const local = this.boardLayer.toLocal({ x: gx, y: gy });
    const c = Math.floor(local.x / SCALE);
    const r = Math.floor(local.y / SCALE);
    if (c < 0 || c >= this.topo.cols || r < 0 || r >= this.topo.rows) return null;
    return this.topo.index(r, c);
  }

  // ── 胜负覆盖层（已去三选一）────────────────────────────

  private syncOverlay(): void {
    if (this.state.phase === this.lastPhase) return;
    this.lastPhase = this.state.phase;
    this.overlay.removeChildren();
    if (this.state.phase === 'won' || this.state.phase === 'lost') {
      const txt = this.state.phase === 'won' ? '通关！守住了中宫' : '败北 · 中宫被破';
      this.overlay.addChild(this.text(txt, this.boardW / 2, this.boardH / 2, 26, 0xffd166));
    }
  }

  // ── 帧更新 ─────────────────────────────────────────────

  update(dt: number): void {
    const d = Math.min(dt, 0.05);
    this.clock += d;
    this.state.tick(d);
    if (this.wasWave && this.state.phase !== 'wave') this.vfx = []; // 波末清残留特效
    this.wasWave = this.state.phase === 'wave';
    this.redrawDynamic();
    this.updateVfx(d);
    if (!this.dragGhost) this.buildStash();
    this.updateHud();
    this.syncOverlay();
  }

  // ── 工具 ───────────────────────────────────────────────

  private text(s: string, x: number, y: number, size: number, fill: number, center = true): Text {
    const t = new Text({ text: s, style: { fill, fontSize: size, fontWeight: 'bold', align: center ? 'center' : 'left' } });
    if (center) t.anchor.set(0.5);
    t.position.set(x, y);
    return t;
  }

  private makeButton(label: string, w: number, h: number, onTap: () => void): Container {
    const c = new Container();
    c.addChild(new Graphics().roundRect(0, 0, w, h, 8).fill({ color: 0x2a2547 }).stroke({ width: 1, color: 0x4a4570 }));
    const t = new Text({ text: label, style: { fill: 0xe8e3ff, fontSize: 14, align: 'center' } });
    t.anchor.set(0.5);
    t.position.set(w / 2, h / 2);
    c.addChild(t);
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', onTap);
    return c;
  }

  private layout(): void {
    this.root.position.set(
      Math.round((this.app.renderer.width - this.boardW) / 2 - 110),
      Math.round((this.app.renderer.height - this.boardH) / 2),
    );
  }
}
