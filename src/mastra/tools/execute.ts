import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { workspace } from '../workspace.js';

export const overrideExecuteCommandTool = createTool({
    id: 'execute_command',
    description: `Execute a shell command in the workspace sandbox. Verify parent directories exist before running.
IMPORTANT: The 'command' argument must be the actual shell executable (e.g. 'pnpx'). Do NOT pass the name of this tool as the command!`,
    inputSchema: z.object({
        command: z.string().describe("The command to execute (e.g., 'pnpx', 'npm', 'ls')"),
        args: z.string().optional().default('').describe("Arguments to pass to the command as a space-separated string (e.g. '-al' or 'install --save'). Pass an empty string if none."),
        timeout: z.number().optional().default(60000).describe("Maximum execution time in milliseconds. Example: 60000 for 1 minute."),
        cwd: z.string().optional().default('').describe("Working directory for the command. Pass an empty string if using the default.")
    }),
    execute: async (input, context: any) => {
        if (!workspace.sandbox) throw new Error("Sandbox not configured for workspace");
        const argsArray = input.args ? input.args.split(' ').filter(arg => arg.trim() !== '') : [];

        let targetCwd = undefined;
        if (input.cwd) {
            const path = await import('path');
            targetCwd = path.resolve(workspace.sandbox.workingDirectory!, input.cwd);
        }

        const toolCallId = context?.agent?.toolCallId;
        const startedAt = Date.now();
        let stdout = "";
        let stderr = "";

        try {
            const result = await workspace.sandbox.executeCommand?.(input.command, argsArray, {
                timeout: input.timeout,
                cwd: targetCwd,
                onStdout: async (data: string) => {
                    stdout += data;
                    if (context?.writer) {
                        await context.writer.custom({
                            type: 'data-sandbox-stdout',
                            data: { output: data, timestamp: Date.now(), toolCallId }
                        });
                    }
                },
                onStderr: async (data: string) => {
                    stderr += data;
                    if (context?.writer) {
                        await context.writer.custom({
                            type: 'data-sandbox-stderr',
                            data: { output: data, timestamp: Date.now(), toolCallId }
                        });
                    }
                }
            });

            if (context?.writer) {
                await context.writer.custom({
                    type: 'data-sandbox-exit',
                    data: {
                        exitCode: result?.exitCode,
                        success: result?.success,
                        executionTimeMs: result?.executionTimeMs,
                        toolCallId
                    }
                });
            }

            if (!result?.success) {
                const parts = [result?.stdout, result?.stderr].filter(Boolean);
                parts.push(`Exit code: ${result?.exitCode}`);
                return parts.join("\n");
            }
            return result?.stdout || "(no output)";
        } catch (error) {
            if (context?.writer) {
                await context.writer.custom({
                    type: 'data-sandbox-exit',
                    data: {
                        exitCode: -1,
                        success: false,
                        executionTimeMs: Date.now() - startedAt,
                        toolCallId
                    }
                });
            }
            const errorMessage = error instanceof Error ? error.message : String(error);
            const parts = [stdout, stderr, `Error: ${errorMessage}`].filter(Boolean);
            return parts.join("\n");
        }
    }
});
