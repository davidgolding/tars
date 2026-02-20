/**
 * Interface for LLM providers.
 * Any model (CLI or API) should implement this to be compatible with Tars.
 */
export interface LLMProvider {
    /**
     * Generates a text response from the model.
     * Internal implementation details (CLI vs API) are hidden from the agent.
     */
    generateResponse(prompt: string): Promise<string>;
}
