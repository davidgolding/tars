import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const getCurrentTimeTool = createTool({
    id: 'get_current_time',
    description: 'Returns the current ISO-8601 timestamp.',
    inputSchema: z.object({}),
    execute: async () => ({ time: new Date().toISOString() }),
});
