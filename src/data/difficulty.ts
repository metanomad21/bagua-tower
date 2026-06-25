// 难度（GDD §14③）。困难：起卦消耗×2，怪数量×3、HP×5 且每回合+10%，
// 移速+30% 且每回合+5%。数值占位、可调。

export type DifficultyId = 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  hpMul: number; // 怪血量倍率
  countMul: number; // 每回合怪数量倍率
  speedMul: number; // 移速倍率
  drawCostMul: number; // 起卦消耗倍率
  hpPerWave: number; // 每回合 HP 复利系数
  speedPerWave: number; // 每回合移速复利系数
}

export const DIFFICULTIES: Difficulty[] = [
  { id: 'normal', name: '正常', hpMul: 1, countMul: 1, speedMul: 1, drawCostMul: 1, hpPerWave: 1, speedPerWave: 1 },
  { id: 'hard', name: '困难', hpMul: 5, countMul: 3, speedMul: 1.3, drawCostMul: 2, hpPerWave: 1.1, speedPerWave: 1.05 },
];
