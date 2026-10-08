import { MatchStatus, formatMinute, statusShortLabel } from '@scoreline/shared';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-24">
      <p className="text-sm font-semibold uppercase tracking-widest text-emerald-500">
        {statusShortLabel(MatchStatus.SecondHalf)} · {formatMinute(90, 3)}
      </p>
      <h1 className="text-4xl font-bold tracking-tight">Scoreline</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Real-time football scores, line-ups and tables. Coming soon.
      </p>
    </main>
  );
}
