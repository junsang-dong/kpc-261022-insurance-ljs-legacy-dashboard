import type { ScoringConfig } from '../shared/types/index.ts';

/** public/data/seed/scoring.json 과 같은 값 (시드를 불러오지 못할 때의 폴백이자 단위 테스트 기준) */
export const DEFAULT_SCORING: ScoringConfig = {
  severityWeights: { critical: 10, high: 5, medium: 2, low: 0.5, info: 0 },
  normalization: { os: 40, jdk: 30, framework: 150, cloud: 40 },
  weights: { os: 0.2, jdk: 0.2, framework: 0.3, criticality: 0.15, integration: 0.15 },
  grades: { medium: 30, high: 60, critical: 80 },
};
