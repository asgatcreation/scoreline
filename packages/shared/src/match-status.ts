/**
 * Provider-independent match status. Every provider adapter maps its own
 * status codes onto these values before anything is stored or broadcast.
 */
export const MatchStatus = {
  Scheduled: 'SCHEDULED',
  FirstHalf: 'FIRST_HALF',
  HalfTime: 'HALF_TIME',
  SecondHalf: 'SECOND_HALF',
  ExtraTime: 'EXTRA_TIME',
  BreakExtraTime: 'BREAK_EXTRA_TIME',
  Penalties: 'PENALTIES',
  Finished: 'FINISHED',
  Postponed: 'POSTPONED',
  Suspended: 'SUSPENDED',
  Cancelled: 'CANCELLED',
  Abandoned: 'ABANDONED',
} as const;

export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

const LIVE: ReadonlySet<MatchStatus> = new Set([
  MatchStatus.FirstHalf,
  MatchStatus.HalfTime,
  MatchStatus.SecondHalf,
  MatchStatus.ExtraTime,
  MatchStatus.BreakExtraTime,
  MatchStatus.Penalties,
]);

const ENDED: ReadonlySet<MatchStatus> = new Set([
  MatchStatus.Finished,
  MatchStatus.Cancelled,
  MatchStatus.Abandoned,
]);

/** True while the match is in play, including breaks (HT, before ET). */
export function isLive(status: MatchStatus): boolean {
  return LIVE.has(status);
}

/** True once the result will not change any more. */
export function isEnded(status: MatchStatus): boolean {
  return ENDED.has(status);
}

/** Minute clock is only ticking while the ball is in play. */
export function isClockRunning(status: MatchStatus): boolean {
  return (
    status === MatchStatus.FirstHalf ||
    status === MatchStatus.SecondHalf ||
    status === MatchStatus.ExtraTime
  );
}

const SHORT_LABEL: Record<MatchStatus, string> = {
  SCHEDULED: 'NS',
  FIRST_HALF: '1H',
  HALF_TIME: 'HT',
  SECOND_HALF: '2H',
  EXTRA_TIME: 'ET',
  BREAK_EXTRA_TIME: 'BT',
  PENALTIES: 'PENS',
  FINISHED: 'FT',
  POSTPONED: 'PST',
  SUSPENDED: 'SUSP',
  CANCELLED: 'CANC',
  ABANDONED: 'ABD',
};

export function statusShortLabel(status: MatchStatus): string {
  return SHORT_LABEL[status];
}
