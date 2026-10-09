import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import {
  DEFAULT_TIMEZONE,
  type MatchSummary,
  isIsoDate,
  isValidTimeZone,
  localDate,
} from '@scoreline/shared';
import { z } from 'zod';
import { FootballQueryService } from './football-query.service.js';

const slug = z.string().regex(/^[a-z0-9-]{1,120}$/, 'invalid id');
const isoDate = z.string().refine(isIsoDate, 'must be YYYY-MM-DD');

const dayQuery = z.object({
  date: isoDate.optional(),
  tz: z.string().max(64).refine(isValidTimeZone, 'unknown time zone').default(DEFAULT_TIMEZONE),
  status: z.enum(['all', 'live', 'finished', 'upcoming']).default('all'),
});

const competitionMatchesQuery = z.object({
  matchday: z.coerce.number().int().min(1).max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

@Controller('v1')
export class FootballController {
  constructor(private readonly query: FootballQueryService) {}

  /** Matches on one local calendar day, grouped by competition. */
  @Get('matches')
  matches(@Query() raw: unknown) {
    const q = parse(dayQuery, raw);
    const date = q.date ?? localDate(new Date(), q.tz);
    return this.query.matchesByDay(date, q.tz, q.status);
  }

  @Get('matches/live')
  async live(): Promise<{ matches: MatchSummary[] }> {
    return { matches: await this.query.liveMatches() };
  }

  @Get('matches/:id')
  match(@Param('id') id: string) {
    return this.query.matchDetail(parse(slug, id));
  }

  @Get('matches/:id/updates')
  updates(@Param('id') id: string, @Query('since') since?: string) {
    const sinceSeq = parse(z.coerce.number().int().min(0).default(0), since);
    return this.query.matchUpdates(parse(slug, id), sinceSeq);
  }

  @Get('competitions')
  async competitions() {
    return { competitions: await this.query.competitions() };
  }

  @Get('competitions/:slug')
  competition(@Param('slug') s: string) {
    return this.query.competition(parse(slug, s));
  }

  @Get('competitions/:slug/standings')
  async standings(@Param('slug') s: string) {
    return { tables: await this.query.standings(parse(slug, s)) };
  }

  @Get('competitions/:slug/matches')
  async competitionMatches(@Param('slug') s: string, @Query() raw: unknown) {
    const q = parse(competitionMatchesQuery, raw);
    return { matches: await this.query.competitionMatches(parse(slug, s), q) };
  }

  @Get('competitions/:slug/scorers')
  async scorers(@Param('slug') s: string) {
    return { scorers: await this.query.scorers(parse(slug, s)) };
  }

  @Get('teams/:slug')
  team(@Param('slug') s: string) {
    return this.query.team(parse(slug, s));
  }

  @Get('search')
  search(@Query('q') q?: string) {
    const term = parse(z.string().trim().min(2, 'type at least 2 characters').max(50), q ?? '');
    return this.query.search(term);
  }
}
