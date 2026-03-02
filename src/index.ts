import dotenv from 'dotenv';
import { initDb } from './db.js';
import { channelManager } from './plugins/channel-manager.js';

// Load environment variables
dotenv.config();

if (!process.env.LLM_API_KEY) {
    console.error('[Startup] LLM_API_KEY is required.');
    process.exit(1);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[System] Received SIGINT. Shutting down gracefully...');
    await channelManager.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[System] Received SIGTERM. Shutting down gracefully...');
    await channelManager.shutdown();
    process.exit(0);
});

async function main() {
    console.log("Starting Tars...");
    initDb();

    // Load channel plugins (auto-starts enabled ones, wires message handlers)
    console.log("[System] Loading channel plugins...");
    await channelManager.loadPlugins();

    // Import agents after DB is initialized (buildSystemPrompt reads from DB)
    await import('./mastra/index.js');

    console.log("[System] Tars is running. Waiting for messages via channel plugins...");
}

main().catch(err => {
    console.error("[Startup Error] Fatal error starting agent:", err);
    process.exit(1);
});
