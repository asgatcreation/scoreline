export const EventType = {
  Goal: 'GOAL',
  OwnGoal: 'OWN_GOAL',
  PenaltyGoal: 'PENALTY_GOAL',
  MissedPenalty: 'MISSED_PENALTY',
  YellowCard: 'YELLOW_CARD',
  SecondYellow: 'SECOND_YELLOW',
  RedCard: 'RED_CARD',
  Substitution: 'SUBSTITUTION',
  Var: 'VAR',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const Side = { Home: 'HOME', Away: 'AWAY' } as const;
export type Side = (typeof Side)[keyof typeof Side];

const SCORING: ReadonlySet<EventType> = new Set([
  EventType.Goal,
  EventType.OwnGoal,
  EventType.PenaltyGoal,
]);

/** Goals of any kind. An own goal is recorded on the side that benefits. */
export function isGoalEvent(type: EventType): boolean {
  return SCORING.has(type);
}
