import { Board } from './board.ts';
import { RNG } from './rng.ts';
import { ComboEngine, type ActiveCombo } from './comboEngine.ts';
import { CombatSystem } from './combat.ts';
import type { Topology } from './topology.ts';
import type { GuaDef, StashItem } from './types.ts';
import { GUA_TABLE } from '../data/gua.ts';
import { COMBO_TABLE } from '../data/combos.ts';
import { CONFIG } from '../data/config.ts';
import { WAVES, WAVE_BASE_HP, WAVE_HP_GROWTH } from '../data/waves.ts';
import { DIFFICULTIES, type Difficulty } from '../data/difficulty.ts';

// ─────────────────────────────────────────────────────────────
// 顶层状态容器（GDD §11 Core 层）。纯逻辑，零渲染依赖。
// 核心循环：起卦 → 放卦/合成 → 连阵 → 回合 → 续局（GDD §3，已去三选一）。
// 走高 = 自走棋合成（GDD §6.1）；拖拽语法见 GDD §7。
// ─────────────────────────────────────────────────────────────

export type DropResult = 'placed' | 'merged' | 'illegal';
export type MoveResult = 'moved' | 'merged' | 'swapped' | 'illegal';
export type DrawResult = { ok: true } | { ok: false; reason: 'no-qi' };

/** 局内阶段：布阵 / 回合 / 胜 / 负（无三选一） */
export type RunPhase = 'select' | 'building' | 'wave' | 'won' | 'lost';

export class GameState {
  readonly board: Board;
  readonly rng: RNG;
  readonly combo: ComboEngine;
  readonly combat: CombatSystem;

  qi = CONFIG.qi.starting;
  stash: StashItem[] = [];
  activeCombos: ActiveCombo[] = [];
  /** 整局已起卦次数（驱动成本递增，整局累加、不重置） */
  drawCount = 0;

  diff: Difficulty = DIFFICULTIES[0];
  phase: RunPhase = 'select';
  waveIndex = -1;

  private spawnQueue = 0;
  private spawnTimer = 0;

  constructor(topo: Topology, seed = 1) {
    this.board = new Board(topo);
    this.rng = new RNG(seed);
    this.combo = new ComboEngine(COMBO_TABLE);
    this.combat = new CombatSystem(this.board, topo, this.rng);
  }

  get drawCost(): number {
    return (CONFIG.qi.drawCost + this.drawCount * CONFIG.qi.costStep) * this.diff.drawCostMul;
  }
  get stashSlots(): number {
    return CONFIG.stashSlots;
  }
  get totalWaves(): number {
    return WAVES.length;
  }

  // ── 起卦（GDD §8）───────────────────────────────────────

  /** 起卦：清空暂存并重抽满 6 个（消耗一次起卦成本）。GDD §14④ */
  drawGua(): DrawResult {
    if (this.qi < this.drawCost) return { ok: false, reason: 'no-qi' };
    this.qi -= this.drawCost;
    this.drawCount += 1;
    this.stash = [];
    for (let k = 0; k < CONFIG.stashSlots; k++) {
      this.stash.push({ def: this.rng.pick(GUA_TABLE), level: 1 });
    }
    return { ok: true };
  }

  // ── 拖拽语法（GDD §7）───────────────────────────────────

  /** 从暂存区落子：空格放置 Lv1 / 同卦同级（即 Lv1）合成 / 否则非法 */
  dropFromStash(stashIndex: number, cellIndex: number): DropResult {
    const item = this.stash[stashIndex];
    if (!item) return 'illegal';
    const occ = this.board.occupant(cellIndex);
    let result: DropResult;
    if (!occ) {
      this.board.setOccupant(cellIndex, { def: item.def, level: item.level, cellIndex, activeRiders: [] });
      result = 'placed';
    } else if (occ.def.id === item.def.id && occ.level === item.level && occ.level < item.def.maxLevel) {
      occ.level += 1; // 同卦同级 → 高一级
      result = 'merged';
    } else {
      return 'illegal';
    }
    this.stash.splice(stashIndex, 1);
    this.recomputeCombos();
    return result;
  }

  /** 暂存内拖拽：同卦同级合成 / 否则交换位置（不触发 combo，GDD §7） */
  stashDrop(fromIndex: number, toIndex: number): 'merged' | 'swapped' | 'illegal' {
    if (fromIndex === toIndex) return 'illegal';
    const a = this.stash[fromIndex];
    const b = this.stash[toIndex];
    if (!a || !b) return 'illegal';
    if (a.def.id === b.def.id && a.level === b.level && b.level < b.def.maxLevel) {
      b.level += 1;
      this.stash.splice(fromIndex, 1);
      return 'merged';
    }
    this.stash[fromIndex] = b;
    this.stash[toIndex] = a;
    return 'swapped';
  }

  /** 盘上卦拖动：空格=移动 / 同卦同级=合成（消源格）/ 其他占用=交换。GDD §7 改版 */
  dropFromBoard(fromCell: number, toCell: number): MoveResult {
    if (fromCell === toCell) return 'illegal';
    const src = this.board.occupant(fromCell);
    if (!src) return 'illegal';
    const target = this.board.occupant(toCell);
    let result: MoveResult;

    if (!target) {
      this.board.setOccupant(toCell, src);
      src.cellIndex = toCell;
      this.board.setOccupant(fromCell, null);
      result = 'moved';
    } else if (target.def.id === src.def.id && target.level === src.level && target.level < src.def.maxLevel) {
      target.level += 1; // 同卦同级合成，消源格
      this.board.setOccupant(fromCell, null);
      result = 'merged';
    } else {
      this.board.setOccupant(toCell, src);
      src.cellIndex = toCell;
      this.board.setOccupant(fromCell, target);
      target.cellIndex = fromCell;
      result = 'swapped';
    }
    this.recomputeCombos();
    return result;
  }

  recomputeCombos(): void {
    this.activeCombos = this.combo.recompute(this.board);
  }

  /** 清空整局运行态（不改阶段） */
  private clearRun(): void {
    for (let i = 0; i < this.board.cellCount; i++) this.board.setOccupant(i, null);
    this.qi = CONFIG.qi.starting;
    this.stash = [];
    this.activeCombos = [];
    this.drawCount = 0;
    this.waveIndex = -1;
    this.spawnQueue = 0;
    this.spawnTimer = 0;
    this.combat.reset();
  }

  /** 回到难度选择面板 */
  toMenu(): void {
    this.clearRun();
    this.phase = 'select';
  }

  /** 选定难度并开始整局 */
  start(diff: Difficulty): void {
    this.diff = diff;
    this.clearRun();
    this.phase = 'building';
  }

  // ── 回合 / 续局（GDD §3，已去三选一）────────────────────

  /** 开始下一波（building → wave） */
  startWave(): void {
    if (this.phase !== 'building') return;
    this.waveIndex++;
    if (this.waveIndex >= WAVES.length) {
      this.phase = 'won';
      return;
    }
    this.spawnQueue = WAVES[this.waveIndex].count * this.diff.countMul;
    this.spawnTimer = 0;
    this.phase = 'wave';
  }

  tick(dt: number): void {
    if (this.phase !== 'wave') return;
    const w = WAVES[this.waveIndex];

    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const i = this.waveIndex;
        const hp = (WAVE_BASE_HP + i * WAVE_HP_GROWTH) * this.diff.hpMul * Math.pow(this.diff.hpPerWave, i);
        const speed = w.speed * this.diff.speedMul * Math.pow(this.diff.speedPerWave, i);
        this.combat.spawn(hp, speed);
        this.spawnQueue--;
        this.spawnTimer = w.interval;
      }
    }

    this.combat.update(dt);

    // 经济：击杀掉的灵气实时入账
    if (this.combat.coins > 0) {
      this.qi += this.combat.coins;
      this.combat.coins = 0;
    }

    if (this.combat.coreHp <= 0) {
      this.phase = 'lost';
      return;
    }

    // 本回合清完 → 回布阵（灵气靠击杀即时获得，无回合奖励 / 三选一）；最后一回合则通关
    if (this.spawnQueue === 0 && this.combat.enemies.length === 0) {
      this.combat.clearTransients();
      this.phase = this.waveIndex >= WAVES.length - 1 ? 'won' : 'building';
    }
  }
}
