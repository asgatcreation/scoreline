/**
 * Formats a match minute the way fans read it: 45+2', 90+4', 67'.
 * `extra` is stoppage time; omit or pass 0 when there is none.
 */
export function formatMinute(minute: number, extra?: number | null): string {
  if (!Number.isFinite(minute) || minute < 0) return '';
  const base = Math.floor(minute);
  return extra && extra > 0 ? `${base}+${Math.floor(extra)}'` : `${base}'`;
}
