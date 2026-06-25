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
  return timed(0.2, (g, p) => {
    const a = 1 - p;
    const pts = boltPoints(from, to, 8, 11);
    strokePath(g, pts, 9, glow, a * 0.22); // 外辉
    strokePath(g, pts, 5, glow, a * 0.55); // 中层
    strokePath(g, pts, 2, core, a); // 亮芯
    for (let i = 2; i < pts.length - 1; i += 2) {
      const dir = rr(0, Math.PI * 2);
      const tip = { x: pts[i].x + Math.cos(dir) * rr(7, 16), y: pts[i].y + Math.sin(dir) * rr(7, 16) };
      strokePath(g, boltPoints(pts[i], tip, 3, 5), 1.5, glow, a * 0.7); // 分叉电弧
    }
    g.circle(to.x, to.y, 6 * a).fill({ color: core, alpha: a * 0.8 });
  });
}

// ── 各卦攻击特效（GDD §9）────────────────────────────────

function fxLi(from: Vec2, to: Vec2, aoe: number, add: (e: Effect) => void, travel = 0.22): Effect {
  // 火球：多层外焰光 + 跳动白热核心 + 拖尾；命中三层火环 + 火星 + 烟
  return projectile(from, to, travel, (g, p, x, y, a) => {
    g.circle(x - Math.cos(a) * 8, y - Math.sin(a) * 8, 4).fill({ color: 0xff8c42, alpha: 0.4 });
    g.circle(x, y, 10).fill({ color: 0xef476f, alpha: 0.35 });
    g.circle(x, y, 7).fill({ color: 0xff8c42 });
    g.circle(x, y, 4 + Math.sin(p * 30)).fill({ color: 0xffe066 });
    g.circle(x, y, 2).fill({ color: 0xffffff });
  }, () => {
    const r = Math.max(0.8, aoe) * SCALE;
    add(timed(0.34, (g, p) => {
      g.circle(to.x, to.y, r * easeOut(p)).stroke({ width: 5 * (1 - p), color: 0xff8c42, alpha: 1 - p });
      g.circle(to.x, to.y, r * 0.7 * easeOut(p)).fill({ color: 0xef476f, alpha: 0.4 * (1 - p) });
      g.circle(to.x, to.y, r * 0.35 * easeOut(p)).fill({ color: 0xffe066, alpha: 0.5 * (1 - p) });
    }));
    add(particles(to, 20, { speed: [40, 180], size: [2, 6], color: [0xffe066, 0xff8c42, 0xef476f], life: [0.3, 0.7], grav: 60 }));
    add(particles({ x: to.x, y: to.y - 6 }, 6, { speed: [10, 40], size: [4, 8], color: [0x5a5060, 0x3a3550], life: [0.4, 0.8], grav: -30 }));
  });
}

function fxQian(from: Vec2, to: Vec2, add: (e: Effect) => void, travel = 0.16): Effect {
  // 飞剑：细长金色剑刃直线穿透 + 金色残影；命中迸金属火花
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const beyond: Vec2 = { x: to.x + Math.cos(ang) * SCALE * 1.2, y: to.y + Math.sin(ang) * SCALE * 1.2 };
  return projectile(from, beyond, travel, (g, p, x, y, a) => {
    const nx = Math.cos(a + Math.PI / 2);
    const ny = Math.sin(a + Math.PI / 2);
    for (let k = 1; k <= 3; k++) {
      g.moveTo(x - Math.cos(a) * k * 10, y - Math.sin(a) * k * 10).lineTo(x - Math.cos(a) * (k * 10 + 14), y - Math.sin(a) * (k * 10 + 14)).stroke({ width: 2, color: 0xfff3b0, alpha: ((1 - p) * 0.5) / k });
    }
    g.poly([x + Math.cos(a) * 24, y + Math.sin(a) * 24, x + nx * 5, y + ny * 5, x - Math.cos(a) * 8, y - Math.sin(a) * 8, x - nx * 5, y - ny * 5]).fill({ color: 0xf4d35e });
    g.poly([x + Math.cos(a) * 22, y + Math.sin(a) * 22, x + nx * 1.6, y + ny * 1.6, x - Math.cos(a) * 6, y - Math.sin(a) * 6, x - nx * 1.6, y - ny * 1.6]).fill({ color: 0xfff8d0 });
  }, () => {
    add(particles(to, 12, { speed: [60, 200], size: [1.5, 3.5], color: [0xf4d35e, 0xfff3b0], life: [0.12, 0.32], dir: ang + Math.PI, spread: 1.2 }));
    add(timed(0.16, (g, pp) => {
      const a = 1 - pp;
      for (let i = 0; i < 4; i++) {
        const an = ang + Math.PI / 2 + (i - 1.5) * 0.5;
        g.moveTo(to.x, to.y).lineTo(to.x + Math.cos(an) * 18 * easeOut(pp), to.y + Math.sin(an) * 18 * easeOut(pp)).stroke({ width: 2 * a, color: 0xfff3b0, alpha: a });
      }
    }));
  });
}

function fxZhen(from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 8, { speed: [40, 120], size: [1.5, 3], color: [0x9b5de5, 0xd9b8ff], life: [0.1, 0.25] }));
  return lightning(from, to, 0x9b5de5);
}

function fxXun(from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  // 风刃：多片新月弧高速旋飞（双层 + 风粒）
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  add(particles(to, 8, { speed: [30, 100], size: [1, 3], color: [0x90be6d, 0xcdeeb0, 0xffffff], life: [0.15, 0.35], dir: ang, spread: 1.0 }));
  return timed(0.24, (g, p) => {
    for (let k = 0; k < 3; k++) {
      const pp = Math.min(1, p * 1.4 - k * 0.16);
      if (pp <= 0) continue;
      const x = lerp(from.x, to.x, pp);
      const y = lerp(from.y, to.y, pp);
      const rot = ang + pp * 9 + k * 1.3;
      const a = (1 - pp) * 0.9;
      g.arc(x, y, 13, rot - 1.3, rot + 1.3).stroke({ width: 4, color: 0x90be6d, alpha: a * 0.5 });
      g.arc(x, y, 13, rot - 1.0, rot + 1.0).stroke({ width: 2, color: 0xeaffd0, alpha: a });
    }
  });
}

function fxKan(from: Vec2, to: Vec2, add: (e: Effect) => void, travel = 0.18): Effect {
  add(particles(to, 12, { speed: [25, 90], size: [1.5, 3.5], color: [0x4ea8de, 0xa8e0ff, 0xffffff], life: [0.2, 0.5], grav: 50 }));
  return projectile(from, to, travel, (g, _p, x, y) => {
    g.circle(x, y, 8).fill({ color: 0x4ea8de, alpha: 0.5 });
    g.circle(x, y, 5).fill({ color: 0x6fc0ea });
    g.circle(x, y, 2.5).fill({ color: 0xeaf6ff });
  }, () => {
    add(timed(0.45, (g, p) => {
      g.circle(to.x, to.y, 8 + 24 * easeOut(p)).stroke({ width: 3 * (1 - p), color: 0x4ea8de, alpha: 1 - p });
      g.circle(to.x, to.y, 4 + 16 * easeOut(p)).stroke({ width: 2 * (1 - p), color: 0xa8e0ff, alpha: (1 - p) * 0.8 });
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
    add(particles(to, 18, { speed: [50, 170], size: [2, 5], color: [0x8d99ae, 0xb0b8c8, 0x6b7280], life: [0.25, 0.55], grav: 140, dir: -Math.PI / 2, spread: 1.4 }));
    add(particles(to, 8, { speed: [8, 30], size: [5, 10], color: [0x6b6460, 0x4a4540], life: [0.4, 0.8], grav: -20 })); // 尘云
    add(timed(0.28, (g, p) => {
      g.ellipse(to.x, to.y + 4, 6 + 28 * p, 3 + 9 * p).stroke({ width: 2 * (1 - p), color: 0x8d99ae, alpha: 1 - p });
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        const rad = 26 * easeOut(p);
        g.moveTo(to.x, to.y).lineTo(to.x + Math.cos(ang) * rad, to.y + Math.sin(ang) * rad).stroke({ width: 1.5 * (1 - p), color: 0x6b7280, alpha: (1 - p) * 0.7 });
      }
    }));
  });
}

function fxDui(from: Vec2, to: Vec2, add: (e: Effect) => void, travel = 0.18): Effect {
  // 铜钱弹：旋转金币（圆 + 方孔 + 高光）
  return projectile(from, to, travel, (g, p, x, y, a) => {
    g.circle(x - Math.cos(a) * 7, y - Math.sin(a) * 7, 3).fill({ color: 0xffd166, alpha: 0.35 }); // 金辉尾
    const spin = Math.abs(Math.cos(p * 16)) * 0.85 + 0.15;
    g.ellipse(x, y, 9.5 * spin, 9.5).fill({ color: 0xffd166 });
    g.ellipse(x, y, 9.5 * spin, 9.5).stroke({ width: 1.5, color: 0xb8860b });
    g.rect(x - 2.2 * spin, y - 2.2, 4.4 * spin, 4.4).fill({ color: 0x171426 });
    g.circle(x - 2 * spin, y - 2, 1.5).fill({ color: 0xfff3b0, alpha: spin }); // 高光
  }, () => {
    add(particles(to, 12, { speed: [50, 150], size: [1.5, 3.5], color: [0xffd166, 0xfff3b0, 0xb8860b], life: [0.18, 0.4], grav: 120 }));
    add(timed(0.22, (g, pp) => g.circle(to.x, to.y, 4 + 14 * easeOut(pp)).stroke({ width: 2 * (1 - pp), color: 0xffd166, alpha: 1 - pp })));
  });
}

function fxKun(_from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  // 土偶砸击：块状土偶在目标处隆起挥砸 + 尘土
  add(particles(to, 12, { speed: [30, 110], size: [2, 5], color: [0xb08968, 0x8d6e56, 0x6b5640], life: [0.2, 0.5], grav: 110, dir: -Math.PI / 2, spread: 1.3 }));
  return timed(0.28, (g, p) => {
    const rise = easeOut(Math.min(1, p * 2)) * 14;
    const y = to.y + 10 - rise;
    const al = 1 - p * 0.3;
    g.roundRect(to.x - 10, y - 15, 20, 24, 3).fill({ color: 0xb08968, alpha: al }).stroke({ width: 1.5, color: 0x6b5640, alpha: al });
    g.rect(to.x - 6, y - 8, 3.5, 3.5).fill({ color: 0x4a3b2a, alpha: al });
    g.rect(to.x + 2.5, y - 8, 3.5, 3.5).fill({ color: 0x4a3b2a, alpha: al });
    g.rect(to.x - 14, y - 4, 7, 9).fill({ color: 0x8d6e56, alpha: al }); // 拳
    if (p > 0.4) {
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + 0.4;
        const rad = 20 * easeOut((p - 0.4) / 0.6);
        g.moveTo(to.x, to.y + 8).lineTo(to.x + Math.cos(ang) * rad, to.y + 8 + Math.sin(ang) * rad * 0.4).stroke({ width: 1.5 * (1 - p), color: 0x6b5640, alpha: (1 - p) * 0.7 });
      }
    }
  });
}

// ── rider 组合特效（GDD §10）────────────────────────────
function fxChain(from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 10, { speed: [50, 150], size: [1.5, 3.5], color: [0xffe066, 0xd9b8ff, 0xffffff], life: [0.1, 0.28] }));
  add(timed(0.18, (g, p) => {
    const a = 1 - p;
    g.circle(to.x, to.y, 5 + 10 * easeOut(p)).stroke({ width: 2.5 * a, color: 0xffe066, alpha: a });
  }));
  return lightning(from, to, 0x9b5de5, 0xffe066);
}
function fxGoldSword(to: Vec2, add: (e: Effect) => void): Effect {
  // 金色剑气：三层斩光弧 + 金火花 + 剑尖闪
  const rot = rr(0, Math.PI * 2);
  add(particles(to, 10, { speed: [60, 170], size: [1.5, 3.5], color: [0xf4d35e, 0xfff3b0], life: [0.12, 0.32], dir: rot + Math.PI / 2, spread: 1.4 }));
  return timed(0.26, (g, p) => {
    const a = 1 - p;
    const r = 16 + p * 14;
    g.arc(to.x, to.y, r, rot - 1.5, rot + 1.5).stroke({ width: 7 * a, color: 0xf4d35e, alpha: a * 0.45 });
    g.arc(to.x, to.y, r, rot - 1.3, rot + 1.3).stroke({ width: 4 * a, color: 0xffd166, alpha: a });
    g.arc(to.x, to.y, r, rot - 1.0, rot + 1.0).stroke({ width: 2, color: 0xfffce0, alpha: a });
    g.circle(to.x + Math.cos(rot) * r, to.y + Math.sin(rot) * r, 3 * a).fill({ color: 0xffffff, alpha: a });
  });
}
function fxSteam(to: Vec2, add: (e: Effect) => void): Effect {
  // 蒸汽爆：多团翻滚蒸汽 + 嘶嘶气粒
  add(particles(to, 18, { speed: [25, 90], size: [3, 8], color: [0xe8f0ff, 0xc8d8f0, 0xffffff], life: [0.3, 0.8], grav: -40 }));
  return timed(0.45, (g, p, age) => {
    const a = 1 - p;
    for (let i = 0; i < 4; i++) {
      const ph = age * 5 + i * 1.6;
      const ox = Math.cos(ph) * (6 + i * 3);
      const oy = -i * 5 - p * 14;
      g.circle(to.x + ox, to.y + oy, (8 + i * 3) * easeOut(p)).fill({ color: 0xffffff, alpha: 0.3 * a });
    }
    g.circle(to.x, to.y, 6 + 18 * easeOut(p)).fill({ color: 0xeaf2ff, alpha: 0.25 * a });
  });
}

// 风火阵·火龙卷：旋转上升的螺旋火柱 + 上升火星
function fxTornado(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 16, { speed: [20, 70], size: [2, 5], color: [0xffe066, 0xff8c42, 0xef476f], life: [0.3, 0.7], grav: -100, dir: -Math.PI / 2, spread: 0.5 }));
  return timed(0.5, (g, p, age) => {
    const a = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    g.ellipse(to.x, to.y + 12, 14, 5).fill({ color: 0xef476f, alpha: 0.25 * a }); // 底座火光
    for (let i = 0; i < 6; i++) {
      const yy = to.y + 12 - i * 8;
      const w = 7 + i * 2.4;
      const ph = age * 13 + i;
      g.ellipse(to.x + Math.cos(ph) * 5, yy, w * (0.55 + 0.45 * Math.abs(Math.cos(ph))), 5).fill({ color: i % 2 ? 0xff8c42 : 0xffe066, alpha: 0.75 * a });
      if (i % 2) g.circle(to.x + Math.cos(ph) * 7, yy, 1.5).fill({ color: 0xffffff, alpha: 0.6 * a }); // 火星
    }
  });
}

// 水山阵·冰爆：冰晶碎片四射 + 棱光
function fxIceShatter(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 16, { speed: [70, 180], size: [2, 5], color: [0xd8f4ff, 0x9fd8f0, 0xffffff], life: [0.2, 0.45], grav: 60 }));
  return timed(0.24, (g, p) => {
    const a = 1 - p;
    const r = 6 + 14 * easeOut(p);
    const hex: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      hex.push(to.x + Math.cos(ang) * r, to.y + Math.sin(ang) * r);
    }
    g.poly(hex).stroke({ width: 2 * a, color: 0xeaffff, alpha: a });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.3;
      const rad = 8 + 20 * easeOut(p);
      g.moveTo(to.x, to.y).lineTo(to.x + Math.cos(ang) * rad, to.y + Math.sin(ang) * rad).stroke({ width: 2.2 * a, color: 0xd8f4ff, alpha: a });
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

// 火天大有·燃剑：裹火剑刃 + 火轨拖尾 + 余烬
function fxFlameSword(from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const beyond: Vec2 = { x: to.x + Math.cos(ang) * SCALE, y: to.y + Math.sin(ang) * SCALE };
  add(particles(to, 14, { speed: [40, 150], size: [2, 5], color: [0xffe066, 0xff8c42, 0xef476f], life: [0.3, 0.6], grav: 50 }));
  return projectile(from, beyond, 0.16, (g, p, x, y, a) => {
    for (let k = 1; k <= 5; k++) {
      const r = (6 - k) * (1 - p * 0.4);
      if (r > 0) g.circle(x - Math.cos(a) * k * 7, y - Math.sin(a) * k * 7, r).fill({ color: k % 2 ? 0xff8c42 : 0xffe066, alpha: 0.5 * (1 - k / 6) });
    }
    const nx = Math.cos(a + Math.PI / 2);
    const ny = Math.sin(a + Math.PI / 2);
    g.poly([x + Math.cos(a) * 24, y + Math.sin(a) * 24, x + nx * 5, y + ny * 5, x - Math.cos(a) * 8, y - Math.sin(a) * 8, x - nx * 5, y - ny * 5]).fill({ color: 0xfff3b0 });
    g.circle(x, y, 9).fill({ color: 0xef476f, alpha: 0.35 });
  }, () => {
    add(timed(0.28, (g, pp) => g.circle(to.x, to.y, 6 + 22 * easeOut(pp)).stroke({ width: 4 * (1 - pp), color: 0xff8c42, alpha: 1 - pp })));
  });
}

// 山火贲·火山喷发：岩浆碎块上抛 + 火柱 + 冲击波 + 烟尘
function fxVolcano(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 18, { speed: [80, 260], size: [3, 7], color: [0xef476f, 0xff8c42, 0x8d5524], life: [0.4, 0.8], grav: 320, dir: -Math.PI / 2, spread: 1.0 }));
  add(particles({ x: to.x, y: to.y - 10 }, 10, { speed: [10, 50], size: [5, 11], color: [0x5a5060, 0x3a3550], life: [0.5, 1.0], grav: -40 }));
  return timed(0.5, (g, p, age) => {
    const a = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    g.circle(to.x, to.y, 10 + 46 * easeOut(p)).stroke({ width: 5 * (1 - p), color: 0xff8c42, alpha: (1 - p) * 0.8 });
    const h = 46 * easeOut(Math.min(1, p * 1.6));
    for (let i = 0; i < 4; i++) {
      const ph = age * 16 + i;
      const w = (10 - i * 2) * (0.6 + 0.4 * Math.abs(Math.cos(ph)));
      g.ellipse(to.x + Math.cos(ph) * 4, to.y - (h * i) / 4, w, 6).fill({ color: i % 2 ? 0xffe066 : 0xef476f, alpha: 0.8 * a });
    }
    g.circle(to.x, to.y, 16 * a).fill({ color: 0xffe066, alpha: 0.5 * a });
  });
}

// 风水涣·水漩涡：多旋臂螺旋 + 内吸水滴
function fxVortex(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 12, { speed: [20, 70], size: [2, 4], color: [0x4ea8de, 0xa8e0ff], life: [0.3, 0.6] }));
  return timed(0.55, (g, p, age) => {
    const a = 1 - p;
    for (let arm = 0; arm < 3; arm++) {
      const base = age * 9 + (arm * Math.PI * 2) / 3;
      g.moveTo(to.x, to.y);
      for (let t = 0; t <= 1; t += 0.1) {
        const rad = t * (30 + 6 * Math.sin(age * 6));
        const ang = base + t * 5;
        g.lineTo(to.x + Math.cos(ang) * rad, to.y + Math.sin(ang) * rad);
      }
      g.stroke({ width: 2.5 * a, color: arm % 2 ? 0x4ea8de : 0xa8e0ff, alpha: 0.7 * a });
    }
    g.circle(to.x, to.y, 6 + 4 * Math.sin(age * 10)).fill({ color: 0x2a6fa0, alpha: 0.4 * a });
  });
}

// 水雷屯·导通雷：粗主干 + 多分叉 + 电火花
function fxConduct(from: Vec2, to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 10, { speed: [60, 160], size: [1.5, 3.5], color: [0xd9b8ff, 0xffffff, 0x9b5de5], life: [0.1, 0.25] }));
  return timed(0.22, (g, p) => {
    const a = 1 - p;
    const main = boltPoints(from, to, 9, 12);
    strokePath(g, main, 8, 0x9b5de5, a * 0.4);
    strokePath(g, main, 3, 0xffffff, a);
    for (let i = 2; i < main.length - 1; i += 2) {
      const dir = rr(0, Math.PI * 2);
      const tip = { x: main[i].x + Math.cos(dir) * rr(8, 18), y: main[i].y + Math.sin(dir) * rr(8, 18) };
      strokePath(g, boltPoints(main[i], tip, 3, 6), 1.6, 0xd9b8ff, a * 0.8);
    }
  });
}

// 天雷无妄·飞剑命中：金色金属火花扇 + 光环
function fxSwordHit(to: Vec2, add: (e: Effect) => void): Effect {
  add(particles(to, 8, { speed: [50, 150], size: [1.5, 3], color: [0xf4d35e, 0xfff3b0], life: [0.15, 0.3] }));
  return timed(0.2, (g, p) => {
    const a = 1 - p;
    g.circle(to.x, to.y, 8 + 12 * easeOut(p)).stroke({ width: 3 * a, color: 0xf4d35e, alpha: a });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.3;
      const rad = 6 + 16 * easeOut(p);
      g.moveTo(to.x, to.y).lineTo(to.x + Math.cos(ang) * rad, to.y + Math.sin(ang) * rad).stroke({ width: 2 * a, color: 0xfff3b0, alpha: a });
    }
  });
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
        case 'xun': e = fxXun(from, to, this.add); break;
        case 'kan': e = fxKan(from, to, this.add, ev.delay); break;
        case 'gen': e = fxGen(from, to, this.add); break;
        case 'dui': e = fxDui(from, to, this.add, ev.delay); break;
        case 'kun': e = fxKun(from, to, this.add); break;
      }
      if (e) this.add(e);
    } else if (ev.t === 'rider') {
      const to = px(ev.to); const from = ev.from ? px(ev.from) : to;
      if (ev.effect === 'chainLightning') this.add(fxChain(from, to, this.add));
      else if (ev.effect === 'goldSword') this.add(fxGoldSword(to, this.add));
      else if (ev.effect === 'steamBurst') this.add(fxSteam(to, this.add));
      else if (ev.effect === 'fireTornado') this.add(fxTornado(to, this.add));
      else if (ev.effect === 'iceShatter') this.add(fxIceShatter(to, this.add));
      else if (ev.effect === 'flameSword') this.add(fxFlameSword(from, to, this.add));
      else if (ev.effect === 'volcano') this.add(fxVolcano(to, this.add));
      else if (ev.effect === 'vortex') this.add(fxVortex(to, this.add));
      else if (ev.effect === 'conduct') this.add(fxConduct(from, to, this.add));
      else if (ev.effect === 'swordHit') this.add(fxSwordHit(to, this.add));
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
