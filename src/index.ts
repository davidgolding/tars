import dotenv from 'dotenv';
import { startSignalListener, sendSignalMessage } from './signal.js';
import { runAgentLoop } from './agent.js';
import { initDb, saveMessage } from './db.js';
import { GeminiCLIProvider } from './llm/gemini-cli-provider.js';
import { GeminiAPIProvider } from './llm/gemini-api-provider.js';

// Load environment variables
dotenv.config();

const BOT_SIGNAL_NUMBER = process.env.BOT_SIGNAL_NUMBER;
const TARGET_SIGNAL_NUMBER = process.env.TARGET_SIGNAL_NUMBER;

if (!BOT_SIGNAL_NUMBER || !TARGET_SIGNAL_NUMBER) {
    console.error("[Startup Error] Missing BOT_SIGNAL_NUMBER or TARGET_SIGNAL_NUMBER. Please check .env file.");
    process.exit(1);
}

async function main() {
    console.log("Starting Tars Level 4: Modular Architecture...");
    initDb();

    const providerConfig = process.env.LLM_PROVIDER || 'gemini-cli';
    const provider = providerConfig === 'gemini-api'
        ? new GeminiAPIProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_API_MODEL)
        : new GeminiCLIProvider();

    await startSignalListener(
        BOT_SIGNAL_NUMBER!,
        TARGET_SIGNAL_NUMBER!,
        async (text, sender) => {
            console.log(`[Tars] Processing message from ${sender}...`);
            saveMessage(sender, text);
            try {
                const response = await runAgentLoop(text, provider);
                saveMessage('Tars', response);
                await sendSignalMessage(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, response);
            } catch (err: any) {
                console.error("[Tars] Error running agent loop:", err);
                await sendSignalMessage(BOT_SIGNAL_NUMBER!, TARGET_SIGNAL_NUMBER!, "Sorry, an internal error occurred.");
            }
        }
    );
}

main().catch(err => {
    console.error("[Startup Error] Fatal error starting agent:", err);
    process.exit(1);
});
