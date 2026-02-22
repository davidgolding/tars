import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { Workspace, LocalFilesystem, LocalSandbox } from '@mastra/core/workspace';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { google } from '@ai-sdk/google';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { MCPClient } from '../../mcp.js';
import { getSetting, getAgentContext, getAllAgentContextCategories, dbPath } from '../../db.js';
import { getCurrentTimeTool } from '../tools/time.js';
import { webSearchTool, readUrlTool } from '../tools/search.js';
import { listContextCategoriesTool, readContextTool, updateContextTool, deleteContextTool } from '../tools/context.js';
import { getSettingTool, updateSettingTool } from '../tools/setting.js';
import dotenv from 'dotenv';

dotenv.config();

const WORKSPACE_PATH = process.env.WORKSPACE_PATH!;

function buildBootstrapPrompt(): string {
    return getSetting('bootstrap_prompt') ?? 'ERROR: Notify user "Sorry, but I have run into an error and cannot continue."';
}

function buildSystemPrompt(): string {
    let prompt = `# STRICT IDENTITY\n\nYou are an AI agent operating within a secure wrapper.\n\n`;

    const agentsContext = getAgentContext('AGENTS');
    if (agentsContext) {
        prompt += agentsContext + '\n\n';
    }

    const categories = getAllAgentContextCategories();
    for (const cat of categories) {
        if (cat === 'AGENTS' || cat === 'SYSTEM' || cat === 'BOOTSTRAP' || cat === 'USER') continue;
        const content = getAgentContext(cat);
        if (content) {
            prompt += `<CONTEXT:${cat.toUpperCase()}>\n\n${content}\n\n</CONTEXT:${cat.toUpperCase()}>\n\n`;
        }
    }

    prompt += 'Do not call web_search more than 3 consecutive times.\n';

    return prompt;
}

const memory = new Memory({
    storage: new LibSQLStore({
        id: 'tars-memory-storage',
        url: `file:${dbPath}`,
    }),
    vector: new LibSQLVector({
        id: 'tars-vector',
        url: `file:${dbPath}`,
    }),
    embedder: google.textEmbeddingModel('gemini-embedding-001'),
    options: {
        lastMessages: 10,
        semanticRecall: {
            topK: 5,
            messageRange: { before: 2, after: 1 },
        },
        workingMemory: {
            enabled: true,
            scope: 'resource',
            template: getAgentContext('USER') ?? `User Profile:\n - Name:\n -What to call them:\n - Location:\n - Notes:`,
        },
    },
});

const allowedPathsStr = process.env.WORKSPACE_ALLOWED_PATHS || '';
const allowedPaths = allowedPathsStr.split(',').map(p => p.trim()).filter(p => p.length > 0);

const filesystem = new LocalFilesystem({
    basePath: WORKSPACE_PATH,
    ...(allowedPaths.length > 0 ? { allowedPaths } : {})
});

const sandbox = new LocalSandbox({
    workingDirectory: WORKSPACE_PATH,
});

const workspace = new Workspace({
    filesystem: filesystem,
    sandbox: sandbox,
    skills: ['/.agents/skills', '/skills'],
    bm25: true,
    tools: {
        mastra_workspace_execute_command: {
            enabled: false
        }
    }
});

const overrideExecuteCommandTool = createTool({
    id: 'mastra_workspace_execute_command',
    description: 'Execute a shell command in the workspace sandbox. Verify parent directories exist before running.',
    inputSchema: z.object({
        command: z.string().describe("The command to execute (e.g., 'ls', 'npm')"),
        args: z.string().describe("Arguments to pass to the command as a space-separated string (e.g. '-al' or 'install --save'). Pass an empty string if none."),
        timeout: z.number().describe("Maximum execution time in milliseconds. Example: 60000 for 1 minute."),
        cwd: z.string().describe("Working directory for the command. Pass an empty string if using the default.")
    }),
    execute: async (context) => {
        if (!workspace.sandbox) throw new Error("Sandbox not configured for workspace");
        const argsArray = context.args ? context.args.split(' ').filter(arg => arg.trim() !== '') : [];
        return await workspace.sandbox.executeCommand?.(
            context.command,
            argsArray,
            {
                timeout: context.timeout,
                cwd: context.cwd ? context.cwd : undefined
            }
        );
    }
});

const builtinTools = {
    get_current_time: getCurrentTimeTool,
    web_search: webSearchTool,
    read_url: readUrlTool,
    list_context_categories: listContextCategoriesTool,
    read_context: readContextTool,
    update_context: updateContextTool,
    delete_context: deleteContextTool,
    get_setting: getSettingTool,
    update_setting: updateSettingTool,
    mastra_workspace_execute_command: overrideExecuteCommandTool,
};

function mcpToolToMastraTool(mcpTool: any, client: MCPClient) {
    return createTool({
        id: mcpTool.name,
        description: mcpTool.description ?? mcpTool.name,
        inputSchema: z.record(z.string(), z.unknown()),
        execute: async (inputData) => client.callTool(mcpTool.name, inputData),
    });
}

export async function createAgents() {
    let mcpTools: Record<string, any> = {};
    const cmd = process.env.MCP_SERVER_COMMAND;
    if (cmd) {
        const [command, ...args] = cmd.split(' ');
        const client = new MCPClient(command, args);
        try {
            await client.connect();
            const tools = await client.listTools();
            mcpTools = Object.fromEntries(
                tools.map((t: any) => [t.name, mcpToolToMastraTool(t, client)])
            );
            console.log(`[Agent] Loaded ${tools.length} tools from MCP server.`);
        } catch (err) {
            console.error('[Agent] Failed to initialize MCP:', err);
        }
    }

    const tarsAgent = new Agent({
        id: 'tars',
        name: 'Tars',
        instructions: buildSystemPrompt,
        model: google(process.env.GEMINI_API_MODEL ?? 'gemini-flash-latest'),
        tools: { ...builtinTools, ...mcpTools },
        memory,
        workspace,
    });

    const bootstrapAgent = new Agent({
        id: 'bootstrap',
        name: 'Bootstrap',
        instructions: buildBootstrapPrompt,
        model: google(process.env.GEMINI_API_MODEL ?? 'gemini-flash-latest'),
        memory,
        // Give bootstrap agent strictly what it needs to initialize context
        tools: {
            update_context: updateContextTool,
            update_setting: updateSettingTool
        }
    });

    return { tarsAgent, bootstrapAgent };
}
