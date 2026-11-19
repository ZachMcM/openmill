export const FAST_LANE_BUDGET_PER_MINUTE = 600;

export function fastLaneInterval(requestsPerTick: number): number {
  return Math.max(1, (requestsPerTick * 60) / FAST_LANE_BUDGET_PER_MINUTE);
}
