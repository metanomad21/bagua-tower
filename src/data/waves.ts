// 波次定义（GDD §11 节奏，占位数值待 §14③）。12 回合线性变强。
// 怪血量 = (WAVE_BASE_HP + 回合 × WAVE_HP_GROWTH × 难度成长倍率) × 难度血量倍率。

export const WAVE_BASE_HP = 10;
export const WAVE_HP_GROWTH = 6;

export interface WaveDef {
  count: number; // 出怪数
  speed: number; // 环绕速度（圈/秒，正常）
  interval: number; // 出怪间隔（秒）
}

export const WAVES: WaveDef[] = Array.from({ length: 12 }, (_, i) => ({
  count: 4 + i * 2,
  speed: 0.05 + i * 0.004,
  interval: Math.max(0.3, 0.9 - i * 0.03),
}));
