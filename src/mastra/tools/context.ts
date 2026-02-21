import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
    getAllAgentContextCategories,
    getAgentContext,
    updateAgentContext,
    deleteAgentContext,
} from '../../db.js';

export const listContextCategoriesTool = createTool({
    id: 'list_context_categories',
    description: 'Returns a list of available context categories stored in the database.',
    inputSchema: z.object({}),
    execute: async () => ({ categories: getAllAgentContextCategories() }),
});

export const readContextTool = createTool({
    id: 'read_context',
    description: 'Returns the content of a specific context category.',
    inputSchema: z.object({
        category: z.string().describe('The context category name (e.g. IDENTITY, USER, SOUL)'),
    }),
    execute: async (inputData) => {
        const content = getAgentContext(inputData.category);
        if (content) {
            return { content };
        }
        return { error: `Context category not found: ${inputData.category}` };
    },
});

export const updateContextTool = createTool({
    id: 'update_context',
    description: 'Updates or creates the content for a context category.',
    inputSchema: z.object({
        category: z.string().describe('The context category name'),
        content: z.string().describe('The content to store'),
    }),
    execute: async (inputData) => {
        updateAgentContext(inputData.category, inputData.content);
        return { success: true, message: `Updated context category: ${inputData.category}` };
    },
});

export const deleteContextTool = createTool({
    id: 'delete_context',
    description: 'Deletes a context category.',
    inputSchema: z.object({
        category: z.string().describe('The context category name to delete'),
    }),
    execute: async (inputData) => {
        deleteAgentContext(inputData.category);
        return { success: true, message: `Deleted context category: ${inputData.category}` };
    },
});
