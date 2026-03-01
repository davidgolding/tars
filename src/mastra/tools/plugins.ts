import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { channelManager } from '../../plugins/channel-manager.js';
import { getPluginConfig } from '../../db.js';

export const listPluginsTool = createTool({
    id: 'list_plugins',
    description: 'List all installed channel plugins and their status (online/offline). Use this to see what messaging channels are available.',
    inputSchema: z.object({}),
    execute: async () => {
        try {
            const plugins = channelManager.listPlugins();
            const enrichedPlugins = plugins.map(p => {
                const status = channelManager.getPluginStatus(p.id);
                return {
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    version: p.version,
                    enabled: p.enabled,
                    online: status.online,
                    lastError: status.lastError,
                };
            });
            return { plugins: enrichedPlugins };
        } catch (error) {
            return { error: `Failed to list plugins: ${(error as Error).message}` };
        }
    },
});

export const togglePluginTool = createTool({
    id: 'toggle_plugin',
    description: 'Enable or disable a channel plugin. Use to start or stop receiving messages from a specific channel.',
    inputSchema: z.object({
        pluginId: z.string().describe('The plugin ID to toggle (e.g., "signal", "discord")'),
        enabled: z.boolean().describe('true to enable, false to disable'),
    }),
    execute: async (inputData) => {
        try {
            const { pluginId, enabled } = inputData;
            
            const plugin = channelManager.getPlugin(pluginId);
            if (!plugin) {
                return { error: `Plugin not found: ${pluginId}` };
            }

            if (enabled) {
                await channelManager.startPlugin(pluginId);
                return { success: true, message: `Plugin "${pluginId}" enabled` };
            } else {
                await channelManager.stopPlugin(pluginId);
                return { success: true, message: `Plugin "${pluginId}" disabled` };
            }
        } catch (error) {
            return { error: `Failed to toggle plugin: ${(error as Error).message}` };
        }
    },
});

export const getPluginConfigTool = createTool({
    id: 'get_plugin_config',
    description: 'Get the configuration for a specific channel plugin.',
    inputSchema: z.object({
        pluginId: z.string().describe('The plugin ID to get config for'),
    }),
    execute: async (inputData) => {
        try {
            const { pluginId } = inputData;
            
            const plugin = channelManager.getPlugin(pluginId);
            if (!plugin) {
                return { error: `Plugin not found: ${pluginId}` };
            }

            const config = getPluginConfig(pluginId);
            return { pluginId, config: config || {} };
        } catch (error) {
            return { error: `Failed to get plugin config: ${(error as Error).message}` };
        }
    },
});
