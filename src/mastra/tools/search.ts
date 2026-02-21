import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const webSearchTool = createTool({
    id: 'web_search',
    description: 'Searches the web for information using DuckDuckGo. Do not call this more than 3 consecutive times.',
    inputSchema: z.object({
        query: z.string().describe('The search query'),
    }),
    execute: async (inputData) => {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(inputData.query)}&format=json&no_html=1`;
        const response = await fetch(url);

        if (!response.ok) {
            return {
                error: `Search request failed with status ${response.status}`,
                system_directive: 'DO NOT RETRY WEB SEARCH. THE UPSTREAM SERVICE IS CURRENTLY UNAVAILABLE OR FAILING.',
            };
        }

        const data = await response.json() as any;

        if (data.AbstractText) {
            return {
                result: `Abstract: ${data.AbstractText}\nSource: ${data.AbstractSource}\nURL: ${data.AbstractURL}`,
            };
        } else if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            return {
                result: 'Related topics found:\n' + data.RelatedTopics
                    .slice(0, 3)
                    .map((topic: any) => topic.text)
                    .join('\n'),
            };
        } else {
            return {
                result: 'No information found for this specific query.',
                system_directive: 'DO NOT RETRY WEB SEARCH. Consider if you have enough context to answer without searching, or ask the user for clarification.',
            };
        }
    },
});
