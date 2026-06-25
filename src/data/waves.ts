// 波次定义（GDD §11 节奏，占位数值待 §14③）。12 波线性变强。

export interface WaveDef {
  count: number; // 出怪数
  hp: number; // 单怪血量
  speed: number; // 环绕速度（圈/秒）
  interval: number; // 出怪间隔（秒）
}

export const WAVES: WaveDef[] = Array.from({ length: 12 }, (_, i) => ({
  count: 4 + i * 2,
  hp: 10 + i * 6,
  speed: 0.05 + i * 0.004,
  interval: Math.max(0.3, 0.9 - i * 0.03),
}));
