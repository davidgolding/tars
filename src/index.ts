import dotenv from 'dotenv';
import removeMd from 'remove-markdown';
import { startSignalListener, sendSignalMessage, sendSignalTyping, stopSignalListener } from './signal.js';
import { initDb, getAgentContext, getSetting } from './db.js';
import { notifyUIMessage } from './signal_events.js';

// Load environment variables
dotenv.config();

const BOT_SIGNAL_NUMBER = process.env.BOT_SIGNAL_NUMBER;
const TARGET_SIGNAL_NUMBER = process.env.TARGET_SIGNAL_NUMBER;
const TARGET_SIGNAL_GROUP = process.env.TARGET_SIGNAL_GROUP;

if (!BOT_SIGNAL_NUMBER || !TARGET_SIGNAL_NUMBER) {
    console.error("[Startup Error] Missing BOT_SIGNAL_NUMBER or TARGET_SIGNAL_NUMBER. Please check .env file.");
    process.exit(1);
}

if (!process.env.LLM_API_KEY) {
    console.error('[Startup] LLM_API_KEY is required.');
    process.exit(1);
}

const MAX_ITERATIONS = parseInt(process.env.LLM_MAX_ITERATIONS || '35', 10);

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[System] Received SIGINT. Shutting down gracefully...');
    await stopSignalListener();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[System] Received SIGTERM. Shutting down gracefully...');
    await stopSignalListener();
    process.exit(0);
});

async function main() {
    console.log("Starting Tars...");
    initDb();

    // Import tarsAgent after DB is initialized (buildSystemPrompt reads from DB)
    const { tarsAgent, bootstrapAgent } = await import('./mastra/index.js');
    const { processAgentMessage } = await import('./mastra/service.js');

    await startSignalListener(
        BOT_SIGNAL_NUMBER!,
        TARGET_SIGNAL_NUMBER!,
        TARGET_SIGNAL_GROUP,
        async (text, sender, groupId) => {
            await processAgentMessage({ text, sender, groupId, origin: 'signal' });
        }
    );
}

main().catch(err => {
    console.error("[Startup Error] Fatal error starting agent:", err);
    process.exit(1);
});
