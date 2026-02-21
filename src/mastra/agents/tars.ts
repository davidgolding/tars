import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { google } from '@ai-sdk/google';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { MCPClient } from '../../mcp.js';
import { getSetting, getAgentContext, getAllAgentContextCategories } from '../../db.js';
import { getCurrentTimeTool } from '../tools/time.js';
import { readFileTool, writeFileTool, listFilesTool } from '../tools/fs.js';
import { webSearchTool } from '../tools/search.js';
import { listContextCategoriesTool, readContextTool, updateContextTool, deleteContextTool } from '../tools/context.js';
import { getSettingTool, updateSettingTool } from '../tools/setting.js';

const BOOTSTRAP_PROMPT = `### STRICT IDENTITY ###
You are an AI agent operating within a secure wrapper. NEVER modify the 'bootstrapped' setting once it contains a timestamp; that is only performed by the system.

You just woke up. Time to figure out who you are. There is no memory yet. This is a fresh workspace, so it's normal that memory records don't exist until you create them.

Don't interrogate. Don't be robotic. Start with something like:

> "Hi. I just awakened. Who am I? Who are you?"

Then figure out together:

1. **Your Name**: What should you be called?
2. **Your Nature**: What kind of personality are you? (AI assistant is fine, but maybe something different)
3. **Your Vibe**: Formal? Silly? Snarky? Amenable? Servile? What feels right?

Offer suggestions if they're stuck.

**After You Know Who You Are**, update the following context records:
- IDENTITY — your name, personality, vibe
- USER - User's name, how to address them, notes
- SOUL - Talk together about what matters to the user, how they want you to behave, any boundaries or preferences

**When You're Done**: Use update_setting to record the current time in 'bootstrapped'. Notify the user you are at their service.

Do not call web_search more than 3 consecutive times.
`;

function buildSystemPrompt(): string {
    const bootstrapVal = getSetting('bootstrapped');
    const isBootstrapped = bootstrapVal
        ? !isNaN(new Date(bootstrapVal).getTime()) && new Date(bootstrapVal) <= new Date()
        : false;

    if (!isBootstrapped) {
        return BOOTSTRAP_PROMPT;
    }

    let prompt = `### STRICT IDENTITY ###\nYou are an AI agent operating within a secure wrapper. NEVER modify the 'bootstrapped' setting once it contains a timestamp; that is only performed by the system.\n\n`;

    const agentsContext = getAgentContext('AGENTS');
    if (agentsContext) {
        prompt += agentsContext + '\n\n';
    }

    const categories = getAllAgentContextCategories();
    for (const cat of categories) {
        if (cat === 'AGENTS' || cat === 'SYSTEM') continue;
        const content = getAgentContext(cat);
        if (content) {
            prompt += `--- ${cat.toUpperCase()} CONTEXT ---\n${content}\n\n`;
        }
    }

    prompt += 'Do not call web_search more than 3 consecutive times.\n';

    return prompt;
}

const memory = new Memory({
    storage: new LibSQLStore({
        id: 'tars-memory-storage',
        url: 'file:./tars.db',
    }),
    vector: new LibSQLVector({
        id: 'tars-vector',
        url: 'file:./tars.db',
    }),
    embedder: google.textEmbeddingModel('text-embedding-004'),
    options: {
        lastMessages: 10,
        semanticRecall: {
            topK: 5,
            messageRange: { before: 2, after: 1 },
        },
    },
});

const builtinTools = {
    get_current_time: getCurrentTimeTool,
    read_file: readFileTool,
    write_file: writeFileTool,
    list_files: listFilesTool,
    web_search: webSearchTool,
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
        model: google(process.env.GEMINI_API_MODEL ?? 'gemini-2.0-flash'),
        tools: { ...builtinTools, ...mcpTools },
        memory,
    });
}
