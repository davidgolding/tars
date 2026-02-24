import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const searchCache = new Map<string, { data: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const webSearchTool = createTool({
    id: "web_search",
    description: "Search the web for information using Jina Search API. Returns search results in Markdown format.",
    inputSchema: z.object({
        query: z.string().describe("The search query"),
        count: z.number().optional().describe("Number of results to return (informational for the backend)"),
        country: z.string().optional().describe("Country code for search results"),
        search_lang: z.string().optional().describe("Language for search results"),
        ui_lang: z.string().optional().describe("UI language"),
        freshness: z.string().optional().describe("Time range for search results (e.g. day, week, month)"),
    }),
    execute: async (input) => {
        // Create a cache key from the query and optional parameters
        const cacheKey = JSON.stringify(input);

        // Check cache
        if (searchCache.has(cacheKey)) {
            const cached = searchCache.get(cacheKey)!;
            if (Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.data;
            }
            searchCache.delete(cacheKey); // Expired
        }

        try {
            const url = `https://s.jina.ai/${encodeURIComponent(input.query)}`;

            const headers: Record<string, string> = {
                'Accept': 'text/plain',
                'User-Agent': 'Tars Agent / Jina Search'
            };

            if (process.env.JINA_API_KEY) {
                headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
            }

            const response = await fetch(url, { headers });

            if (!response.ok) {
                throw new Error(`Jina Search API failed: ${response.status} ${response.statusText}`);
            }

            let resultMarkdown = await response.text();

            searchCache.set(cacheKey, { data: resultMarkdown, timestamp: Date.now() });

            return resultMarkdown;
        } catch (error) {
            console.error("web_search tool error:", error);
            return Array.isArray(error) ? error.join('\n') : String(error);
        }
    }
});

export const readUrlTool = createTool({
    id: "read_url",
    description: "Fetch and read the main content of a URL as Markdown. Bypasses JavaScript rendering and anti-bots.",
    inputSchema: z.object({
        url: z.string().url().describe("The absolute URL to read"),
    }),
    execute: async (input) => {
        try {
            const url = `https://r.jina.ai/${input.url}`;

            const headers: Record<string, string> = {
                'Accept': 'text/plain',
                'User-Agent': 'Tars Agent / Jina Reader'
            };

            if (process.env.JINA_API_KEY) {
                headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
            }

            const response = await fetch(url, { headers });

            if (!response.ok) {
                throw new Error(`Jina Reader API failed: ${response.status} ${response.statusText}`);
            }

            const markdown = await response.text();
            return markdown;
        } catch (error) {
            console.error("read_url tool error:", error);
            return Array.isArray(error) ? error.join('\n') : String(error);
        }
    }
});
