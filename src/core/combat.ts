import type { Board } from './board.ts';
import type { Topology, Vec2 } from './topology.ts';
import type { Enemy, GuaInstance, EnemyStatus, GuaId } from './types.ts';
import type { RNG } from './rng.ts';
import { effectiveStats, type EffStats } from './stats.ts';
import { CONFIG } from '../data/config.ts';

// ─────────────────────────────────────────────────────────────
// 战斗系统（GDD §4/§5）。纯逻辑，零渲染依赖。单位 = 格。
// 实现 5 个词条动词执行器（GDD §8.3）：
//   statMod    → stats.effectiveStats（攻击属性折算）
//   applyStatus→ 命中给怪挂 slow/wet 等
//   onHit      → 命中触发次级效果（连锁闪电/金剑/蒸汽爆）
//   onKill     → 击杀掉灵气（经济）
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

/** 本帧战斗事件（View 读取后清空，驱动特效；GDD §5/§9） */
export type CombatEvent =
  | { t: 'attack'; gua: GuaId; level: number; from: Vec2; to: Vec2; aoe: number; delay: number }
  | { t: 'rider'; effect: string; to: Vec2; from?: Vec2 }
  | { t: 'dmg'; pos: Vec2; amt: number; kind: string }
  | { t: 'kill'; pos: Vec2; coins: number };

/** 各卦命中延迟（秒）：飞行物≈弹道时长、瞬发≈0。伤害在命中时刻才结算 */
const IMPACT_DELAY: Record<GuaId, number> = {
  qian: 0.14, kun: 0.1, zhen: 0.05, xun: 0.06, kan: 0.14, li: 0.16, gen: 0.18, dui: 0.15,
};

interface PendingHit {
  tower: GuaInstance;
  target: Enemy;
  damage: number;
  aoe: number;
  left: number;
}

export class CombatSystem {
  enemies: Enemy[] = [];
  zones: Zone[] = [];
  coreHp = CONFIG.core.hp;
  coins = 0;
  globalDamageMul = 1;
  events: CombatEvent[] = [];

  private nextId = 1;
  private cooldowns = new Map<number, number>();
  private pending: PendingHit[] = [];

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
    this.events = [];
    this.moveEnemies(dt);
    this.updateZones(dt);
    this.resolvePending(dt);
    this.towersFire(dt);
    this.enemies = this.enemies.filter((e) => e.hp > 0 && !e.reachedEnd);
  }

  /** 回合结束清场：地面区域 / 在途命中 / 攻击冷却。events 不清（留给 View 消费本帧事件） */
  clearTransients(): void {
    this.zones = [];
    this.pending = [];
    this.cooldowns.clear();
  }

  /** 重开整局：清空全部战斗状态 */
  reset(): void {
    this.enemies = [];
    this.zones = [];
    this.events = [];
    this.pending = [];
    this.coins = 0;
    this.coreHp = CONFIG.core.hp;
    this.globalDamageMul = 1;
    this.cooldowns.clear();
    this.nextId = 1;
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
      let gained = 1; // 击杀基础 +1 灵气（GDD §14④），即时结算
      for (const r of killer.activeRiders) {
        if (r.verb === 'onKill' && r.params.drop === 'coin') gained += Number(r.params.amount ?? 1);
      }
      this.coins += gained;
      this.events.push({ t: 'kill', pos: this.enemyPos(e), coins: gained });
    }
  }

  private fire(cellIndex: number, tower: GuaInstance, st: EffStats): boolean {
    const tpos = this.topo.cellCenter(cellIndex);
    const target = this.nearestEnemy(tpos, st.range);
    if (!target) return false;

    const delay = IMPACT_DELAY[tower.def.id] ?? 0.12;
    // 只发攻击事件让弹道飞；伤害推迟到命中时刻（resolvePending）才结算，使掉血与命中对齐
    this.events.push({ t: 'attack', gua: tower.def.id, level: tower.level, from: tpos, to: this.enemyPos(target), aoe: st.aoe, delay });
    this.pending.push({ tower, target, damage: st.damage, aoe: st.aoe, left: delay });
    return true;
  }

  /** 命中时刻结算：扣 HP、AOE、词条、伤害数字（与弹道同步，GDD §5） */
  private resolvePending(dt: number): void {
    const still: PendingHit[] = [];
    for (const h of this.pending) {
      h.left -= dt;
      if (h.left > 0) {
        still.push(h);
        continue;
      }
      if (h.target.hp <= 0 || !this.enemies.includes(h.target)) continue; // 目标已死/离场 → 落空
      const tp = this.enemyPos(h.target);
      this.damage(h.target, h.damage, h.tower);
      this.events.push({ t: 'dmg', pos: tp, amt: h.damage, kind: h.tower.def.element });
      if (h.aoe > 0) {
        for (const e of this.enemies) {
          if (e !== h.target && dist(this.enemyPos(e), tp) <= h.aoe) this.damage(e, h.damage * CONFIG.combat.aoeFalloff, h.tower);
        }
      }
      this.applyRiders(h.tower, h.target);
      if (h.tower.def.id === 'li' && h.tower.activeRiders.some((r) => r.verb === 'statMod' && r.params.stat === 'aoe')) {
        this.events.push({ t: 'rider', effect: 'fireTornado', to: tp }); // 风火阵·火龙卷
      }
    }
    this.pending = still;
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
              this.events.push({ t: 'rider', effect: 'chainLightning', from: tp, to: this.enemyPos(near) });
            }
            break;
          }
          case 'goldSword':
            if (this.rng.next() < Number(p.chance ?? 0.3)) {
              this.damage(target, Number(p.dmg) * scale, tower);
              this.events.push({ t: 'rider', effect: 'goldSword', to: tp });
            }
            break;
          case 'steamBurst':
            if (target.statuses.some((s) => s.kind === 'wet')) {
              this.damage(target, Number(p.dmg) * scale, tower);
              this.events.push({ t: 'rider', effect: 'steamBurst', to: tp });
            }
            break;
        }
      } else if (r.verb === 'zone') {
        const kind = String(p.effect);
        this.zones.push({ pos: tp, radius: 1.5, kind, dmg: Number(p.dmg ?? 0) * scale, until: Number(p.dur ?? 2) });
        if (kind === 'iceWall') this.events.push({ t: 'rider', effect: 'iceShatter', to: tp }); // 水山阵·冰爆
      }
    }
  }
}
