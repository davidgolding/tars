import dotenv from 'dotenv';
import removeMd from 'remove-markdown';
import { initDb, getDueSchedules, updateSchedule, getAgentContext } from './db.js';
import { getNextCronDate } from './cron.js';
import { channelManager } from './plugins/channel-manager.js';

dotenv.config();

const MAX_ITERATIONS = parseInt(process.env.LLM_MAX_ITERATIONS || '35', 10);

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

async function broadcastMessage(message: string): Promise<void> {
    const enabledPlugins = channelManager.getEnabledPlugins();
    if (enabledPlugins.length === 0) {
        console.warn('[Scheduler] No enabled channel plugins to broadcast to.');
        return;
    }

    for (const plugin of enabledPlugins) {
        try {
            // Send to the first configured recipient for each plugin
            // Plugins handle their own recipient resolution
            await plugin.send('broadcast', message);
        } catch (err) {
            console.error(`[Scheduler] Failed to send via ${plugin.id}:`, err);
        }
    }
}

async function main() {
    initDb();

    // Load channel plugins for broadcasting
    await channelManager.loadPlugins();

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

            await broadcastMessage(response);
            console.log(`[Scheduler] Sent result for "${schedule.name}".`);
        } catch (err) {
            console.error(`[Scheduler] Error executing "${schedule.name}":`, err);
            try {
                const name = getAgentName();
                await broadcastMessage(`${name}: [Scheduled task "${schedule.name}" failed: ${err instanceof Error ? err.message : String(err)}]`);
            } catch {
                // Best effort
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
