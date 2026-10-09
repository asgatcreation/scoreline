-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'FIRST_HALF', 'HALF_TIME', 'SECOND_HALF', 'EXTRA_TIME', 'BREAK_EXTRA_TIME', 'PENALTIES', 'FINISHED', 'POSTPONED', 'SUSPENDED', 'CANCELLED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('GOAL', 'OWN_GOAL', 'PENALTY_GOAL', 'MISSED_PENALTY', 'YELLOW_CARD', 'SECOND_YELLOW', 'RED_CARD', 'SUBSTITUTION', 'VAR');

-- CreateEnum
CREATE TYPE "CompetitionType" AS ENUM ('LEAGUE', 'CUP');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('DEMO', 'API_FOOTBALL', 'FOOTBALL_DATA');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('COMPETITION', 'TEAM', 'PLAYER', 'MATCH', 'VENUE');

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "type" "CompetitionType" NOT NULL DEFAULT 'LEAGUE',
    "emblemUrl" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "currentMatchday" INTEGER,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "tla" TEXT,
    "crestUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "country" TEXT,
    "founded" INTEGER,
    "isNational" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "venueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "nationality" TEXT,
    "dateOfBirth" DATE,
    "photoUrl" TEXT,
    "shirtNumber" INTEGER,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "seasonId" TEXT,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "venueId" TEXT,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "minute" INTEGER,
    "injuryTime" INTEGER,
    "periodStartedAt" TIMESTAMP(3),
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "htHome" INTEGER,
    "htAway" INTEGER,
    "etHome" INTEGER,
    "etAway" INTEGER,
    "penHome" INTEGER,
    "penAway" INTEGER,
    "round" TEXT,
    "matchday" INTEGER,
    "referee" TEXT,
    "attendance" INTEGER,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "liveSyncedAt" TIMESTAMP(3),
    "detailsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "side" "Side" NOT NULL,
    "minute" INTEGER NOT NULL,
    "extraMinute" INTEGER,
    "playerId" TEXT,
    "playerName" TEXT,
    "assistId" TEXT,
    "assistName" TEXT,
    "detail" TEXT,
    "providerKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lineup" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "formation" TEXT,
    "coachName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineupPlayer" (
    "id" TEXT NOT NULL,
    "lineupId" TEXT NOT NULL,
    "playerId" TEXT,
    "name" TEXT NOT NULL,
    "number" INTEGER,
    "position" TEXT,
    "grid" TEXT,
    "isStarter" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LineupPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchStat" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "homeValue" DOUBLE PRECISION,
    "awayValue" DOUBLE PRECISION,
    "unit" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Standing" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "played" INTEGER NOT NULL,
    "won" INTEGER NOT NULL,
    "drawn" INTEGER NOT NULL,
    "lost" INTEGER NOT NULL,
    "goalsFor" INTEGER NOT NULL,
    "goalsAgainst" INTEGER NOT NULL,
    "goalDiff" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "form" TEXT,
    "zone" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Standing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopScorer" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "goals" INTEGER NOT NULL,
    "assists" INTEGER,
    "penalties" INTEGER,
    "played" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopScorer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRef" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsage" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "changes" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchUpdate" (
    "id" BIGSERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushFollow" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "teamId" TEXT,
    "competitionId" TEXT,
    "goals" BOOLEAN NOT NULL DEFAULT true,
    "kickoff" BOOLEAN NOT NULL DEFAULT true,
    "halfTime" BOOLEAN NOT NULL DEFAULT false,
    "fullTime" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Competition_slug_key" ON "Competition"("slug");

-- CreateIndex
CREATE INDEX "Competition_priority_idx" ON "Competition"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "Season_competitionId_year_key" ON "Season"("competitionId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_name_idx" ON "Team"("name");

-- CreateIndex
CREATE INDEX "Player_teamId_idx" ON "Player"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_name_city_key" ON "Venue"("name", "city");

-- CreateIndex
CREATE UNIQUE INDEX "Match_slug_key" ON "Match"("slug");

-- CreateIndex
CREATE INDEX "Match_kickoffAt_idx" ON "Match"("kickoffAt");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Match_competitionId_kickoffAt_idx" ON "Match"("competitionId", "kickoffAt");

-- CreateIndex
CREATE INDEX "Match_homeTeamId_kickoffAt_idx" ON "Match"("homeTeamId", "kickoffAt");

-- CreateIndex
CREATE INDEX "Match_awayTeamId_kickoffAt_idx" ON "Match"("awayTeamId", "kickoffAt");

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_minute_idx" ON "MatchEvent"("matchId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "MatchEvent_matchId_providerKey_key" ON "MatchEvent"("matchId", "providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "Lineup_matchId_side_key" ON "Lineup"("matchId", "side");

-- CreateIndex
CREATE INDEX "LineupPlayer_lineupId_idx" ON "LineupPlayer"("lineupId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchStat_matchId_type_key" ON "MatchStat"("matchId", "type");

-- CreateIndex
CREATE INDEX "Standing_seasonId_group_position_idx" ON "Standing"("seasonId", "group", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Standing_seasonId_group_teamId_key" ON "Standing"("seasonId", "group", "teamId");

-- CreateIndex
CREATE INDEX "TopScorer_seasonId_rank_idx" ON "TopScorer"("seasonId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "TopScorer_seasonId_playerName_teamId_key" ON "TopScorer"("seasonId", "playerName", "teamId");

-- CreateIndex
CREATE INDEX "ExternalRef_entityType_internalId_idx" ON "ExternalRef"("entityType", "internalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRef_provider_entityType_externalId_key" ON "ExternalRef"("provider", "entityType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderUsage_provider_day_key" ON "ProviderUsage"("provider", "day");

-- CreateIndex
CREATE INDEX "IngestRun_startedAt_idx" ON "IngestRun"("startedAt");

-- CreateIndex
CREATE INDEX "MatchUpdate_createdAt_idx" ON "MatchUpdate"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchUpdate_matchId_seq_key" ON "MatchUpdate"("matchId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushFollow_teamId_idx" ON "PushFollow"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PushFollow_subscriptionId_teamId_key" ON "PushFollow"("subscriptionId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PushFollow_subscriptionId_competitionId_key" ON "PushFollow"("subscriptionId", "competitionId");

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupPlayer" ADD CONSTRAINT "LineupPlayer_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "Lineup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchStat" ADD CONSTRAINT "MatchStat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Standing" ADD CONSTRAINT "Standing_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Standing" ADD CONSTRAINT "Standing_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopScorer" ADD CONSTRAINT "TopScorer_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopScorer" ADD CONSTRAINT "TopScorer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchUpdate" ADD CONSTRAINT "MatchUpdate_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushFollow" ADD CONSTRAINT "PushFollow_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushFollow" ADD CONSTRAINT "PushFollow_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushFollow" ADD CONSTRAINT "PushFollow_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
