import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import {
  type ChannelPlugin,
  type PluginConfig,
  type PluginStatus,
  type MessageHandler,
  type InstalledPlugin,
} from './types.js';
import {
  getPlugin,
  listPlugins,
  listEnabledPlugins,
  createPlugin,
  updatePlugin,
  deletePlugin as dbDeletePlugin,
  getPluginConfig,
  setPluginConfig,
  type DbPlugin,
} from '../db.js';

const PLUGINS_DIR = 'public/.agents/plugins';

interface LoadedPlugin {
  instance: ChannelPlugin;
  config: PluginConfig;
}

export class ChannelManager {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private messageHandlers: Map<string, MessageHandler> = new Map();

  async loadPlugins(): Promise<void> {
    const pluginDirs = this.getPluginDirectories();

    for (const dir of pluginDirs) {
      await this.loadPluginFromDirectory(dir);
    }
  }

  private getPluginDirectories(): string[] {
    const baseDir = join(process.cwd(), PLUGINS_DIR);
    if (!fs.existsSync(baseDir)) {
      return [];
    }

    return fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => join(baseDir, dirent.name));
  }

  private async loadPluginFromDirectory(dirPath: string): Promise<void> {
    const pluginName = dirPath.split('/').pop() || '';

    // Skip if already loaded
    if (this.plugins.has(pluginName)) {
      return;
    }

    const indexPath = join(dirPath, 'index.ts');
    const manifestPath = join(dirPath, 'manifest.json');

    if (!fs.existsSync(indexPath)) {
      console.warn(`[ChannelManager] No index.ts found in ${pluginName}, skipping`);
      return;
    }

    let manifest = { id: pluginName, name: pluginName, version: '1.0.0' };
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (e) {
        console.warn(`[ChannelManager] Failed to parse manifest for ${pluginName}:`, e);
      }
    }

    const existingDb = getPlugin(manifest.id);
    if (!existingDb) {
      createPlugin({
        id: manifest.id,
        name: manifest.name,
        type: 'channel',
        version: manifest.version,
        enabled: 0,
      });
    }

    try {
      const moduleUrl = pathToFileURL(indexPath).href;
      const module = await import(moduleUrl);
      const PluginClass = module.default || module.ChannelPlugin || module.SignalChannelPlugin;

      if (!PluginClass || typeof PluginClass !== 'function') {
        throw new Error(`Invalid plugin at ${indexPath}: no valid ChannelPlugin export`);
      }

      const instance = new PluginClass() as ChannelPlugin;
      const savedConfig = getPluginConfig(manifest.id);
      const config = savedConfig || {};

      if (Object.keys(config).length > 0) {
        await instance.init(config);
      }

      this.plugins.set(manifest.id, { instance, config });

      // Wire up global message handler
      instance.onMessage(async (payload) => {
        const { processAgentMessage } = await import('../mastra/service.js');
        await processAgentMessage({
          text: payload.text,
          sender: payload.sender,
          channelId: payload.channelId,
          metadata: payload.metadata,
        });
      });

      // Auto-start if the plugin has sufficient config and is enabled (or has env fallbacks)
      const dbPlugin = getPlugin(manifest.id);
      const hasConfig = Object.keys(config).length > 0;
      if ((dbPlugin && dbPlugin.enabled) || hasConfig) {
        try {
          await this.startPlugin(manifest.id);
          if (!dbPlugin || !dbPlugin.enabled) {
            updatePlugin(manifest.id, { enabled: 1 });
          }
        } catch (err) {
          console.error(`[ChannelManager] Auto-start failed for ${manifest.id}:`, err);
        }
      }

      console.log(`[ChannelManager] Loaded plugin: ${manifest.name}`);
    } catch (error) {
      console.error(`[ChannelManager] Failed to load plugin ${pluginName}:`, error);
    }
  }

  async startPlugin(pluginId: string): Promise<void> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) {
      throw new Error(`Plugin ${pluginId} not loaded`);
    }

    try {
      await loaded.instance.start();
      updatePlugin(pluginId, { enabled: 1 });
      console.log(`[ChannelManager] Started plugin: ${pluginId}`);
    } catch (error) {
      console.error(`[ChannelManager] Failed to start plugin ${pluginId}:`, error);
      throw error;
    }
  }

  async stopPlugin(pluginId: string): Promise<void> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) {
      return;
    }

    try {
      await loaded.instance.stop();
      updatePlugin(pluginId, { enabled: 0 });
      console.log(`[ChannelManager] Stopped plugin: ${pluginId}`);
    } catch (error) {
      console.error(`[ChannelManager] Failed to stop plugin ${pluginId}:`, error);
      throw error;
    }
  }

  async updatePluginConfig(pluginId: string, config: PluginConfig): Promise<void> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) {
      throw new Error(`Plugin ${pluginId} not loaded`);
    }

    await loaded.instance.init(config);
    loaded.config = config;
    setPluginConfig(pluginId, config as Record<string, string>);
    console.log(`[ChannelManager] Updated config for plugin: ${pluginId}`);
  }

  registerMessageHandler(pluginId: string, handler: MessageHandler): void {
    this.messageHandlers.set(pluginId, handler);

    const loaded = this.plugins.get(pluginId);
    if (loaded) {
      loaded.instance.onMessage(handler);
    }
  }

  mountPluginRoutes(router: any): void {
    for (const [id, loaded] of this.plugins) {
      const routes = loaded.instance.getSetupRoutes?.();
      if (!routes || routes.length === 0) continue;

      for (const route of routes) {
        const fullPath = `/plugins/${id}/setup${route.path}`;
        if (route.method === 'get') {
          router.get(fullPath, route.handler);
        } else {
          router.post(fullPath, route.handler);
        }
        console.log(`[ChannelManager] Mounted setup route: ${route.method.toUpperCase()} /api${fullPath}`);
      }
    }
  }

  getPlugin(pluginId: string): ChannelPlugin | undefined {
    return this.plugins.get(pluginId)?.instance;
  }

  getPluginStatus(pluginId: string): PluginStatus {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) {
      return { online: false, lastError: 'Plugin not loaded' };
    }
    return loaded.instance.getStatus();
  }

  listPlugins(): InstalledPlugin[] {
    const dbPlugins = listPlugins();
    return dbPlugins.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type as 'channel' | 'adapter',
      version: p.version || '1.0.0',
      enabled: p.enabled === 1,
      installedAt: p.installed_at,
    }));
  }

  getEnabledPlugins(): ChannelPlugin[] {
    const enabledDbPlugins = listEnabledPlugins();
    return enabledDbPlugins
      .map(p => this.plugins.get(p.id)?.instance)
      .filter((p): p is ChannelPlugin => p !== undefined);
  }

  async shutdown(): Promise<void> {
    for (const [id, loaded] of this.plugins) {
      try {
        await loaded.instance.stop();
      } catch (error) {
        console.error(`[ChannelManager] Error stopping plugin ${id}:`, error);
      }
    }
    this.plugins.clear();
    this.messageHandlers.clear();
  }
}

export const channelManager = new ChannelManager();
