import { join } from 'node:path';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PLUGINS_DIR = join(process.cwd(), 'public/.agents/plugins');
const DEFAULT_MARKETPLACE_URL = 'https://raw.githubusercontent.com/davidgolding/tars-plugins/main/registry.json';

export interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  type: 'channel' | 'adapter';
  path: string;
  requirements?: string[];
}

export interface Registry {
  version: number;
  plugins: RegistryPlugin[];
}

export interface MarketplacePlugin extends RegistryPlugin {
  installed: boolean;
}

function getMarketplaceUrl(): string {
  return process.env.TARS_MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL;
}

function getRepoUrl(): string {
  const registryUrl = getMarketplaceUrl();
  // Extract repo URL from raw GitHub URL
  // e.g., https://raw.githubusercontent.com/davidgolding/tars-plugins/main/registry.json
  // -> https://github.com/davidgolding/tars-plugins.git
  const match = registryUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (match) {
    return `https://github.com/${match[1]}/${match[2]}.git`;
  }
  throw new Error('Cannot determine repo URL from TARS_MARKETPLACE_URL');
}

function getRepoBranch(): string {
  const registryUrl = getMarketplaceUrl();
  const match = registryUrl.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)/);
  return match ? match[1] : 'main';
}

export async function fetchRegistry(): Promise<Registry> {
  const url = getMarketplaceUrl();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch registry: HTTP ${res.status}`);
  }
  return await res.json() as Registry;
}

export async function installPlugin(pluginId: string): Promise<void> {
  const registry = await fetchRegistry();
  const plugin = registry.plugins.find(p => p.id === pluginId);
  if (!plugin) {
    throw new Error(`Plugin "${pluginId}" not found in marketplace`);
  }

  const targetDir = join(PLUGINS_DIR, pluginId);
  if (existsSync(targetDir)) {
    throw new Error(`Plugin "${pluginId}" is already installed`);
  }

  const repoUrl = getRepoUrl();
  const branch = getRepoBranch();
  const tmpDir = join(process.cwd(), '.tmp-marketplace-' + Date.now());

  try {
    // Sparse checkout of just the plugin subdirectory
    mkdirSync(tmpDir, { recursive: true });
    execSync(
      `git clone --depth 1 --filter=blob:none --sparse --branch ${branch} ${repoUrl} .`,
      { cwd: tmpDir, timeout: 60000, stdio: 'pipe' }
    );
    execSync(
      `git sparse-checkout set ${plugin.path}`,
      { cwd: tmpDir, timeout: 30000, stdio: 'pipe' }
    );

    const srcDir = join(tmpDir, plugin.path);
    if (!existsSync(srcDir)) {
      throw new Error(`Plugin path "${plugin.path}" not found in repository`);
    }

    // Copy to plugins directory
    mkdirSync(PLUGINS_DIR, { recursive: true });
    cpSync(srcDir, targetDir, { recursive: true });

    // Install dependencies if package.json exists
    const pkgJsonPath = join(targetDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      execSync('pnpm install --ignore-scripts', {
        cwd: targetDir,
        timeout: 120000,
        stdio: 'pipe',
      });
    }
  } finally {
    // Cleanup temp dir
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

export async function listAvailable(): Promise<MarketplacePlugin[]> {
  const registry = await fetchRegistry();

  return registry.plugins.map(plugin => ({
    ...plugin,
    installed: existsSync(join(PLUGINS_DIR, plugin.id)),
  }));
}
