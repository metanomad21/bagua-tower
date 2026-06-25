import { Container, Graphics, Text } from 'pixi.js';
import type { Vec2 } from '../core/topology.ts';
import type { CombatEvent } from '../core/combat.ts';

// ─────────────────────────────────────────────────────────────
// 攻击特效系统（GDD §5/§9）。过程绘制 VFX：每个卦 / 阵独立形态 + 多阶段 + 粒子。
// 坐标在像素空间（格单位 × SCALE）。SCALE 须与 BoardView 一致。
// ─────────────────────────────────────────────────────────────

export const SCALE = 56;

const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
const easeOut = (p: number): number => 1 - (1 - p) * (1 - p);
const rr = (a: number, b: number): number => a + Math.random() * (b - a);
const px = (v: Vec2): Vec2 => ({ x: v.x * SCALE, y: v.y * SCALE });

export interface Effect {
  container: Container;
  update(dt: number): boolean; // 返回 true 表示结束
}

// ── 粒子爆裂 ────────────────────────────────────────────
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: number; grav: number;
}

function particles(
  pos: Vec2,
  count: number,
  o: { speed: [number, number]; size: [number, number]; color: number | number[]; life: [number, number]; grav?: number; dir?: number; spread?: number },
): Effect {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);
  const ps: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const ang = o.dir != null ? o.dir + rr(-(o.spread ?? Math.PI), o.spread ?? Math.PI) : rr(0, Math.PI * 2);
    const sp = rr(o.speed[0], o.speed[1]);
    const life = rr(o.life[0], o.life[1]);
    const color = Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color;
    ps.push({ x: pos.x, y: pos.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, size: rr(o.size[0], o.size[1]), color, grav: o.grav ?? 0 });
  }
  const maxLife = Math.max(...ps.map((p) => p.max));
  let age = 0;
  return {
    container,
    update(dt) {
      age += dt;
      g.clear();
      for (const p of ps) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
        const a = Math.max(0, p.life / p.max);
        g.circle(p.x, p.y, p.size * a).fill({ color: p.color, alpha: a });
      }
      return age >= maxLife;
    },
  };
}

// ── 通用计时绘制 ────────────────────────────────────────
function timed(dur: number, render: (g: Graphics, p: number, age: number) => void): Effect {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);
  let age = 0;
  return {
    container,
    update(dt) {
      age += dt;
      g.clear();
      render(g, Math.min(1, age / dur), age);
      return age >= dur;
    },
  };
}

// ── 飞行物 ──────────────────────────────────────────────
function projectile(from: Vec2, to: Vec2, dur: number, draw: (g: Graphics, p: number, x: number, y: number, ang: number) => void, onArrive: () => void): Effect {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  let age = 0; let arrived = false;
  return {
    container,
    update(dt) {
      age += dt;
      const p = Math.min(1, age / dur);
      g.clear();
      draw(g, p, lerp(from.x, to.x, p), lerp(from.y, to.y, p), ang);
      if (p >= 1 && !arrived) { arrived = true; onArrive(); }
      return age >= dur;
    },
  };
}

// ── 闪电折线 ────────────────────────────────────────────
function boltPoints(from: Vec2, to: Vec2, seg: number, jit: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= seg; i++) {
    const p = i / seg;
    let x = lerp(from.x, to.x, p); let y = lerp(from.y, to.y, p);
    if (i > 0 && i < seg) { x += rr(-jit, jit); y += rr(-jit, jit); }
    pts.push({ x, y });
  }
  return pts;
}
function strokePath(g: Graphics, pts: Vec2[], width: number, color: number, alpha: number): void {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.stroke({ width, color, alpha });
}

// 闪电效果（连到目标并抖动闪烁）
function lightning(from: Vec2, to: Vec2, glow: number, core = 0xffffff): Effect {
  const dur = 0.2;
  return timed(dur, (g, p) => {
    const a = 1 - p;
    const pts = boltPoints(from, to, 7, 9);
    strokePath(g, pts, 6, glow, a * 0.5);
    strokePath(g, pts, 2.2, core, a);
  });
}

// ── 各卦攻击特效（GDD §9）────────────────────────────────

function fxLi(from: Vec2, to: Vec2, aoe: number, add: (e: Effect) => void, travel = 0.22): Effect {
  // 火球：发光核心 + 跳动外焰 + 拖尾；命中炸开火环 + 火星 + 残留火苗
  return projectile(from, to, travel, (g, _p, x, y) => {
    g.circle(x, y, 9).fill({ color: 0xef476f, alpha: 0.5 });
    g.circle(x, y, 6).fill({ color: 0xff8c42 });
    g.circle(x, y, 3).fill({ color: 0xffe066 });
  }, () => {
    const r = Math.max(0.8, aoe) * SCALE;
    add(timed(0.32, (g, p) => {
      g.circle(to.x, to.y, r * easeOut(p)).stroke({ width: 4 * (1 - p), color: 0xff8c42, alpha: 1 - p });
      g.circle(to.x, to.y, r * 0.6 * easeOut(p)).fill({ color: 0xef476f, alpha: 0.4 * (1 - p) });
    }));
    add(particles(to, 16, { speed: [40, 160], size: [2, 5], color: [0xffe066, 0xff8c42, 0xef476f], life: [0.3, 0.6], grav: 60 }));
  });
}

function fxQian(from: Vec2, to: Vec2, add: (e: Effect) => void, travel = 0.16): Effect {
  // 飞剑：细长金色剑刃直线穿透 + 金色残影；命中迸金属火花
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const beyond: Vec2 = { x: to.x + Math.cos(ang) * SCALE * 1.2, y: to.y + Math.sin(ang) * SCALE * 1.2 };
  return projectile(from, beyond, travel, (g, p, x, y, a) => {
    const len = 22; const w = 5;
    const tipx = x + Math.cos(a) * len; const tipy = y + Math.sin(a) * len;
    const nx = Math.cos(a + Math.PI / 2); const ny = Math.sin(a + Math.PI / 2);
    g.poly([tipx, tipy, x + nx * w, y + ny * w, x - Math.cos(a) * 8, y - Math.sin(a) * 8, x - nx * w, y - ny * w]).fill({ color: 0xf4d35e, alpha: 1 - p * 0.3 });
    g.moveTo(x, y).lineTo(x - Math.cos(a) * 26, y - Math.sin(a) * 26).stroke({ width: 2, color: 0xfff3b0, alpha: (1 - p) * 0.6 });
  }, () => {
    add(particles(to, 10, { speed: [60, 180], size: [1.5, 3.5], color: [0xf4d35e, 0xfff3b0], life: [0.15, 0.35], dir: ang + Math.PI, spread: 1.1 }));
  });
}

function fxZhen(from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 8, { speed: [40, 120], size: [1.5, 3], color: [0x9b5de5, 0xd9b8ff], life: [0.1, 0.25] }));
  return lightning(from, to, 0x9b5de5);
}

function fxXun(from: Vec2, to: Vec2): Effect {
  // 风刃：多片新月弧高速旋飞
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  return timed(0.22, (g, p) => {
    for (let k = 0; k < 3; k++) {
      const pp = Math.min(1, p * 1.4 - k * 0.18);
      if (pp <= 0) continue;
      const x = lerp(from.x, to.x, pp); const y = lerp(from.y, to.y, pp);
      const rot = ang + pp * 8 + k;
      g.arc(x, y, 11, rot - 1.2, rot + 1.2).stroke({ width: 3, color: 0x90be6d, alpha: (1 - pp) * 0.9 });
    }
  });
}

function fxKan(from: Vec2, to: Vec2, add: (e: Effect) => void, travel = 0.18): Effect {
  add(particles(to, 10, { speed: [30, 90], size: [1.5, 3], color: [0x4ea8de, 0xa8e0ff], life: [0.2, 0.45], grav: 40 }));
  return projectile(from, to, travel, (g, _p, x, y) => {
    g.circle(x, y, 7).fill({ color: 0x4ea8de, alpha: 0.7 });
    g.circle(x, y, 3).fill({ color: 0xa8e0ff });
  }, () => {
    add(timed(0.4, (g, p) => {
      g.circle(to.x, to.y, 8 + 22 * easeOut(p)).stroke({ width: 3 * (1 - p), color: 0x4ea8de, alpha: 1 - p });
    }));
  });
}

function fxGen(from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  // 山石砸落：岩石自上方落下 + 砸地碎石/尘土
  const top: Vec2 = { x: to.x, y: to.y - SCALE * 2.2 };
  return projectile(top, to, 0.2, (g, p, x, y) => {
    const s = 10;
    g.poly([x - s, y, x - s * 0.4, y - s, x + s * 0.6, y - s * 0.8, x + s, y + s * 0.3, x + s * 0.2, y + s]).fill({ color: 0x8d99ae });
    g.ellipse(to.x, to.y + 4, 12 * p, 4 * p).fill({ color: 0x000000, alpha: 0.25 });
  }, () => {
    add(particles(to, 14, { speed: [50, 150], size: [2, 4.5], color: [0x8d99ae, 0xb0b8c8, 0x6b7280], life: [0.25, 0.5], grav: 120, dir: -Math.PI / 2, spread: 1.3 }));
    add(timed(0.25, (g, p) => g.ellipse(to.x, to.y + 4, 6 + 26 * p, 3 + 8 * p).stroke({ width: 2 * (1 - p), color: 0x8d99ae, alpha: 1 - p })));
  });
}

function fxDui(from: Vec2, to: Vec2, add: (e: Effect) => void, travel = 0.18): Effect {
  // 铜钱弹：旋转金币（圆 + 方孔 + 高光）
  return projectile(from, to, travel, (g, p, x, y) => {
    const spin = Math.abs(Math.cos(p * 14)) * 0.85 + 0.15; // 旋转 → 椭圆宽度变化
    g.ellipse(x, y, 9 * spin, 9).fill({ color: 0xffd166 });
    g.ellipse(x, y, 9 * spin, 9).stroke({ width: 1.5, color: 0xb8860b });
    g.rect(x - 2 * spin, y - 2, 4 * spin, 4).fill({ color: 0x171426 });
  }, () => {
    add(particles(to, 8, { speed: [40, 120], size: [1.5, 3], color: [0xffd166, 0xfff3b0], life: [0.15, 0.35], grav: 80 }));
  });
}

function fxKun(_from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  // 土偶砸击：块状土偶在目标处隆起挥砸 + 尘土
  add(particles(to, 10, { speed: [30, 100], size: [2, 4], color: [0xb08968, 0x8d6e56], life: [0.2, 0.45], grav: 90, dir: -Math.PI / 2, spread: 1.2 }));
  return timed(0.26, (g, p) => {
    const rise = easeOut(Math.min(1, p * 2)) * 14;
    const y = to.y + 10 - rise;
    g.roundRect(to.x - 9, y - 14, 18, 22, 3).fill({ color: 0xb08968, alpha: 1 - p * 0.3 });
    g.rect(to.x - 12, y - 6, 6, 10).fill({ color: 0x8d6e56, alpha: 1 - p * 0.3 });
  });
}

// ── rider 组合特效（GDD §10）────────────────────────────
function fxChain(from: Vec2, to: Vec2): Effect {
  return lightning(from, to, 0x9b5de5, 0xffe066);
}
function fxGoldSword(to: Vec2): Effect {
  // 金色剑气：大号新月斩光弧
  const rot = rr(0, Math.PI * 2);
  return timed(0.26, (g, p) => {
    const a = 1 - p;
    g.arc(to.x, to.y, 16 + p * 10, rot - 1.4, rot + 1.4).stroke({ width: 5 * a, color: 0xf4d35e, alpha: a });
    g.arc(to.x, to.y, 16 + p * 10, rot - 1.0, rot + 1.0).stroke({ width: 2, color: 0xfff3b0, alpha: a });
  });
}
function fxSteam(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 14, { speed: [20, 70], size: [3, 7], color: [0xe8f0ff, 0xc8d8f0], life: [0.3, 0.7], grav: -30 }));
  return timed(0.4, (g, p) => {
    g.circle(to.x, to.y, 6 + 20 * easeOut(p)).fill({ color: 0xffffff, alpha: 0.35 * (1 - p) });
  });
}

// 风火阵·火龙卷：旋转上升的螺旋火柱 + 上升火星
function fxTornado(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 12, { speed: [20, 60], size: [2, 4], color: [0xffe066, 0xff8c42], life: [0.3, 0.6], grav: -90, dir: -Math.PI / 2, spread: 0.5 }));
  return timed(0.5, (g, p, age) => {
    const a = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    for (let i = 0; i < 5; i++) {
      const yy = to.y + 12 - i * 9;
      const w = 6 + i * 2.5;
      const ph = age * 12 + i;
      g.ellipse(to.x + Math.cos(ph) * 5, yy, w * (0.6 + 0.4 * Math.abs(Math.cos(ph))), 5).fill({ color: i % 2 ? 0xff8c42 : 0xffe066, alpha: 0.7 * a });
    }
  });
}

// 水山阵·冰爆：冰晶碎片四射 + 棱光
function fxIceShatter(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 12, { speed: [60, 160], size: [2, 4], color: [0xd8f4ff, 0x9fd8f0, 0xffffff], life: [0.2, 0.4], grav: 50 }));
  return timed(0.22, (g, p) => {
    const a = 1 - p;
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const rad = 8 + 18 * easeOut(p);
      g.moveTo(to.x, to.y).lineTo(to.x + Math.cos(ang) * rad, to.y + Math.sin(ang) * rad).stroke({ width: 2 * a, color: 0xd8f4ff, alpha: a });
    }
  });
}

// 击杀掉灵气·迸射：多枚灵气光点四散（函数名 coinBurst 为历史内部名）
export function coinBurst(pos: Vec2): Effect {
  return particles(pos, 7, { speed: [60, 140], size: [2.5, 4.5], color: [0x9d8cff, 0xc8b8ff, 0xe8e3ff], life: [0.25, 0.55], grav: 70 });
}

// ── 伤害数字 / 灵气拾取（坐标为像素）────────────────────
export function damageNumber(pos: Vec2, amt: number, color: number): Effect {
  const container = new Container();
  const t = new Text({ text: `-${Math.round(amt)}`, style: { fill: color, fontSize: 13, fontWeight: 'bold' } });
  t.anchor.set(0.5);
  container.addChild(t);
  const dur = 0.6; let age = 0;
  return {
    container,
    update(dt) { age += dt; const p = age / dur; t.position.set(pos.x, pos.y - p * 28); t.alpha = 1 - p; return age >= dur; },
  };
}

export function qiPickup(from: Vec2, to: Vec2, delay = 0): Effect {
  const container = new Container();
  const orb = new Graphics().circle(0, 0, 7).fill({ color: 0x9d8cff }).stroke({ width: 2, color: 0xe8e3ff });
  const t = new Text({ text: '灵+1', style: { fill: 0xe8e3ff, fontSize: 11, fontWeight: 'bold' } });
  t.anchor.set(0.5); t.position.set(0, -13);
  container.addChild(orb, t);
  container.alpha = delay > 0 ? 0 : 1;
  const dur = 0.7; let age = 0;
  return {
    container,
    update(dt) {
      age += dt;
      if (age < delay) { container.position.set(from.x, from.y); container.alpha = 0; return false; }
      const r = (age - delay) / dur; const p = easeOut(Math.min(1, r));
      container.position.set(lerp(from.x, to.x, p), lerp(from.y, to.y, p));
      container.alpha = r > 0.7 ? 1 - (r - 0.7) / 0.3 : 1;
      return age - delay >= dur;
    },
  };
}

// ── 特效层 ──────────────────────────────────────────────
export class EffectsLayer {
  readonly container = new Container();
  private effects: Effect[] = [];

  private add = (e: Effect): void => {
    this.effects.push(e);
    this.container.addChild(e.container);
  };

  addEffect(e: Effect): void {
    this.add(e);
  }

  spawn(ev: CombatEvent): void {
    if (ev.t === 'attack') {
      const from = px(ev.from); const to = px(ev.to);
      let e: Effect | null = null;
      switch (ev.gua) {
        case 'li': e = fxLi(from, to, ev.aoe, this.add, ev.delay); break;
        case 'qian': e = fxQian(from, to, this.add, ev.delay); break;
        case 'zhen': e = fxZhen(from, to, this.add); break;
        case 'xun': e = fxXun(from, to); break;
        case 'kan': e = fxKan(from, to, this.add, ev.delay); break;
        case 'gen': e = fxGen(from, to, this.add); break;
        case 'dui': e = fxDui(from, to, this.add, ev.delay); break;
        case 'kun': e = fxKun(from, to, this.add); break;
      }
      if (e) this.add(e);
    } else if (ev.t === 'rider') {
      const to = px(ev.to); const from = ev.from ? px(ev.from) : to;
      if (ev.effect === 'chainLightning') this.add(fxChain(from, to));
      else if (ev.effect === 'goldSword') this.add(fxGoldSword(to));
      else if (ev.effect === 'steamBurst') this.add(fxSteam(to, this.add));
      else if (ev.effect === 'fireTornado') this.add(fxTornado(to, this.add));
      else if (ev.effect === 'iceShatter') this.add(fxIceShatter(to, this.add));
    }
  }

  update(dt: number): void {
    this.effects = this.effects.filter((e) => {
      const done = e.update(dt);
      if (done) e.container.destroy();
      return !done;
    });
  }

  clear(): void {
    for (const e of this.effects) e.container.destroy();
    this.effects = [];
  }
}
