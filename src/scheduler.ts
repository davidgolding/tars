import dotenv from 'dotenv';
import removeMd from 'remove-markdown';
import { execSync } from 'node:child_process';
import { initDb, getDueSchedules, updateSchedule, getAgentContext } from './db.js';
import { getNextCronDate } from './cron.js';

dotenv.config();

const BOT_SIGNAL_NUMBER = process.env.BOT_SIGNAL_NUMBER;
const TARGET_SIGNAL_NUMBER = process.env.TARGET_SIGNAL_NUMBER;
const TARGET_SIGNAL_GROUP = process.env.TARGET_SIGNAL_GROUP;
const MAX_ITERATIONS = parseInt(process.env.LLM_MAX_ITERATIONS || '35', 10);

function sendSignalDirect(message: string): void {
    const args = ['-u', BOT_SIGNAL_NUMBER!, 'send', '-m', message];

    if (TARGET_SIGNAL_GROUP) {
        // For group sends, we need the group ID — but we only have the name.
        // Fall back to DM if we can't resolve it. The group approach requires
        // the signal-cli daemon for listGroups. Use DM for scheduler messages.
        args.push(TARGET_SIGNAL_NUMBER!);
    } else {
        args.push(TARGET_SIGNAL_NUMBER!);
    }

    execSync(`signal-cli ${args.map(a => JSON.stringify(a)).join(' ')}`, {
        encoding: 'utf-8',
        timeout: 30_000,
    });
}

function getAgentName(): string {
    const identity = getAgentContext('IDENTITY');
    if (!identity) return 'Tars';

    const match = identity.match(/- \*\*Name:\*\*(.*?)(?=\n- \*\*|$)/s);
    if (match) {
        const name = match[1].trim();
        if (name && !name.includes('_(pick something')) {
            return name;
        }
    }
    return 'Tars';
}

async function main() {
    if (!BOT_SIGNAL_NUMBER || !TARGET_SIGNAL_NUMBER) {
        console.error('[Scheduler] Missing BOT_SIGNAL_NUMBER or TARGET_SIGNAL_NUMBER.');
        process.exit(1);
    }

    initDb();

    const due = getDueSchedules();
    if (due.length === 0) {
        console.log('[Scheduler] No schedules due. Exiting.');
        process.exit(0);
    }

    console.log(`[Scheduler] ${due.length} schedule(s) due. Processing...`);

    // Lazy-load the agent (heavy import — only load if we have work to do)
    const { createAgents } = await import('./mastra/agents/tars.js');
    const { tarsAgent } = await createAgents();

    for (const schedule of due) {
        console.log(`[Scheduler] Running: "${schedule.name}" (${schedule.id})`);

        try {
            const result = await tarsAgent.generate(schedule.task, {
                maxSteps: MAX_ITERATIONS,
            });

            let response = removeMd(result.text);
            const name = getAgentName();
            response = `${name}: ${response}`;

            sendSignalDirect(response);
            console.log(`[Scheduler] Sent result for "${schedule.name}".`);
        } catch (err) {
            console.error(`[Scheduler] Error executing "${schedule.name}":`, err);
            try {
                const name = getAgentName();
                sendSignalDirect(`${name}: [Scheduled task "${schedule.name}" failed: ${err instanceof Error ? err.message : String(err)}]`);
            } catch {
                // Best effort — if Signal send also fails, just log it
            }
        }

        // Update schedule state
        const now = new Date().toISOString();
        if (schedule.cron_expression) {
            const nextRun = getNextCronDate(schedule.cron_expression, new Date());
            updateSchedule(schedule.id, {
                last_run_at: now,
                next_run_at: nextRun.toISOString(),
                run_count: schedule.run_count + 1,
            });
        } else {
            // One-shot: disable after execution
            updateSchedule(schedule.id, {
                last_run_at: now,
                enabled: 0,
                run_count: schedule.run_count + 1,
            });
        }
    }

    console.log('[Scheduler] Done.');
    process.exit(0);
}

main().catch(err => {
    console.error('[Scheduler] Fatal error:', err);
    process.exit(1);
});
