import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

export const webSearchTool = createTool({
    id: 'web_search',
    description: 'Searches the web for information using a real headless browser. Do not call this more than 3 consecutive times.',
    inputSchema: z.object({
        query: z.string().describe('The search query'),
    }),
    execute: async (inputData) => {
        let browser;
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();

            // Wait for network and DOM to settle
            await page.goto('https://lite.duckduckgo.com/lite/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.fill('input[name="q"]', inputData.query);

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.click('input[type="submit"]')
            ]);

            const results = await page.evaluate(() => {
                const items: any[] = [];
                const trs = document.querySelectorAll('tr');
                trs.forEach(tr => {
                    const titleNode = tr.querySelector('td.result-snippet')?.previousElementSibling as HTMLElement;
                    if (!titleNode) return;

                    const a = tr.querySelector('a.result-title') as HTMLAnchorElement;
                    if (!a) return;

                    const title = a.innerText.trim();
                    const url = a.href;

                    const nextTr = tr.nextElementSibling as HTMLElement;
                    const snippet = nextTr?.querySelector('td.result-snippet')?.textContent?.trim() || "";

                    items.push({ title, url, snippet });
                });
                return items;
            });

            await browser.close();

            if (results.length === 0) {
                return {
                    result: 'No information found for this specific query.',
                    system_directive: 'DO NOT RETRY WEB SEARCH. Consider if you have enough context to answer without searching, or ask the user for clarification.',
                };
            }

            return {
                result: 'Search results found:\n\n' + results
                    .map((r, i) => `[${i + 1}] Title: ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}`)
                    .join('\n\n'),
            };

        } catch (error: any) {
            if (browser) await browser.close();
            return {
                error: `Search request failed: ${error.message}`,
                system_directive: 'DO NOT RETRY WEB SEARCH. THE UPSTREAM SERVICE IS CURRENTLY UNAVAILABLE OR FAILING.',
            };
        }
    },
});

export const readUrlTool = createTool({
    id: 'read_url',
    description: 'Reads the main text content of a given HTTP URL, stripping away ads and navigation, exactly like reading a page in a browser.',
    inputSchema: z.object({
        url: z.string().describe('The strict HTTP/HTTPS URL of the page to read'),
    }),
    execute: async (inputData) => {
        try {
            const res = await fetch(inputData.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
                },
                redirect: 'follow',
            });

            if (!res.ok) {
                return { error: `HTTP ${res.status}: Failed to fetch URL ${inputData.url}` };
            }

            const html = await res.text();

            // JSDOM requires absolute URLs to resolve relative links correctly
            const doc = new JSDOM(html, { url: inputData.url });

            const reader = new Readability(doc.window.document);
            const article = reader.parse();

            if (!article) {
                return { error: `Failed to extract meaningful content from the HTML of ${inputData.url}` };
            }

            const turndownService = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced'
            });

            const markdown = turndownService.turndown(article.content || '');

            return {
                title: article.title,
                content: markdown,
                siteName: article.siteName,
            };

        } catch (error: any) {
            return {
                error: `Failed to read URL: ${error.message}`
            };
        }
    }
});
