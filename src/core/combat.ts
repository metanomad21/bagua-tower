import type { Board } from './board.ts';
import type { Topology, Vec2 } from './topology.ts';
import type { Enemy, GuaInstance, EnemyStatus } from './types.ts';
import type { RNG } from './rng.ts';
import { effectiveStats, type EffStats } from './stats.ts';
import { CONFIG } from '../data/config.ts';

// ─────────────────────────────────────────────────────────────
// 战斗系统（GDD §4/§5）。纯逻辑，零渲染依赖。单位 = 格。
// 实现 5 个词条动词执行器（GDD §8.3）：
//   statMod    → stats.effectiveStats（攻击属性折算）
//   applyStatus→ 命中给怪挂 slow/wet 等
//   onHit      → 命中触发次级效果（连锁闪电/金剑/蒸汽爆）
//   onKill     → 击杀掉铜钱（经济）
//   zone       → 地面持续区域（火地/冰墙）
// ─────────────────────────────────────────────────────────────

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

interface Zone {
  pos: Vec2;
  radius: number;
  kind: string;
  dmg: number;
  until: number;
}

/** 本帧命中特效（View 读取后清空，爆屏反馈用） */
export interface Fx {
  pos: Vec2;
  kind: string; // 五行或效果名
  from?: Vec2; // 攻击来源（塔位），用于画弹道
  amt?: number; // 伤害值，用于伤害数字
}

export class CombatSystem {
  enemies: Enemy[] = [];
  zones: Zone[] = [];
  coreHp = CONFIG.core.hp;
  coins = 0;
  globalDamageMul = 1;
  fx: Fx[] = [];

  private nextId = 1;
  private cooldowns = new Map<number, number>();

  constructor(
    private board: Board,
    private topo: Topology,
    private rng: RNG,
  ) {}

  spawn(hp: number, speed: number): void {
    this.enemies.push({
      id: this.nextId++,
      hp,
      maxHp: hp,
      speed,
      orbitPos: 0, // 统一从起点刷出（GDD §14②）
      statuses: [],
    });
  }

  enemyPos(e: Enemy): Vec2 {
    return this.topo.orbitPoint(e.orbitPos);
  }

  update(dt: number): void {
    this.fx = [];
    this.moveEnemies(dt);
    this.updateZones(dt);
    this.towersFire(dt);
    this.enemies = this.enemies.filter((e) => e.hp > 0 && !e.reachedEnd);
  }

  /** 波次结束清场：清掉地面区域 / 命中特效 / 攻击冷却（GDD §3 续局前） */
  clearTransients(): void {
    this.zones = [];
    this.fx = [];
    this.cooldowns.clear();
  }

  private moveEnemies(dt: number): void {
    for (const e of this.enemies) {
      let speedMul = 1;
      for (const s of e.statuses) {
        if (s.until !== undefined) s.until -= dt;
        if (s.kind === 'slow') speedMul *= 1 - (s.amount ?? 0);
        if (s.kind === 'burn') e.hp -= (s.amount ?? 0) * dt;
      }
      e.statuses = e.statuses.filter((s) => (s.until ?? 1) > 0);
      e.orbitPos += e.speed * speedMul * dt;
      if (e.orbitPos >= CONFIG.enemy.endT) {
        // 抵达终点 → 接触抵消、扣核心耐久（GDD §14② 败北条件）
        this.coreHp -= CONFIG.enemy.leakDamage;
        e.reachedEnd = true;
      }
    }
  }

  private updateZones(dt: number): void {
    for (const z of this.zones) {
      z.until -= dt;
      for (const e of this.enemies) {
        if (dist(this.enemyPos(e), z.pos) > z.radius) continue;
        if (z.dmg > 0) e.hp -= z.dmg * dt;
        if (z.kind === 'iceWall' && !e.statuses.some((s) => s.kind === 'slow')) {
          e.statuses.push({ kind: 'slow', amount: 0.5, until: 0.3 });
        }
      }
    }
    this.zones = this.zones.filter((z) => z.until > 0);
  }

  private towersFire(dt: number): void {
    for (const i of this.board.occupiedIndices()) {
      let cd = (this.cooldowns.get(i) ?? 0) - dt;
      if (cd <= 0) {
        const tower = this.board.occupant(i)!;
        const st = effectiveStats(tower);
        const fired = this.fire(i, tower, st);
        cd = fired ? st.cooldown : CONFIG.combat.retryCd;
      }
      this.cooldowns.set(i, cd);
    }
  }

  private nearestEnemy(from: Vec2, range: number, exclude?: Enemy): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e === exclude || e.hp <= 0) continue;
      const d = dist(from, this.enemyPos(e));
      if (d <= range && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  private damage(e: Enemy, amt: number, killer: GuaInstance): void {
    if (e.hp <= 0) return;
    e.hp -= amt * this.globalDamageMul;
    if (e.hp <= 0) {
      // onKill 词条
      for (const r of killer.activeRiders) {
        if (r.verb === 'onKill' && r.params.drop === 'coin') {
          this.coins += Number(r.params.amount ?? 1);
        }
      }
    }
  }

  private fire(cellIndex: number, tower: GuaInstance, st: EffStats): boolean {
    const tpos = this.topo.cellCenter(cellIndex);
    const target = this.nearestEnemy(tpos, st.range);
    if (!target) return false;

    const tp = this.enemyPos(target);
    this.damage(target, st.damage, tower);
    this.fx.push({ pos: tp, kind: tower.def.element, from: this.topo.cellCenter(cellIndex), amt: st.damage });

    if (st.aoe > 0) {
      for (const e of this.enemies) {
        if (e !== target && dist(this.enemyPos(e), tp) <= st.aoe) {
          this.damage(e, st.damage * CONFIG.combat.aoeFalloff, tower);
        }
      }
    }

    this.applyRiders(tower, target);
    return true;
  }

  /** onHit / applyStatus / zone 三类动词的执行（statMod 在 stats，onKill 在 damage） */
  private applyRiders(tower: GuaInstance, target: Enemy): void {
    const m = tower.def.levelMultipliers[tower.level - 1] ?? 1;
    const tp = this.enemyPos(target);

    for (const r of tower.activeRiders) {
      const scale = r.scalesWithLevel ? m : 1;
      const p = r.params;

      if (r.verb === 'applyStatus') {
        target.statuses.push({
          kind: String(p.status) as EnemyStatus['kind'],
          amount: Number(p.amount ?? 0),
          until: Number(p.dur ?? 1),
        });
      } else if (r.verb === 'onHit') {
        switch (String(p.effect)) {
          case 'chainLightning': {
            const near = this.nearestEnemy(tp, 3, target);
            if (near) {
              this.damage(near, Number(p.dmg) * scale, tower);
              this.fx.push({ pos: this.enemyPos(near), kind: '雷' });
            }
            break;
          }
          case 'goldSword':
            if (this.rng.next() < Number(p.chance ?? 0.3)) {
              this.damage(target, Number(p.dmg) * scale, tower);
            }
            break;
          case 'steamBurst':
            if (target.statuses.some((s) => s.kind === 'wet')) {
              this.damage(target, Number(p.dmg) * scale, tower);
              this.fx.push({ pos: tp, kind: '水' });
            }
            break;
        }
      } else if (r.verb === 'zone') {
        this.zones.push({
          pos: tp,
          radius: 1.5,
          kind: String(p.effect),
          dmg: Number(p.dmg ?? 0) * scale,
          until: Number(p.dur ?? 2),
        });
      }
    }
  }
}
