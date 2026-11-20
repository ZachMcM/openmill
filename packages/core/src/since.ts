const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

const DURATION = /^([1-9]\d*)([mhdw])$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

export function parseSince(input: string, now: Date): Date {
  const duration = DURATION.exec(input);

  if (duration) {
    return new Date(
      now.getTime() - Number(duration[1]) * UNIT_MS[duration[2] as keyof typeof UNIT_MS],
    );
  }

  const date = DATE.exec(input);

  if (date) {
    const [year, month, day] = date.slice(1).map(Number) as [number, number, number];
    const midnight = new Date(year, month - 1, day);

    if (midnight.getMonth() === month - 1 && midnight.getDate() === day) {
      return midnight;
    }
  }

  if (TIMESTAMP.test(input)) {
    const timestamp = new Date(input);

    if (!Number.isNaN(timestamp.getTime())) {
      return timestamp;
    }
  }

  throw new Error(
    `invalid --since value "${input}" (use a duration like 3d or a date like 2026-11-01)`,
  );
}
