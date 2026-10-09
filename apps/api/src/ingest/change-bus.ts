import { Injectable } from '@nestjs/common';
import type { MatchSummary } from '@scoreline/shared';
import { Subject } from 'rxjs';
import type { MatchChange } from './match-diff.js';

/** Everything that changed in one match during one ingest pass. */
export interface MatchChangeBatch {
  matchId: string;
  competitionSlug: string;
  isDemo: boolean;
  /** Match seq after these changes were applied. */
  seq: number;
  changes: MatchChange[];
  /** The match as it is now, for lists that need the whole row. */
  summary: MatchSummary;
}

/**
 * In-process stream of match changes. Ingest (real data) and the demo
 * service publish; the Socket.IO gateway and push notifier subscribe.
 */
@Injectable()
export class ChangeBus {
  private readonly subject = new Subject<MatchChangeBatch>();
  readonly changes$ = this.subject.asObservable();

  publish(batch: MatchChangeBatch): void {
    if (batch.changes.length > 0) this.subject.next(batch);
  }
}
