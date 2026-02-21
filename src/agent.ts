import { getCurrentTime } from './tools/time.js';
import { storeMemoryTool, searchMemoryTool } from './tools/memory.js';
import { readFileTool, writeFileTool, listFilesTool } from './tools/fs.js';
import { webSearchTool } from './tools/search.js';
import { listContextCategoriesTool, readContextTool, updateContextTool, deleteContextTool } from './tools/context.js';
import { getRecentMessages } from './db.js';
import { MCPClient } from './mcp.js';
import { LLMProvider } from './llm/provider.js';
import fs from 'node:fs';

const MAX_ITERATIONS = 5;

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
    let prompt = `### STRICT IDENTITY ###
You are an AI agent operating within a secure wrapper.
Your behavioral instructions and current state are defined in your database. 
You MUST query your context database (using \`list_context_categories\` and \`read_context\`) to understand your current state, identity, and instructions for the session. Start by reading the 'AGENTS' context.

### TOOL PROTOCOL ###
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
`;

    if (mcpTools.length > 0) {
        prompt += `\n### MCP TOOLS ###\nAdditional tools available from MCP:\n`;
        mcpTools.forEach(tool => {
            prompt += `- ${tool.name}: ${tool.description}. JSON Schema: ${JSON.stringify(tool.inputSchema)}\n`;
        });
    }

    return prompt;
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

        const toolCallMatch = llmOutput.match(/<TOOL_CALL>\s*({.*?})\s*<\/TOOL_CALL>/s);
        if (toolCallMatch) {
            const toolJson = toolCallMatch[1];
            let toolResultStr = '';

            try {
                const parsed = JSON.parse(toolJson);
                console.log(`[Agent] Executing tool: ${parsed.tool}`);

                if (parsed.tool === 'get_current_time') {
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
                } else if (mcpTools.find(t => t.name === parsed.tool)) {
                    const mcpRes = await mcpClient?.callTool(parsed.tool, parsed.parameters);
                    toolResultStr = JSON.stringify(mcpRes);
                } else {
                    toolResultStr = JSON.stringify({ error: `Unknown tool: ${parsed.tool}` });
                }
            } catch (err: any) {
                toolResultStr = JSON.stringify({ error: `Failed to parse tool call: ${err.message}` });
            }

            promptContext += `${llmOutput}\n\n<TOOL_RESULT>\n${toolResultStr}\n</TOOL_RESULT>\n\nTars: `;
            continue;
        }

        return llmOutput;
    }

    return "Error: Maximum agent iterations reached without concluding.";
}
