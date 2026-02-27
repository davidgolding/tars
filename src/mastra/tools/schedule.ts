import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
    createSchedule as dbCreateSchedule,
    listSchedules as dbListSchedules,
    getSchedule as dbGetSchedule,
    updateSchedule as dbUpdateSchedule,
    deleteSchedule as dbDeleteSchedule,
} from '../../db.js';
import { getNextCronDate } from '../../cron.js';

export const createScheduleTool = createTool({
    id: 'create_schedule',
    description:
        'Create a scheduled task. For recurring tasks, provide a cronExpression (5-field cron: minute hour day-of-month month day-of-week). For one-shot tasks, provide runAt (ISO-8601 timestamp). The task is a prompt that will be sent to you (the agent) for autonomous execution when the schedule fires.',
    inputSchema: z.object({
        name: z.string().describe('Human-readable label for this schedule (e.g., "Daily weather briefing")'),
        task: z.string().describe('The prompt to execute when the schedule fires (e.g., "Check the weather for Denver and send me a summary")'),
        cronExpression: z
            .string()
            .optional()
            .describe('Standard 5-field cron expression for recurring tasks (e.g., "0 8 * * *" for daily at 8am). Omit for one-shot tasks.'),
        runAt: z
            .string()
            .optional()
            .describe('ISO-8601 timestamp for when to run. Required for one-shot tasks. For cron tasks, sets the initial run time (defaults to next cron occurrence).'),
    }),
    execute: async (input) => {
        if (!input.cronExpression && !input.runAt) {
            return { error: 'Either cronExpression (for recurring) or runAt (for one-shot) is required.' };
        }

        let nextRunAt: string;

        if (input.cronExpression) {
            if (input.runAt) {
                nextRunAt = new Date(input.runAt).toISOString();
            } else {
                nextRunAt = getNextCronDate(input.cronExpression, new Date()).toISOString();
            }
        } else {
            const runAtDate = new Date(input.runAt!);
            if (isNaN(runAtDate.getTime())) {
                return { error: `Invalid runAt timestamp: ${input.runAt}` };
            }
            nextRunAt = runAtDate.toISOString();
        }

        const id = randomUUID();
        dbCreateSchedule({
            id,
            name: input.name,
            task: input.task,
            cron_expression: input.cronExpression ?? null,
            next_run_at: nextRunAt,
            enabled: 1,
        });

        return {
            id,
            name: input.name,
            nextRunAt,
            recurring: !!input.cronExpression,
        };
    },
});

export const listSchedulesTool = createTool({
    id: 'list_schedules',
    description: 'List all scheduled tasks with their status, next run time, last run time, and run count.',
    inputSchema: z.object({}),
    execute: async () => {
        const schedules = dbListSchedules();
        return {
            count: schedules.length,
            schedules: schedules.map(s => ({
                id: s.id,
                name: s.name,
                task: s.task,
                cronExpression: s.cron_expression,
                nextRunAt: s.next_run_at,
                lastRunAt: s.last_run_at,
                enabled: s.enabled === 1,
                runCount: s.run_count,
                recurring: !!s.cron_expression,
            })),
        };
    },
});

export const updateScheduleTool = createTool({
    id: 'update_schedule',
    description: 'Update a scheduled task. You can change the name, task prompt, cron expression, or enable/disable it.',
    inputSchema: z.object({
        id: z.string().describe('The schedule ID to update'),
        name: z.string().optional().describe('New name for the schedule'),
        task: z.string().optional().describe('New task prompt'),
        cronExpression: z.string().optional().describe('New cron expression (recomputes next run time)'),
        enabled: z.boolean().optional().describe('Set to false to pause, true to resume'),
    }),
    execute: async (input) => {
        const existing = dbGetSchedule(input.id);
        if (!existing) {
            return { error: `Schedule not found: ${input.id}` };
        }

        const updates: Record<string, any> = {};

        if (input.name !== undefined) updates.name = input.name;
        if (input.task !== undefined) updates.task = input.task;
        if (input.enabled !== undefined) updates.enabled = input.enabled ? 1 : 0;

        if (input.cronExpression !== undefined) {
            updates.cron_expression = input.cronExpression;
            updates.next_run_at = getNextCronDate(input.cronExpression, new Date()).toISOString();
        }

        dbUpdateSchedule(input.id, updates);

        const updated = dbGetSchedule(input.id);
        return {
            id: updated!.id,
            name: updated!.name,
            task: updated!.task,
            cronExpression: updated!.cron_expression,
            nextRunAt: updated!.next_run_at,
            enabled: updated!.enabled === 1,
        };
    },
});

export const deleteScheduleTool = createTool({
    id: 'delete_schedule',
    description: 'Delete a scheduled task permanently.',
    inputSchema: z.object({
        id: z.string().describe('The schedule ID to delete'),
    }),
    execute: async (input) => {
        const existing = dbGetSchedule(input.id);
        if (!existing) {
            return { error: `Schedule not found: ${input.id}` };
        }

        dbDeleteSchedule(input.id);
        return { success: true, message: `Deleted schedule: ${existing.name}` };
    },
});
