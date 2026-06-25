import { Application, Container, Graphics, Text } from 'pixi.js';
import type { RectTopology, Vec2 } from '../core/topology.ts';
import type { GameState } from '../core/gameState.ts';
import type { GuaId, RangeBand } from '../core/types.ts';
import { COMBO_TABLE } from '../data/combos.ts';
import { GUA_TABLE } from '../data/gua.ts';
import { CONFIG } from '../data/config.ts';
import { EffectsLayer, damageNumber, qiPickup, coinBurst } from './effects.ts';

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

// 攻击特效已由 effects.ts 的 Effect 系统驱动

export class BoardView {
  readonly root = new Container();
  private boardLayer = new Container();
  private dynLayer = new Container();
  private effects = new EffectsLayer();
  private stashLayer = new Container();
  private hud = new Container();
  private panel = new Container();
  private overlay = new Container();
  private livePanel = new Container();
  private towerLayer = new Container();

  private infoText: Text;
  private costText: Text;
  private drawBtn: Container;
  private waveBtn: Container;

  private attackFlash = new Map<number, number>();
  private drag: DragSource = null;
  private dragGhost: Container | null = null;
  private lastPhase = '';
  private clock = 0;
  private wasWave = false;
  private dragPointer: { x: number; y: number } | null = null;
  private dirty = true; // 状态驱动层（塔/暂存/阵法面板）需重建

  private boardW: number;
  private boardH: number;

  constructor(
    private app: Application,
    private state: GameState,
    private topo: RectTopology,
  ) {
    this.boardW = topo.cols * SCALE;
    this.boardH = topo.rows * SCALE;
    this.root.addChild(this.boardLayer, this.towerLayer, this.dynLayer, this.effects.container, this.stashLayer, this.hud, this.panel, this.livePanel, this.overlay);

    this.buildBoard();
    this.buildMarkers();
    this.buildPanel();
    this.infoText = new Text({ text: '', style: { fill: 0xe8e3ff, fontSize: 16 } });
    this.costText = new Text({ text: '', style: { fill: 0x9d8cff, fontSize: 14 } });
    this.drawBtn = this.makeButton('起卦', 90, 36, () => {
      this.state.drawGua();
      this.dirty = true;
    });
    this.waveBtn = this.makeButton('开始回合', 110, 36, () => this.state.startWave());
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
    this.clearContainer(this.dynLayer);
    const cb = this.state.combat;

    for (const z of cb.zones) this.drawZone(z);

    // 组合塔边框脉冲（仅 Graphics，每帧重画并销毁）
    for (const i of this.state.board.occupiedIndices()) {
      const inst = this.state.board.occupant(i)!;
      if (inst.activeRiders.length === 0) continue;
      const { r, c } = this.topo.coord(i);
      const a = 0.4 + 0.35 * Math.sin(this.clock * 6) + (this.attackFlash.has(i) ? 0.5 : 0);
      this.dynLayer.addChild(
        new Graphics().roundRect(c * SCALE + 4, r * SCALE + 4, SCALE - 8, SCALE - 8, 6).stroke({ width: 3, color: 0xffffff, alpha: Math.min(1, a) }),
      );
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

  /** 卦象塔（状态驱动重建：色块 + 卦名 + 等级）。Text 仅在变化时创建，避免每帧泄漏 */
  private rebuildTowers(): void {
    this.clearContainer(this.towerLayer);
    for (const i of this.state.board.occupiedIndices()) {
      const inst = this.state.board.occupant(i)!;
      const { r, c } = this.topo.coord(i);
      const x = c * SCALE;
      const y = r * SCALE;
      this.towerLayer.addChild(new Graphics().roundRect(x + 4, y + 4, SCALE - 8, SCALE - 8, 6).fill({ color: GUA_COLOR[inst.def.id] }));
      this.towerLayer.addChild(this.text(inst.def.name, x + SCALE / 2, y + SCALE / 2 - 5, 24, 0x141018));
      this.towerLayer.addChild(this.text(`Lv${inst.level}`, x + SCALE / 2, y + SCALE - 13, 11, 0x141018));
    }
  }

  /** 移除并销毁容器全部子项（释放 Text 纹理 / Graphics 几何） */
  private clearContainer(c: Container): void {
    for (const child of c.removeChildren()) child.destroy({ children: true });
  }

  /** 区域特效：火苗带 / 结晶冰墙（GDD §10）。坐标=格×SCALE */
  private drawZone(z: { pos: Vec2; radius: number; kind: string }): void {
    const cx = z.pos.x * SCALE;
    const cy = z.pos.y * SCALE;
    const r = z.radius * SCALE;
    const g = new Graphics();
    if (z.kind === 'iceWall') {
      const pts: number[] = [];
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rad = r * (i % 2 ? 1 : 0.62);
        pts.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      g.poly(pts).fill({ color: 0x9fd8f0, alpha: 0.3 }).stroke({ width: 2, color: 0xd8f4ff, alpha: 0.65 });
    } else {
      g.circle(cx, cy, r).fill({ color: 0xff8c42, alpha: 0.12 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const fl = 0.6 + 0.4 * Math.sin(this.clock * 9 + i * 1.7);
        const bx = cx + Math.cos(a) * r * 0.5;
        const by = cy + Math.sin(a) * r * 0.5;
        g.poly([bx - 4, by, bx, by - 15 * fl, bx + 4, by]).fill({ color: i % 2 ? 0xffe066 : 0xef476f, alpha: 0.7 });
      }
    }
    this.dynLayer.addChild(g);
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
    if (this.drag.kind === 'stash') return this.state.stash[this.drag.index]?.def.base.range ?? null;
    return this.state.board.occupant(this.drag.cell)?.def.base.range ?? null;
  }

  private draggedColor(): number {
    if (!this.drag) return 0xffffff;
    const id = this.drag.kind === 'stash' ? this.state.stash[this.drag.index]?.def.id : this.state.board.occupant(this.drag.cell)?.def.id;
    return id ? GUA_COLOR[id] : 0xffffff;
  }

  private hintColor(i: number): number | null {
    const occ = this.state.board.occupant(i);
    if (this.drag!.kind === 'stash') {
      const item = this.state.stash[this.drag!.index];
      if (!item) return null;
      if (!occ) return this.wouldCombo(i, item.def.id) ? C_COMBO : C_MOVE;
      if (occ.def.id === item.def.id && occ.level === item.level && occ.level < item.def.maxLevel) return C_MERGE;
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

  private consumeEvents(): void {
    for (const ev of this.state.combat.events) {
      if (ev.t === 'attack') {
        this.effects.spawn(ev);
        this.attackFlash.set(this.topo.index(Math.floor(ev.from.y), Math.floor(ev.from.x)), 0.15);
      } else if (ev.t === 'rider') {
        this.effects.spawn(ev);
      } else if (ev.t === 'dmg') {
        const col = EL_COLOR[ev.kind] ?? 0xffffff;
        this.effects.addEffect(damageNumber({ x: ev.pos.x * SCALE, y: ev.pos.y * SCALE }, ev.amt, col));
      } else if (ev.t === 'kill' && ev.coins > 0) {
        const p = { x: ev.pos.x * SCALE, y: ev.pos.y * SCALE };
        this.effects.addEffect(coinBurst(p));
        const n = Math.min(ev.coins, 9);
        for (let k = 0; k < n; k++) {
          const jp = { x: p.x + (k - (n - 1) / 2) * 12, y: p.y };
          this.effects.addEffect(qiPickup(jp, { x: 30, y: this.infoText.y }, k * 0.12));
        }
      }
    }
    this.state.combat.events = []; // 消费后清空，避免非战斗帧重复重放最后一帧事件
  }

  // ── HUD / 暂存 ─────────────────────────────────────────

  private buildHud(): void {
    this.infoText.position.set(0, -0.6 * SCALE - 30);
    this.drawBtn.position.set(0, this.boardH + 0.6 * SCALE + 14);
    this.costText.position.set(100, this.boardH + 0.6 * SCALE + 24);
    this.waveBtn.position.set(this.boardW - 110, this.boardH + 0.6 * SCALE + 14);
    this.stashLayer.position.set(0, this.boardH + 0.6 * SCALE + 90);
    this.livePanel.position.set(-150, -0.4 * SCALE);
    this.hud.addChild(this.infoText, this.drawBtn, this.waveBtn, this.costText);
  }

  /** 左侧「场上阵法」：实时列出当前有效组合及层数（×N） */
  private updateLivePanel(): void {
    this.clearContainer(this.livePanel);
    this.livePanel.addChild(this.text('场上阵法', 0, 0, 16, 0xffd166, false));
    const counts = new Map<string, number>();
    for (const a of this.state.activeCombos) counts.set(a.def.name, (counts.get(a.def.name) ?? 0) + 1);
    if (counts.size === 0) {
      this.livePanel.addChild(this.text('（暂无）', 0, 26, 13, 0x6b6580, false));
      return;
    }
    let y = 26;
    for (const [name, n] of counts) {
      this.livePanel.addChild(this.text(n > 1 ? `${name} ×${n}` : name, 0, y, 14, 0xe8e3ff, false));
      y += 22;
    }
  }

  private updateHud(): void {
    const s = this.state;
    const waveNo = s.waveIndex < 0 ? 0 : s.waveIndex + 1;
    this.infoText.text = `灵气 ${s.qi}    HP ${s.combat.coreHp}    回合 ${waveNo}/${s.totalWaves}    ${this.phaseLabel()}`;
    this.waveBtn.visible = s.phase === 'building';
    this.drawBtn.visible = s.phase === 'building' || s.phase === 'wave';
    this.costText.text = `消耗 ${s.drawCost} 灵气`;
    this.costText.visible = this.drawBtn.visible;
  }

  private phaseLabel(): string {
    switch (this.state.phase) {
      case 'building': return '布阵中';
      case 'wave': return '回合中';
      case 'won': return '通关';
      case 'lost': return '败北';
    }
  }

  private buildStash(): void {
    this.clearContainer(this.stashLayer);
    const slotX = (s: number): number => 12 + s * 52;
    const slots = CONFIG.stashSlots + 1; // 含 🐢 槽
    // 外框 + 空槽底色（与棋盘风格一致）
    this.stashLayer.addChild(new Graphics().roundRect(slotX(0) - 6, -16, slots * 52 + 4, 60, 12).stroke({ width: 2, color: 0x3a3550 }));
    for (let s = 0; s < slots; s++) {
      this.stashLayer.addChild(
        new Graphics().roundRect(slotX(s), -8, 44, 44, 6).fill({ color: 0x171426 }).stroke({ width: 1, color: 0x2a2640 }),
      );
    }
    // 🐢 水平竖直居中于第 0 槽
    this.stashLayer.addChild(this.text('🐢', slotX(0) + 22, 14, 30, 0xe8e3ff));
    this.state.stash.forEach((item, idx) => {
      const tile = new Container();
      tile.addChild(new Graphics().roundRect(0, 0, 44, 44, 6).fill({ color: GUA_COLOR[item.def.id] }));
      tile.addChild(this.text(item.def.name, 22, 20, 22, 0x141018));
      if (item.level > 1) tile.addChild(this.text(`Lv${item.level}`, 22, 37, 10, 0x141018));
      tile.position.set(slotX(idx + 1), -8);
      tile.eventMode = 'static';
      tile.cursor = 'grab';
      tile.on('pointerdown', (e) => {
        e.stopPropagation();
        this.startDrag({ kind: 'stash', index: idx }, e.global.x, e.global.y, item.def.id);
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
    if (this.drag.kind === 'stash') {
      const sIdx = this.stashSlotAt(gx, gy);
      if (sIdx != null && sIdx !== this.drag.index) {
        this.state.stashDrop(this.drag.index, sIdx); // 暂存内合成/交换
      } else {
        const cell = this.cellOf(gx, gy);
        if (cell != null) this.state.dropFromStash(this.drag.index, cell);
      }
    } else {
      const cell = this.cellOf(gx, gy);
      if (cell != null) this.state.dropFromBoard(this.drag.cell, cell);
    }
    this.dirty = true; // 棋盘/暂存可能变化，触发状态层重建
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

  private stashSlotAt(gx: number, gy: number): number | null {
    const p = this.stashLayer.toLocal({ x: gx, y: gy });
    for (let i = 0; i < this.state.stash.length; i++) {
      const tx = 12 + (i + 1) * 52;
      if (p.x >= tx && p.x <= tx + 44 && p.y >= -8 && p.y <= 36) return i;
    }
    return null;
  }

  // ── 胜负覆盖层（已去三选一）────────────────────────────

  private syncOverlay(): void {
    if (this.state.phase === this.lastPhase) return;
    this.lastPhase = this.state.phase;
    this.clearContainer(this.overlay);
    if (this.state.phase === 'won' || this.state.phase === 'lost') {
      const win = this.state.phase === 'won';
      const accent = win ? 0xffd166 : 0xef476f;
      // 暗化背景，聚焦弹窗
      this.overlay.addChild(
        new Graphics().rect(-0.6 * SCALE, -0.6 * SCALE, this.boardW + 1.2 * SCALE, this.boardH + 1.2 * SCALE).fill({ color: 0x0d0b14, alpha: 0.62 }),
      );
      // 居中弹窗面板（胜负通用）
      const pw = 300;
      const ph = 150;
      const px = this.boardW / 2 - pw / 2;
      const py = this.boardH / 2 - ph / 2;
      this.overlay.addChild(new Graphics().roundRect(px, py, pw, ph, 14).fill({ color: 0x1b1730 }).stroke({ width: 2, color: accent }));
      this.overlay.addChild(this.text(win ? '通关！守住了中宫' : '败北 · 中宫被破', this.boardW / 2, py + 50, 24, accent));
      const btn = this.makeButton('重新开始', 130, 42, () => this.restart());
      btn.position.set(this.boardW / 2 - 65, py + ph - 62);
      this.overlay.addChild(btn);
    }
  }

  private restart(): void {
    this.state.reset();
    this.effects.clear();
    this.attackFlash.clear();
    this.dirty = true;
  }

  // ── 帧更新 ─────────────────────────────────────────────

  update(dt: number): void {
    const d = Math.min(dt, 0.05);
    this.clock += d;
    this.state.tick(d);
    this.consumeEvents();
    if (this.wasWave && this.state.phase !== 'wave') {
      this.attackFlash.clear(); // 在播特效让其自然播完，只清边框闪烁计时
    }
    this.wasWave = this.state.phase === 'wave';
    for (const [k, v] of this.attackFlash) {
      const nv = v - d;
      if (nv <= 0) this.attackFlash.delete(k);
      else this.attackFlash.set(k, nv);
    }
    this.redrawDynamic();
    this.effects.update(d);
    if (this.dirty && !this.dragGhost) {
      this.rebuildTowers();
      this.buildStash();
      this.updateLivePanel();
      this.dirty = false;
    }
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
      Math.round((this.app.renderer.width - this.boardW) / 2 - 40),
      Math.round((this.app.renderer.height - this.boardH) / 2),
    );
  }
}
