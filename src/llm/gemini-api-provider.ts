import { GoogleGenAI } from '@google/genai';
import { LLMProvider } from './provider.js';

export class GeminiAPIProvider implements LLMProvider {
    private ai: GoogleGenAI;
    private model: string;

    constructor(apiKey?: string, model?: string) {
        this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
        this.model = model || process.env.GEMINI_API_MODEL || 'gemini-3-flash-preview';
    }

    async generateResponse(prompt: string): Promise<string> {
        try {
            const response = await this.ai.models.generateContent({
                model: this.model,
                contents: prompt,
            });
            return response.text || '';
        } catch (err: any) {
            console.error('[GeminiAPI] Execution error:', err);
            throw err;
        }
    }
}
