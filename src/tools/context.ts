import { getAgentContext, getAllAgentContextCategories, updateAgentContext, deleteAgentContext } from '../db.js';

export function listContextCategoriesTool() {
    return getAllAgentContextCategories();
}

export function readContextTool(category: string) {
    const content = getAgentContext(category);
    if (content) {
        return content;
    }
    return { error: `Context category not found: ${category}` };
}

export function updateContextTool(category: string, content: string) {
    updateAgentContext(category, content);
    return { success: true, message: `Updated context category: ${category}` };
}

export function deleteContextTool(category: string) {
    deleteAgentContext(category);
    return { success: true, message: `Deleted context category: ${category}` };
}
