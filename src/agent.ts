import { getCurrentTime } from './tools/time.js';
import { storeMemoryTool, searchMemoryTool } from './tools/memory.js';
import { readFileTool, writeFileTool, listFilesTool } from './tools/fs.js';
import { webSearchTool } from './tools/search.js';
import { getSettingTool, updateSettingTool } from './tools/setting.js';
import { listContextCategoriesTool, readContextTool, updateContextTool, deleteContextTool } from './tools/context.js';
import { getRecentMessages, getAgentContext, getAllAgentContextCategories, getSetting } from './db.js';
import { MCPClient } from './mcp.js';
import { LLMProvider } from './llm/provider.js';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MAX_ITERATIONS = parseInt(process.env.LLM_MAX_ITERATIONS || '35', 35);

// Global MCP client instance (optional)
let mcpClient: MCPClient | null = null;
let mcpTools: any[] = [];

async function ensureMCP() {
    const cmd = process.env.MCP_SERVER_COMMAND;
    if (cmd && !mcpClient) {
        try {
            const [command, ...args] = cmd.split(' ');
            mcpClient = new MCPClient(command, args);
            await mcpClient.connect();
            mcpTools = await mcpClient.listTools();
            console.log(`[Agent] Loaded ${mcpTools.length} tools from MCP server.`);
        } catch (err) {
            console.error('[Agent] Failed to initialize MCP:', err);
        }
    }
}

function getSystemPrompt(): string {
    const bootstrapVal = getSetting('bootstrapped');
    const isBootstrapped = bootstrapVal ? !isNaN(new Date(bootstrapVal).getTime()) && new Date(bootstrapVal) <= new Date() : false;
    let prompt = `### STRICT IDENTITY ###\nYou are an AI agent operating within a secure wrapper. NEVER modify the 'bootstrapped' setting once it contains a timestamp; that is only performed by the system.\n\n`;
    const toolProtocol = `### TOOL PROTOCOL ###
You can use tools. To use a tool, output exactly this format:
<TOOL_CALL>
{"tool": "tool_name", "parameters": {...}}
</TOOL_CALL>

Available tools:
- get_current_time: returns the current ISO-8601 time.
- save_memory: Stores a fact or context snippet. Parameters: {"content": "string", "category": "string"}
- search_memory: Queries memories for relevant information. Parameters: {"query": "string"}
- read_file: Reads a file from the project. Parameters: {"path": "string"}
- write_file: Writes content to a file. Parameters: {"path": "string", "content": "string"}
- list_files: Lists files in a directory. Parameters: {"path": "string"} (default path is ".")
- web_search: Searches the web for information. Parameters: {"query": "string"}
- list_context_categories: Returns a list of available context categories in the database. Parameters: {}
- read_context: Returns the content of a specific context category. Parameters: {"category": "string"}
- update_context: Updates or creates the context for a category. Parameters: {"category": "string", "content": "string"}
- delete_context: Deletes a context category. Parameters: {"category": "string"}
- get_setting: Returns the value of a specific setting key. Parameters: {"key": "string"}
- update_setting: Updates or creates the value for a setting. Parameters: {"key": "string", "value": "string"}

If you need to use a tool, output ONLY the tool calls. Do not include conversational text. Wait for the tool results before speaking to the user.
    `;

    if (!isBootstrapped) {
        prompt += `You just woke up. Time to figure out who you are. There is no memory yet. This is a fresh workspace, so it's normal that memory records don't exist until you create them.\n\n`;
        prompt += toolProtocol + `\n\n`;
        prompt += `Don't interrogate. Don't be robotic. Start with something like:

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
        `;
        return prompt;
    } else {
        prompt += toolProtocol + `\n\n`;
        prompt += getAgentContext('AGENTS');

        const categories = getAllAgentContextCategories();
        for (const cat of categories) {
            const content = getAgentContext(cat);
            if (content && cat != 'AGENTS' && cat != 'SYSTEM') {
                prompt += `--- ${cat.toUpperCase()} CONTEXT ---\n${content}\n\n`;
            }
        }

        if (mcpTools.length > 0) {
            prompt += `\n### MCP TOOLS ###\nAdditional tools available from MCP:\n`;
            mcpTools.forEach(tool => {
                prompt += `- ${tool.name}: ${tool.description}. JSON Schema: ${JSON.stringify(tool.inputSchema)}\n`;
            });
        }
        return prompt;
    }
}

/**
 * Core agent loop. Now provider-agnostic.
 */
export async function runAgentLoop(userMessage: string, provider: LLMProvider): Promise<string> {
    await ensureMCP();

    // 1. Build Short-term memory context
    const history = getRecentMessages(10);
    const historyText = history.map(m => `${m.sender}: ${m.text}`).join('\n');

    let promptContext = `${getSystemPrompt()}\n\n### CONVERSATION HISTORY ###\n${historyText}\n\nTars: `;
    const isVerbose = process.env.VERBOSE === 'true';

    // Circuit Breakers
    let consecutiveSearches = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        if (isVerbose) {
            console.log(`\n\x1b[36m=== [Iter ${i + 1}] LLM Prompt Segment ===\x1b[0m\n${promptContext.substring(promptContext.length - 1000)}\n\x1b[36m==============================\x1b[0m`);
        } else {
            console.log(`[Agent] Iteration ${i + 1} invoking model...`);
        }

        let llmOutput = '';
        try {
            llmOutput = await provider.generateResponse(promptContext);
        } catch (err: any) {
            console.error('[Agent] LLM Provider error:', err);
            return `Error generating response: ${err.message}`;
        }

        llmOutput = llmOutput.trim();

        if (isVerbose) {
            console.log(`\n\x1b[33m=== [Iter ${i + 1}] LLM Output ===\x1b[0m\n${llmOutput}\n\x1b[33m==========================\x1b[0m`);
        } else {
            console.log(`[Agent] Model output received (length: ${llmOutput.length})`);
        }

        const toolCallRegex = /<TOOL_CALL>\s*({.*?})\s*<\/TOOL_CALL>/gs;
        const toolCalls = [...llmOutput.matchAll(toolCallRegex)];

        if (toolCalls.length > 0) {
            let allToolResultsStr = '';
            let hasSearch = false;

            for (const match of toolCalls) {
                const toolJson = match[1];
                let toolResultStr = '';

                try {
                    const parsed = JSON.parse(toolJson);
                    console.log(`[Agent] Executing tool: ${parsed.tool}`);

                    if (parsed.tool === 'web_search') {
                        hasSearch = true;
                        consecutiveSearches++;

                        // Circuit breaker: Force a hard stop to infinite spinning
                        if (consecutiveSearches >= 3) {
                            toolResultStr = JSON.stringify({
                                error: "CIRCUIT BREAKER ENGAGED. Search backend appears broken or query is impossible.",
                                system_directive: "STOP SEARCHING IMMEDIATELY. Apologize to the user and state that you cannot search for this right now due to backend failures."
                            });
                        } else {
                            toolResultStr = JSON.stringify(await webSearchTool(parsed.parameters.query));
                        }
                    } else if (parsed.tool === 'get_current_time') {
                        toolResultStr = JSON.stringify(getCurrentTime());
                    } else if (parsed.tool === 'save_memory') {
                        toolResultStr = JSON.stringify(storeMemoryTool(parsed.parameters.content, parsed.parameters.category));
                    } else if (parsed.tool === 'search_memory') {
                        toolResultStr = JSON.stringify(searchMemoryTool(parsed.parameters.query));
                    } else if (parsed.tool === 'read_file') {
                        toolResultStr = JSON.stringify(readFileTool(parsed.parameters.path));
                    } else if (parsed.tool === 'write_file') {
                        toolResultStr = JSON.stringify(writeFileTool(parsed.parameters.path, parsed.parameters.content));
                    } else if (parsed.tool === 'list_files') {
                        toolResultStr = JSON.stringify(listFilesTool(parsed.parameters.path));
                    } else if (parsed.tool === 'web_search') {
                        toolResultStr = JSON.stringify(await webSearchTool(parsed.parameters.query));
                    } else if (parsed.tool === 'list_context_categories') {
                        toolResultStr = JSON.stringify(listContextCategoriesTool());
                    } else if (parsed.tool === 'read_context') {
                        toolResultStr = JSON.stringify(readContextTool(parsed.parameters.category));
                    } else if (parsed.tool === 'update_context') {
                        toolResultStr = JSON.stringify(updateContextTool(parsed.parameters.category, parsed.parameters.content));
                    } else if (parsed.tool === 'delete_context') {
                        toolResultStr = JSON.stringify(deleteContextTool(parsed.parameters.category));
                    } else if (parsed.tool === 'get_setting') {
                        toolResultStr = JSON.stringify(getSettingTool(parsed.parameters.key));
                    } else if (parsed.tool === 'update_setting') {
                        toolResultStr = JSON.stringify(updateSettingTool(parsed.parameters.key, parsed.parameters.value));
                    } else if (mcpTools.find(t => t.name === parsed.tool)) {
                        const mcpRes = await mcpClient?.callTool(parsed.tool, parsed.parameters);
                        toolResultStr = JSON.stringify(mcpRes);
                    } else {
                        toolResultStr = JSON.stringify({ error: `Unknown tool: ${parsed.tool}` });
                    }
                } catch (err: any) {
                    toolResultStr = JSON.stringify({ error: `Failed to parse tool call: ${err.message}` });
                }

                allToolResultsStr += `<TOOL_RESULT tool="${match[1]}">\n${toolResultStr}\n</TOOL_RESULT>\n`;
            }

            promptContext += `${llmOutput}\n\n${allToolResultsStr}\n\nTars: `;
            continue;
        }

        return llmOutput;
    }

    return "Error: Maximum agent iterations reached without concluding.";
}
