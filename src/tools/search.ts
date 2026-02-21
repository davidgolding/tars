import type { ToolResponse } from './time.js';

/**
 * Performs a search using DuckDuckGo's Instant Answer API.
 * Note: This is an "instant answer" API and may not return full search results
 * for complex queries, but it's a good "lean" start.
 */
export async function webSearchTool(query: string): Promise<ToolResponse> {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Search request failed with status ${response.status}`);
        }

        const data = await response.json() as any;

        let resultText = '';
        if (data.AbstractText) {
            resultText = `Abstract: ${data.AbstractText}\nSource: ${data.AbstractSource}\nURL: ${data.AbstractURL}`;
        } else if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            resultText = "Related topics found:\n" + data.RelatedTopics
                .slice(0, 3)
                .map((topic: any) => topic.text)
                .join('\n');
        } else {
            return {
                result: "No information found for this specific query.",
                system_directive: "DO NOT RETRY WEB SEARCH. Consider if you have enough context to answer without searching, or ask the user for clarification."
            };
        }

        return {
            result: resultText
        };
    } catch (err: any) {
        return {
            error: `Web search failed: ${err.message}`,
            system_directive: "DO NOT RETRY WEB SEARCH. THE UPSTREAM SERVICE IS CURRENTLY UNAVAILABLE OR FAILING."
        };
    }
}
