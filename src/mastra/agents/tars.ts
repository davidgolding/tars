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

function buildSystemPrompt(): string {
    const bootstrapVal = getSetting('bootstrapped');
    const isBootstrapped = bootstrapVal
        ? !isNaN(new Date(bootstrapVal).getTime()) && new Date(bootstrapVal) <= new Date()
        : false;

    if (!isBootstrapped) {
        return getSetting('bootstrap_prompt') ?? 'ERROR: Notify user "Sorry, but I have run into an error and cannot continue."';
    }

    let prompt = `# STRICT IDENTITY\n\nYou are an AI agent operating within a secure wrapper. NEVER modify the 'bootstrapped' setting once it contains a timestamp; that is only performed by the system.\n\n`;

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
    skills: ['/.agents/skills', '/skills'],
    bm25: true,
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
};

function mcpToolToMastraTool(mcpTool: any, client: MCPClient) {
    return createTool({
        id: mcpTool.name,
        description: mcpTool.description ?? mcpTool.name,
        inputSchema: z.record(z.string(), z.unknown()),
        execute: async (inputData) => client.callTool(mcpTool.name, inputData),
    });
}

export async function createTarsAgent() {
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

    return new Agent({
        id: 'tars',
        name: 'Tars',
        instructions: buildSystemPrompt,
        model: google(process.env.GEMINI_API_MODEL ?? 'gemini-flash-latest'),
        tools: { ...builtinTools, ...mcpTools },
        memory,
        workspace,
    });
}
