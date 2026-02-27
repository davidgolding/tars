/**
 * Lightweight 5-field cron expression parser.
 * Supports: *, specific values, comma-separated lists, ranges (1-5), step values (asterisk/15).
 * Fields: minute hour day-of-month month day-of-week (0=Sunday)
 */

function parseField(field: string, min: number, max: number): number[] {
    const values = new Set<number>();

    for (const part of field.split(',')) {
        const stepMatch = part.match(/^(.+)\/(\d+)$/);
        const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
        const base = stepMatch ? stepMatch[1] : part;

        let start: number;
        let end: number;

        if (base === '*') {
            start = min;
            end = max;
        } else if (base.includes('-')) {
            const [lo, hi] = base.split('-').map(Number);
            start = lo;
            end = hi;
        } else {
            start = parseInt(base, 10);
            end = start;
        }

        for (let i = start; i <= end; i += step) {
            values.add(i);
        }
    }

    return [...values].sort((a, b) => a - b);
}

export function parseCron(expression: string): {
    minutes: number[];
    hours: number[];
    daysOfMonth: number[];
    months: number[];
    daysOfWeek: number[];
} {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
    }

    return {
        minutes: parseField(parts[0], 0, 59),
        hours: parseField(parts[1], 0, 23),
        daysOfMonth: parseField(parts[2], 1, 31),
        months: parseField(parts[3], 1, 12),
        daysOfWeek: parseField(parts[4], 0, 6),
    };
}

/**
 * Compute the next occurrence of a cron expression after the given date.
 * Brute-force minute-by-minute scan — simple and correct for our use case.
 * Gives up after scanning 400 days to avoid infinite loops on impossible expressions.
 */
export function getNextCronDate(expression: string, after: Date): Date {
    const cron = parseCron(expression);
    const limit = 400 * 24 * 60; // max minutes to scan

    // Start from the next whole minute after `after`
    const candidate = new Date(after.getTime());
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    for (let i = 0; i < limit; i++) {
        const month = candidate.getMonth() + 1; // 1-indexed
        const dayOfMonth = candidate.getDate();
        const dayOfWeek = candidate.getDay(); // 0=Sunday
        const hour = candidate.getHours();
        const minute = candidate.getMinutes();

        if (
            cron.months.includes(month) &&
            cron.daysOfMonth.includes(dayOfMonth) &&
            cron.daysOfWeek.includes(dayOfWeek) &&
            cron.hours.includes(hour) &&
            cron.minutes.includes(minute)
        ) {
            return candidate;
        }

        candidate.setMinutes(candidate.getMinutes() + 1);
    }

    throw new Error(`Could not find next occurrence for cron "${expression}" within 400 days`);
}
