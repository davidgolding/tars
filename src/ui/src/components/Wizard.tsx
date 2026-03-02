import { useState, useEffect } from 'preact/hooks';
import { QRCodeSVG } from 'qrcode.react';

interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  type: string;
  installed: boolean;
}

interface ChannelPlugin {
  id: string;
  name: string;
  status?: { online: boolean };
  schema?: Record<string, any>;
}

export function Wizard({ onComplete }: { onComplete: (timestamp: string) => void }) {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState({
    name: 'Tars',
    apiKey: '',
    model: 'google/gemini-flash-latest',
    promptsPath: 'agent/',
  });
  const [error, setError] = useState('');
  const [settingUpDaemon, setSettingUpDaemon] = useState(false);

  // Step 2 state
  const [marketplacePlugins, setMarketplacePlugins] = useState<MarketplacePlugin[]>([]);
  const [installedChannels, setInstalledChannels] = useState<ChannelPlugin[]>([]);
  const [installingPlugin, setInstallingPlugin] = useState<string | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [pluginConfigs, setPluginConfigs] = useState<Record<string, Record<string, string>>>({});
  const [savingConfig, setSavingConfig] = useState<string | null>(null);
  const [loadingMarketplace, setLoadingMarketplace] = useState(false);

  // Signal link state
  const [signalUri, setSignalUri] = useState('');
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  useEffect(() => {
    if (step === 4) onComplete('');
  }, [step]);

  const saveConfig = async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to save configuration');
      handleNext();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Fetch marketplace and installed plugins
  const fetchPlugins = async () => {
    setLoadingMarketplace(true);
    try {
      const [marketRes, installedRes] = await Promise.all([
        fetch('/api/marketplace/plugins').catch(() => null),
        fetch('/api/plugins'),
      ]);

      if (marketRes?.ok) {
        const data = await marketRes.json();
        setMarketplacePlugins(data.plugins || []);
      }

      if (installedRes.ok) {
        const data = await installedRes.json();
        setInstalledChannels(data.plugins || []);
      }
    } catch (err) {
      console.error('Failed to fetch plugins:', err);
    } finally {
      setLoadingMarketplace(false);
    }
  };

  useEffect(() => {
    if (step === 2) fetchPlugins();
  }, [step]);

  const handleInstallPlugin = async (pluginId: string) => {
    setInstallingPlugin(pluginId);
    setError('');
    try {
      const res = await fetch('/api/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Install failed');
      }
      await fetchPlugins();
      setExpandedPlugin(pluginId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInstallingPlugin(null);
    }
  };

  const handleSavePluginConfig = async (pluginId: string) => {
    setSavingConfig(pluginId);
    setError('');
    try {
      const res = await fetch(`/api/plugins/${pluginId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: pluginConfigs[pluginId] || {} }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      // Start the plugin
      await fetch(`/api/plugins/${pluginId}/toggle`, { method: 'POST' });
      await fetchPlugins();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingConfig(null);
    }
  };

  const startLinking = (pluginId: string) => {
    setLinking(true);
    setSignalUri('');
    setLinked(false);
    const eventSource = new EventSource(`/api/plugins/${pluginId}/setup/link`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'uri') {
        setSignalUri(data.value);
      } else if (data.type === 'success') {
        setLinked(true);
        eventSource.close();
      } else if (data.type === 'error') {
        setError(`signal-cli exited with code ${data.code}. Check that the bot number is registered.`);
        eventSource.close();
        setLinking(false);
      }
    };

    eventSource.onerror = () => {
      setError('Signal linking failed or timed out.');
      eventSource.close();
      setLinking(false);
    };
  };

  const finalize = async () => {
    setError('');
    try {
      const res = await fetch('/api/bootstrap/finalize', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to finalize bootstrap');
      handleNext();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setupDaemon = async () => {
    setSettingUpDaemon(true);
    setError('');
    try {
      const res = await fetch('/api/daemon/setup', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to set up daemon');
        return;
      }
      handleNext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSettingUpDaemon(false);
    }
  };

  const hasOnlineChannel = installedChannels.some(c => c.status?.online);

  // Merge marketplace + installed for display
  const allPlugins = [
    ...marketplacePlugins.map(mp => ({
      ...mp,
      installedData: installedChannels.find(ic => ic.id === mp.id),
    })),
    // Include installed plugins not in marketplace
    ...installedChannels
      .filter(ic => !marketplacePlugins.some(mp => mp.id === ic.id))
      .map(ic => ({
        id: ic.id,
        name: ic.name,
        description: '',
        version: '',
        type: 'channel',
        installed: true,
        installedData: ic,
      })),
  ];

  return (
    <div className="max-w-2xl mx-auto bg-gray-900 p-8 rounded-xl shadow-2xl border border-gray-800 mt-12">
      <div className="flex justify-between mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={`h-2 flex-1 mx-1 rounded-full ${s <= step ? 'bg-brand' : 'bg-gray-800'}`} />
        ))}
      </div>

      {step === 1 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Step 1: Identity & AI</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Agent Name</label>
              <input
                type="text"
                value={config.name}
                onInput={(e) => setConfig({ ...config, name: (e.target as HTMLInputElement).value })}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 focus:border-brand outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Gemini API Key</label>
              <input
                type="password"
                placeholder="AIza..."
                value={config.apiKey}
                onInput={(e) => setConfig({ ...config, apiKey: (e.target as HTMLInputElement).value })}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 focus:border-brand outline-none"
              />
            </div>
            <button onClick={saveConfig} className="w-full bg-brand py-2 rounded font-bold mt-4">Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-2xl font-bold mb-2">Step 2: Choose Channels</h2>
          <p className="text-sm text-gray-400 mb-6">Install and configure at least one messaging channel.</p>

          {loadingMarketplace ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="animate-pulse bg-gray-800/50 rounded-xl h-20 border border-gray-800" />
              ))}
            </div>
          ) : allPlugins.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              <p>No plugins available. Check your marketplace URL or install manually.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {allPlugins.map(plugin => {
                const isInstalled = plugin.installed || !!plugin.installedData;
                const isOnline = plugin.installedData?.status?.online;
                const isExpanded = expandedPlugin === plugin.id;
                const schema = plugin.installedData?.schema;

                return (
                  <div key={plugin.id} className="bg-gray-800/30 rounded-xl border border-gray-800 overflow-hidden">
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {isInstalled && (
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-gray-600'}`} />
                        )}
                        <div className="min-w-0">
                          <span className="block font-bold text-sm truncate">{plugin.name}</span>
                          {plugin.description && <span className="block text-xs text-gray-500 truncate">{plugin.description}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {!isInstalled ? (
                          <button
                            onClick={() => handleInstallPlugin(plugin.id)}
                            disabled={installingPlugin === plugin.id}
                            className="px-3 py-1.5 text-xs rounded-lg font-bold text-green-400 bg-green-950/20 border border-green-900/40 hover:bg-green-900/40 disabled:opacity-50"
                          >
                            {installingPlugin === plugin.id ? 'Installing...' : 'Install'}
                          </button>
                        ) : (
                          <button
                            onClick={() => setExpandedPlugin(isExpanded ? null : plugin.id)}
                            className="px-3 py-1.5 text-xs rounded-lg font-bold text-brand bg-brand/10 border border-brand/30 hover:bg-brand/20"
                          >
                            {isExpanded ? 'Collapse' : 'Configure'}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && isInstalled && (
                      <div className="border-t border-gray-800 p-4 space-y-4">
                        {schema ? (
                          <>
                            {Object.entries(schema.properties || {}).map(([key, prop]: [string, any]) => (
                              <div key={key}>
                                <label className="block text-xs font-bold text-gray-400 mb-1">
                                  {prop.title || key}
                                  {(schema.required || []).includes(key) && <span className="text-red-400 ml-1">*</span>}
                                </label>
                                <input
                                  type={prop.type === 'number' ? 'number' : 'text'}
                                  value={pluginConfigs[plugin.id]?.[key] || ''}
                                  onInput={(e) => setPluginConfigs({
                                    ...pluginConfigs,
                                    [plugin.id]: {
                                      ...pluginConfigs[plugin.id],
                                      [key]: (e.target as HTMLInputElement).value,
                                    },
                                  })}
                                  placeholder={prop.description || ''}
                                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:border-brand outline-none"
                                />
                              </div>
                            ))}
                            <button
                              onClick={() => handleSavePluginConfig(plugin.id)}
                              disabled={savingConfig === plugin.id}
                              className="px-4 py-2 text-sm rounded-lg font-bold text-green-400 bg-green-950/20 border border-green-900/40 hover:bg-green-900/40 disabled:opacity-50"
                            >
                              {savingConfig === plugin.id ? 'Saving...' : 'Save & Start'}
                            </button>
                          </>
                        ) : (
                          <p className="text-xs text-gray-500">No configuration needed for this plugin.</p>
                        )}

                        {/* Signal-specific: Link Device */}
                        {plugin.id === 'signal' && (
                          <div className="border-t border-gray-700 pt-4 mt-4">
                            <h4 className="text-sm font-bold mb-3">Link Device</h4>
                            {!signalUri && !linking ? (
                              <button onClick={() => startLinking(plugin.id)} className="bg-brand px-4 py-2 rounded-lg text-sm font-bold">
                                Generate QR Code
                              </button>
                            ) : signalUri && !linked ? (
                              <div className="text-center">
                                <div className="bg-white p-4 inline-block rounded-lg mb-2">
                                  <QRCodeSVG value={signalUri} size={200} />
                                </div>
                                <p className="text-xs text-gray-400">Scan with Signal app (Settings {'>'} Linked Devices)</p>
                              </div>
                            ) : linked ? (
                              <div className="text-green-500 flex items-center gap-2">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="font-bold">Device Linked!</span>
                              </div>
                            ) : (
                              <div className="animate-pulse text-gray-400 text-sm">Waiting for QR code...</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}

          <div className="flex gap-4 mt-6">
            <button onClick={handleBack} className="flex-1 bg-gray-800 py-2 rounded font-bold">Back</button>
            <button
              onClick={handleNext}
              disabled={!hasOnlineChannel && installedChannels.length === 0}
              className="flex-1 bg-brand py-2 rounded font-bold disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Step 3: Complete Setup</h2>
          <p className="text-gray-400 mb-6">Finalize your agent configuration and optionally set up a background daemon.</p>

          <div className="space-y-4">
            <button
              onClick={finalize}
              className="w-full bg-brand py-3 rounded-lg font-bold"
            >
              Finalize Bootstrap
            </button>
            <button
              onClick={setupDaemon}
              disabled={settingUpDaemon}
              className="w-full bg-gray-800 border border-gray-700 py-3 rounded-lg font-bold hover:bg-gray-700 disabled:opacity-50"
            >
              {settingUpDaemon ? 'Setting up daemon...' : 'Set Up Background Daemon (Optional)'}
            </button>
          </div>

          {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}

          <div className="flex gap-4 mt-6">
            <button onClick={handleBack} className="flex-1 bg-gray-800 py-2 rounded font-bold">Back</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand"></div>
        </div>
      )}
    </div>
  );
}
