import { saveMemory, searchMemories } from '../db.js';
import type { ToolResponse } from './time.js';

export function storeMemoryTool(content: string, category: string = 'general'): ToolResponse {
    try {
        saveMemory(content, category);
        return {
            result: `Memory saved: "${content}"`
        };
    } catch (err: any) {
        return {
            error: `Failed to save memory: ${err.message}`
        };
    }
}

export function searchMemoryTool(query: string): ToolResponse {
    try {
        const results = searchMemories(query);
        if (results.length === 0) {
            return {
                result: "No relevant memories found."
            };
        }
        const formatted = results.map(r => `[${r.category}] ${r.content}`).join('\n');
        return {
            result: `Relevant memories found:\n${formatted}`
        };
    } catch (err: any) {
        return {
            error: `Failed to search memories: ${err.message}`
        };
    }
}
