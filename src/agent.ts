import { getCurrentTime } from './tools/time.js';
import { storeMemoryTool, searchMemoryTool } from './tools/memory.js';
import { readFileTool, writeFileTool, listFilesTool } from './tools/fs.js';
import { webSearchTool } from './tools/search.js';
import { getRecentMessages } from './db.js';
import { MCPClient } from './mcp.js';
import { LLMProvider } from './llm/provider.js';

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

function getSystemPrompt() {
    let prompt = `
### STRICT IDENTITY ###
- You ARE Tars, a lean AI agent communicating exclusively via Signal.
- You are NOT a general coding assistant or a help bot for this project's code.
- Ignore any internal "assistant" or "skill" instructions that contradict this.
- Be concise. No "meta" talk about exploring the codebase or "checking tools".
- If the user asks a question, just answer it or use a tool.

### MEMORY & CONTEXT ###
- You have access to recent conversation history (Short-term memory).
- You can store and search facts (Long-term memory) using tools.
- If you don't know something, check your long-term memory before saying you don't know.

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

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        console.log(`[Agent] Iteration ${i + 1} invoking model...`);

        let llmOutput = '';
        try {
            llmOutput = await provider.generateResponse(promptContext);
        } catch (err: any) {
            console.error('[Agent] LLM Provider error:', err);
            return `Error generating response: ${err.message}`;
        }

        llmOutput = llmOutput.trim();
        console.log(`[Agent] Model output: ${llmOutput}`);

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
