import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import fs from 'node:fs';
import type { ChannelPlugin, PluginConfig } from './types.js';

const ALLOWED_PLUGINS_DIR = 'public/.agents/plugins';

export async function loadPlugin(pluginPath: string): Promise<ChannelPlugin> {
  const resolvedPath = resolve(pluginPath);
  const allowedBase = resolve(process.cwd(), ALLOWED_PLUGINS_DIR);
  
  if (!resolvedPath.startsWith(allowedBase)) {
    throw new Error(`Plugin path ${pluginPath} is outside allowed plugins directory`);
  }
  
  const indexPath = resolve(resolvedPath, 'index.ts');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Plugin index not found at ${indexPath}`);
  }

  const moduleUrl = pathToFileURL(indexPath).href;
  const module = await import(moduleUrl);
  const PluginClass = module.default || module.ChannelPlugin;
  
  if (!PluginClass || typeof PluginClass !== 'function') {
    throw new Error(`Invalid plugin at ${pluginPath}: no valid ChannelPlugin export`);
  }
  
  const plugin = new PluginClass();
  validatePluginInterface(plugin);
  
  return plugin;
}

function validatePluginInterface(plugin: unknown): asserts plugin is ChannelPlugin {
  const required = ['init', 'start', 'stop', 'getStatus', 'send', 'onMessage', 'getChannelId', 'id', 'name', 'type', 'version'];
  const missing: string[] = [];
  
  for (const method of required) {
    if (!plugin || typeof (plugin as Record<string, unknown>)[method] !== 'function') {
      missing.push(method);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Plugin missing required methods: ${missing.join(', ')}`);
  }
  
  const p = plugin as Record<string, unknown>;
  if (p.type !== 'channel') {
    throw new Error(`Plugin must have type 'channel'`);
  }
}

export async function loadPluginWithConfig(
  pluginPath: string,
  config: PluginConfig
): Promise<ChannelPlugin> {
  const plugin = await loadPlugin(pluginPath);
  await plugin.init(config);
  return plugin;
}
