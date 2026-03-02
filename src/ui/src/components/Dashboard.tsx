import { useState, useEffect, useRef } from 'preact/hooks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Modal } from './Modal';

interface Message {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  threadId?: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  active: boolean;
  isSystem: boolean;
}

interface ChannelPlugin {
  id: string;
  name: string;
  type: 'channel' | 'adapter';
  version: string;
  enabled: boolean;
  installedAt: string;
  status?: {
    online: boolean;
    lastError?: string;
  };
  schema?: Record<string, any>;
}

const markdownComponents = {
  p: (({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>) as any,
  ul: (({ children }: any) => <ul className="list-disc ml-4 mb-2">{children}</ul>) as any,
  ol: (({ children }: any) => <ol className="list-decimal ml-4 mb-2">{children}</ol>) as any,
  li: (({ children }: any) => <li className="mb-1">{children}</li>) as any,
  code: (({ children, className }: any) => {
    const isBlock = /language-(\w+)/.test(className || '');
    return isBlock
      ? <pre className="bg-black/30 rounded p-2 my-2 overflow-x-auto font-mono text-xs"><code>{children}</code></pre>
      : <code className="bg-black/30 rounded px-1 font-mono text-xs">{children}</code>;
  }) as any,
  h1: (({ children }: any) => <h1 className="text-lg font-bold mb-2">{children}</h1>) as any,
  h2: (({ children }: any) => <h2 className="text-base font-bold mb-2">{children}</h2>) as any,
  h3: (({ children }: any) => <h3 className="text-sm font-bold mb-2">{children}</h3>) as any,
  blockquote: (({ children }: any) => <blockquote className="border-l-2 border-gray-500 pl-2 italic mb-2">{children}</blockquote>) as any,
  a: (({ children, href }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">{children}</a>) as any,
  table: (({ children }: any) => <div className="overflow-x-auto mb-2"><table className="border-collapse border border-gray-600 w-full text-xs">{children}</table></div>) as any,
  th: (({ children }: any) => <th className="border border-gray-600 px-2 py-1 bg-gray-700 font-bold">{children}</th>) as any,
  td: (({ children }: any) => <td className="border border-gray-600 px-2 py-1">{children}</td>) as any,
};

export function Dashboard({ isBootstrapped }: { isBootstrapped: boolean }) {
  const [activeTab, setActiveTab] = useState('chat');
  const [isRestarting, setIsRestarting] = useState(false);
  const [marketplacePlugins, setMarketplacePlugins] = useState<any[]>([]);
  const [installingMarketplace, setInstallingMarketplace] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);
  const [installInput, setInstallInput] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [showRawContent, setShowRawContent] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);

  // Channels state
  const [channels, setChannels] = useState<ChannelPlugin[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelPlugin | null>(null);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [togglingChannel, setTogglingChannel] = useState<string | null>(null);
  const [channelConfig, setChannelConfig] = useState<Record<string, string>>({});
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [channelInstallInput, setChannelInstallInput] = useState('');

  // Modal State
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    type?: 'info' | 'danger' | 'success';
  }>({
    isOpen: false,
    title: '',
    message: '',
  });

  const closeModal = () => setModal(prev => ({ ...prev, isOpen: false }));

  // --- Skills handlers ---

  const fetchSkills = async () => {
    setIsLoadingSkills(true);
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.skills) setSkills(data.skills);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setIsLoadingSkills(false);
    }
  };

  const handleToggleSkill = async (skill: Skill) => {
    setTogglingSkill(skill.id);
    try {
      const res = await fetch(`/api/skills/${skill.id}/toggle`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setModal({
          isOpen: true,
          title: 'Toggle Failed',
          message: data.error || `Request failed (${res.status})`,
          confirmLabel: 'Close',
          type: 'danger',
          onConfirm: closeModal,
        });
        return;
      }
      setRestartNeeded(true);
      await fetchSkills();
      // Update selectedSkill if we're in detail view
      if (selectedSkill?.id === skill.id) {
        const updated = skills.find(s => s.id === skill.id);
        if (updated) setSelectedSkill({ ...updated, active: !skill.active });
      }
    } catch (err) {
      setModal({
        isOpen: true,
        title: 'Toggle Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal,
      });
    } finally {
      setTogglingSkill(null);
    }
  };

  const handleRemoveSkill = (skill: Skill) => {
    setModal({
      isOpen: true,
      title: 'Remove Skill',
      message: `Are you sure you want to permanently delete "${skill.name}"? This action cannot be undone.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      type: 'danger',
      onConfirm: async () => {
        closeModal();
        try {
          const res = await fetch(`/api/skills/${skill.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Request failed (${res.status})`);
          }
          setSelectedSkill(null);
          setRestartNeeded(true);
          await fetchSkills();
        } catch (err) {
          setModal({
            isOpen: true,
            title: 'Remove Failed',
            message: (err as Error).message,
            confirmLabel: 'Close',
            type: 'danger',
            onConfirm: closeModal,
          });
        }
      },
    });
  };

  const handleInstallSkill = async () => {
    if (!installInput.trim() || isInstalling) return;
    setIsInstalling(true);
    try {
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: installInput.trim() }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setModal({
          isOpen: true,
          title: 'Already Exists',
          message: data.error,
          confirmLabel: 'Close',
          type: 'info',
          onConfirm: closeModal,
        });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Install failed');
      setInstallInput('');
      setRestartNeeded(true);
      await fetchSkills();
      setModal({
        isOpen: true,
        title: 'Skill Installed',
        message: `"${data.skill?.name || installInput}" has been installed successfully.`,
        confirmLabel: 'OK',
        type: 'success',
        onConfirm: closeModal,
      });
    } catch (err) {
      setModal({
        isOpen: true,
        title: 'Install Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal,
      });
    } finally {
      setIsInstalling(false);
    }
  };

  const handleRestartFromBanner = async () => {
    try {
      const res = await fetch('/api/system/restart', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reach server');
      setRestartNeeded(false);
      setModal({
        isOpen: true,
        title: 'Restarting...',
        message: 'System restart initiated. The connection will drop momentarily. Please refresh in a few seconds.',
        confirmLabel: 'Got it',
        type: 'success',
        onConfirm: closeModal,
      });
    } catch (err) {
      setModal({
        isOpen: true,
        title: 'Restart Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal,
      });
    }
  };

  // --- Channel handlers ---

  const fetchChannels = async () => {
    setIsLoadingChannels(true);
    try {
      const res = await fetch('/api/plugins');
      const data = await res.json();
      if (data.plugins) setChannels(data.plugins);
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    } finally {
      setIsLoadingChannels(false);
    }
  };

  const handleToggleChannel = async (channel: ChannelPlugin) => {
    setTogglingChannel(channel.id);
    try {
      const res = await fetch(`/api/plugins/${channel.id}/toggle`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setModal({
          isOpen: true,
          title: 'Toggle Failed',
          message: data.error || `Request failed (${res.status})`,
          confirmLabel: 'Close',
          type: 'danger',
          onConfirm: closeModal,
        });
        return;
      }
      await fetchChannels();
    } catch (err) {
      setModal({
        isOpen: true,
        title: 'Toggle Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal,
      });
    } finally {
      setTogglingChannel(null);
    }
  };

  const handleSaveChannelConfig = async (channelId: string) => {
    setIsSavingConfig(true);
    try {
      const res = await fetch(`/api/plugins/${channelId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: channelConfig }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save config');
      }
      setModal({
        isOpen: true,
        title: 'Config Saved',
        message: 'Channel configuration saved successfully.',
        confirmLabel: 'OK',
        type: 'success',
        onConfirm: closeModal,
      });
    } catch (err) {
      setModal({
        isOpen: true,
        title: 'Save Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal,
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleInstallChannel = async () => {
    if (!channelInstallInput.trim() || isInstalling) return;
    setIsInstalling(true);
    try {
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: channelInstallInput.trim() }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setModal({
          isOpen: true,
          title: 'Already Exists',
          message: data.error,
          confirmLabel: 'Close',
          type: 'info',
          onConfirm: closeModal,
        });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Install failed');
      setChannelInstallInput('');
      await fetchChannels();
      setModal({
        isOpen: true,
        title: 'Channel Installed',
        message: `"${data.plugin?.name || channelInstallInput}" has been installed successfully.`,
        confirmLabel: 'OK',
        type: 'success',
        onConfirm: closeModal,
      });
    } catch (err) {
      setModal({
        isOpen: true,
        title: 'Install Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal,
      });
    } finally {
      setIsInstalling(false);
    }
  };

  // --- Marketplace handlers ---

  const fetchMarketplace = async () => {
    try {
      const res = await fetch('/api/marketplace/plugins');
      if (res.ok) {
        const data = await res.json();
        setMarketplacePlugins(data.plugins || []);
      }
    } catch (err) {
      console.error('Failed to fetch marketplace:', err);
    }
  };

  const handleInstallMarketplace = async (pluginId: string) => {
    setInstallingMarketplace(pluginId);
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
      await fetchChannels();
      await fetchMarketplace();
      setModal({
        isOpen: true,
        title: 'Plugin Installed',
        message: `"${pluginId}" has been installed successfully.`,
        confirmLabel: 'OK',
        type: 'success',
        onConfirm: closeModal,
      });
    } catch (err) {
      setModal({
        isOpen: true,
        title: 'Install Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal,
      });
    } finally {
      setInstallingMarketplace(null);
    }
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const fetchStatus = () => {
      fetch('/api/status')
        .then(res => res.json())
        .then(setStatus);
    };

    fetchStatus();
    fetchSkills();
    const interval = setInterval(fetchStatus, 10000);

    fetch('/api/chat/history')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setMessages(data);
      });

    const eventSource = new EventSource('/api/chat/events');
    eventSource.onmessage = (event) => {
      const newMessage = JSON.parse(event.data);
      setMessages(prev => {
        if (newMessage.id && prev.some(m => m.id === newMessage.id)) return prev;
        return [...prev, newMessage];
      });
    };

    return () => {
      eventSource.close();
      clearInterval(interval);
    };
  }, []);

  // Refetch skills when switching to the skills tab
  useEffect(() => {
    if (activeTab === 'skills') fetchSkills();
    if (activeTab === 'channels') { fetchChannels(); fetchMarketplace(); }
  }, [activeTab]);

  useEffect(scrollToBottom, [messages]);

  const handleTextareaInput = (e: Event) => {
    const el = e.target as HTMLTextAreaElement;
    setInputValue(el.value);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const resetTextarea = () => {
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isSending) return;

    setIsSending(true);
    const content = inputValue;
    resetTextarea();

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send message');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setModal({
        isOpen: true,
        title: 'Message Failed',
        message: (err as Error).message,
        confirmLabel: 'Close',
        type: 'danger',
        onConfirm: closeModal
      });
      setInputValue(content);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleRestart = async () => {
    setModal({
      isOpen: true,
      title: 'Restart System',
      message: 'Are you sure you want to restart the entire system? This will briefly disconnect all services.',
      confirmLabel: 'Restart Now',
      cancelLabel: 'Cancel',
      type: 'danger',
      onConfirm: async () => {
        closeModal();
        setIsRestarting(true);
        try {
          const res = await fetch('/api/system/restart', { method: 'POST' });
          if (!res.ok) throw new Error('Failed to reach server');

          setModal({
            isOpen: true,
            title: 'Restarting...',
            message: 'System restart initiated. The connection will drop momentarily. Please refresh in a few seconds.',
            confirmLabel: 'Got it',
            type: 'success',
            onConfirm: closeModal
          });
        } catch (err) {
          setModal({
            isOpen: true,
            title: 'Restart Failed',
            message: 'Failed to trigger the system restart. Please check the server logs or try manually.',
            confirmLabel: 'Close',
            type: 'danger',
            onConfirm: closeModal
          });
        } finally {
          setIsRestarting(false);
        }
      }
    });
  };

  // --- Render helpers ---

  const SpinnerIcon = () => (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  const SkillToggleButton = ({ skill, compact }: { skill: Skill; compact?: boolean }) => {
    if (skill.isSystem) {
      return (
        <span className={`text-gray-500 bg-gray-800/50 border border-gray-700 ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} rounded-lg font-bold uppercase tracking-wider`}>
          System
        </span>
      );
    }
    const isToggling = togglingSkill === skill.id;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleToggleSkill(skill); }}
        disabled={isToggling}
        className={`flex items-center gap-1.5 ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-2 text-xs'} rounded-lg font-bold border transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
          skill.active
            ? 'text-red-400 bg-red-950/20 border-red-900/40 hover:bg-red-900/40'
            : 'text-green-400 bg-green-950/20 border-green-900/40 hover:bg-green-900/40'
        }`}
      >
        {isToggling ? <SpinnerIcon /> : null}
        {isToggling ? (skill.active ? 'Deactivating...' : 'Activating...') : skill.active ? 'Deactivate' : 'Activate'}
      </button>
    );
  };

  const renderSkillsList = () => (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-8 border-b border-gray-800 pb-4 flex items-center gap-3">
        <svg className="w-6 h-6 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
        </svg>
        Skills
      </h2>

      {/* Restart banner */}
      {restartNeeded && (
        <div className="mb-6 flex items-center justify-between bg-yellow-950/30 border border-yellow-900/40 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            Skill changes require a restart to take effect.
          </div>
          <button
            onClick={handleRestartFromBanner}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-yellow-400 bg-yellow-950/40 border border-yellow-900/50 hover:bg-yellow-900/40 transition-all active:scale-95"
          >
            Restart Now
          </button>
        </div>
      )}

      {/* Install input */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          placeholder="Install skill by name or GitHub URL..."
          value={installInput}
          onInput={(e) => setInstallInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleInstallSkill(); }}
          disabled={isInstalling}
          className="flex-1 bg-gray-800 border border-gray-700 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand/50 placeholder:text-gray-600 disabled:opacity-50"
        />
        <button
          onClick={handleInstallSkill}
          disabled={isInstalling || !installInput.trim()}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-green-400 bg-green-950/20 border-green-900/40 hover:bg-green-900/40`}
        >
          {isInstalling ? <SpinnerIcon /> : null}
          {isInstalling ? 'Installing...' : 'Add'}
        </button>
      </div>

      {/* Skills list */}
      {isLoadingSkills && skills.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse bg-gray-800/50 rounded-xl h-16 border border-gray-800" />
          ))}
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
          </svg>
          <p className="text-sm">No skills installed. Use the input above to add one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map(skill => (
            <div
              key={skill.id}
              onClick={() => { setSelectedSkill(skill); setShowRawContent(false); }}
              className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${skill.active ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500'}`} />
                <div className="min-w-0">
                  <span className="block font-bold text-sm truncate group-hover:text-brand transition-colors">{skill.name}</span>
                  {skill.description && (
                    <span className="block text-[11px] text-gray-500 truncate">{skill.description}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                <SkillToggleButton skill={skill} compact />
                {!skill.isSystem && (
                  <button
                    onClick={() => handleRemoveSkill(skill)}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/40 transition-all active:scale-95"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSkillDetail = () => {
    if (!selectedSkill) return null;
    // Get latest data from skills array
    const skill = skills.find(s => s.id === selectedSkill.id) || selectedSkill;

    return (
      <div className="p-8">
        {/* Back button */}
        <button
          onClick={() => { setSelectedSkill(null); setShowRawContent(false); }}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-6"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Skills
        </button>

        {/* Restart banner */}
        {restartNeeded && (
          <div className="mb-6 flex items-center justify-between bg-yellow-950/30 border border-yellow-900/40 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-yellow-400 text-sm">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Skill changes require a restart to take effect.
            </div>
            <button
              onClick={handleRestartFromBanner}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-yellow-400 bg-yellow-950/40 border border-yellow-900/50 hover:bg-yellow-900/40 transition-all active:scale-95"
            >
              Restart Now
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-6 border-b border-gray-800 pb-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${skill.active ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500'}`} />
              <h2 className="text-2xl font-bold truncate">{skill.name}</h2>
            </div>
            {skill.description && (
              <p className="text-sm text-gray-400 mt-1 ml-[22px]">{skill.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <SkillToggleButton skill={skill} />
            {!skill.isSystem && (
              <button
                onClick={() => handleRemoveSkill(skill)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-red-400 bg-red-950/20 border border-red-900/40 hover:bg-red-900/40 transition-all active:scale-95"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Content toggle */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Content</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => setShowRawContent(false)}
              className={`px-3 py-1 text-xs font-bold transition-colors ${!showRawContent ? 'bg-brand/10 text-brand' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Rendered
            </button>
            <button
              onClick={() => setShowRawContent(true)}
              className={`px-3 py-1 text-xs font-bold transition-colors ${showRawContent ? 'bg-brand/10 text-brand' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Raw
            </button>
          </div>
        </div>

        {/* Content area */}
        {skill.content ? (
          showRawContent ? (
            <pre className="bg-gray-950 p-4 rounded-xl overflow-auto text-sm text-gray-300 font-mono leading-relaxed max-h-[500px] border border-gray-800">
              {skill.content}
            </pre>
          ) : (
            <div className="prose prose-invert max-w-none text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                {skill.content}
              </ReactMarkdown>
            </div>
          )
        ) : (
          <div className="text-center py-8 text-gray-500 text-sm">
            No content available for this skill.
          </div>
        )}
      </div>
    );
  };

  const renderChannelsList = () => (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-8 border-b border-gray-800 pb-4 flex items-center gap-3">
        <svg className="w-6 h-6 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        Channels
      </h2>

      {/* Install inputs */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Install channel by GitHub URL..."
            value={channelInstallInput}
            onInput={(e) => setChannelInstallInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleInstallChannel(); }}
            disabled={isInstalling}
            className="flex-1 bg-gray-800 border border-gray-700 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand/50 placeholder:text-gray-600 disabled:opacity-50"
          />
          <button
            onClick={handleInstallChannel}
            disabled={isInstalling || !channelInstallInput.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-green-400 bg-green-950/20 border-green-900/40 hover:bg-green-900/40`}
          >
            {isInstalling ? <SpinnerIcon /> : null}
            {isInstalling ? 'Installing...' : 'Add'}
          </button>
        </div>

        {/* Marketplace plugins */}
        {marketplacePlugins.filter(mp => !mp.installed).length > 0 && (
          <div className="bg-brand/5 border border-brand/20 rounded-xl p-4">
            <h3 className="text-xs font-bold text-brand uppercase tracking-widest mb-3">Marketplace</h3>
            <div className="space-y-2">
              {marketplacePlugins.filter(mp => !mp.installed).map(mp => (
                <div key={mp.id} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="block text-sm font-bold">{mp.name}</span>
                    <span className="block text-xs text-gray-500">{mp.description}</span>
                  </div>
                  <button
                    onClick={() => handleInstallMarketplace(mp.id)}
                    disabled={installingMarketplace === mp.id}
                    className="shrink-0 ml-3 px-3 py-1.5 text-xs rounded-lg font-bold text-green-400 bg-green-950/20 border border-green-900/40 hover:bg-green-900/40 disabled:opacity-50"
                  >
                    {installingMarketplace === mp.id ? 'Installing...' : 'Install'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Channels list */}
      {isLoadingChannels && channels.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse bg-gray-800/50 rounded-xl h-16 border border-gray-800" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-sm">No channels installed. Use the input above to add one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map(channel => (
            <div
              key={channel.id}
              onClick={() => { setSelectedChannel(channel); setChannelConfig({}); }}
              className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${channel.status?.online ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500'}`} />
                <div className="min-w-0">
                  <span className="block font-bold text-sm truncate group-hover:text-brand transition-colors">{channel.name}</span>
                  <span className="block text-[11px] text-gray-500 truncate">v{channel.version}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleToggleChannel(channel)}
                  disabled={togglingChannel === channel.id}
                  className={`flex items-center gap-1.5 px-2 py-1 text-[10px] rounded-lg font-bold border transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                    channel.status?.online
                      ? 'text-red-400 bg-red-950/20 border-red-900/40 hover:bg-red-900/40'
                      : 'text-green-400 bg-green-950/20 border-green-900/40 hover:bg-green-900/40'
                  }`}
                >
                  {togglingChannel === channel.id ? <SpinnerIcon /> : null}
                  {togglingChannel === channel.id ? (channel.status?.online ? 'Stopping...' : 'Starting...') : channel.status?.online ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderChannelDetail = () => {
    if (!selectedChannel) return null;
    const channel = channels.find(c => c.id === selectedChannel.id) || selectedChannel;

    return (
      <div className="p-8">
        <button
          onClick={() => setSelectedChannel(null)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-6"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Channels
        </button>

        <div className="flex items-start justify-between mb-6 border-b border-gray-800 pb-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${channel.status?.online ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500'}`} />
              <h2 className="text-2xl font-bold truncate">{channel.name}</h2>
            </div>
            <p className="text-sm text-gray-400 mt-1 ml-[22px]">Version {channel.version}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              onClick={() => handleToggleChannel(channel)}
              disabled={togglingChannel === channel.id}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-50 ${
                channel.status?.online
                  ? 'text-red-400 bg-red-950/20 border-red-900/40 hover:bg-red-900/40'
                  : 'text-green-400 bg-green-950/20 border-green-900/40 hover:bg-green-900/40'
              }`}
            >
              {togglingChannel === channel.id ? <SpinnerIcon /> : null}
              {togglingChannel === channel.id ? (channel.status?.online ? 'Stopping...' : 'Starting...') : channel.status?.online ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>

        {channel.schema ? (
          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4">Configuration</h3>
            <div className="space-y-4">
              {Object.entries(channel.schema.properties || {}).map(([key, prop]: [string, any]) => (
                <div key={key}>
                  <label className="block text-xs font-bold text-gray-400 mb-2">
                    {prop.title || key}
                    {(channel.schema?.required || []).includes(key) && <span className="text-red-400 ml-1">*</span>}
                  </label>
                  <input
                    type={prop.type === 'number' ? 'number' : 'text'}
                    value={channelConfig[key] || ''}
                    onInput={(e) => setChannelConfig({ ...channelConfig, [key]: (e.target as HTMLInputElement).value })}
                    placeholder={prop.description || ''}
                    className="w-full bg-gray-800 border border-gray-700 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand/50"
                  />
                  {prop.description && (
                    <p className="text-[10px] text-gray-500 mt-1">{prop.description}</p>
                  )}
                </div>
              ))}
              <button
                onClick={() => handleSaveChannelConfig(channel.id)}
                disabled={isSavingConfig}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-green-400 bg-green-950/20 border border-green-900/40 hover:bg-green-900/40 transition-all active:scale-95 disabled:opacity-50"
              >
                {isSavingConfig ? <SpinnerIcon /> : null}
                {isSavingConfig ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 text-sm">
            No configuration schema available for this channel.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      <Modal
        isOpen={modal.isOpen}
        title={modal.title}
        message={modal.message}
        confirmLabel={modal.confirmLabel}
        cancelLabel={modal.cancelLabel}
        type={modal.type}
        onConfirm={modal.onConfirm || closeModal}
        onCancel={closeModal}
      />
      <aside className="md:col-span-1 bg-gray-900 p-4 rounded-xl border border-gray-800 h-fit shadow-lg sticky top-24">
        <nav className="space-y-1">
          {[
            { id: 'chat', label: 'Chat Mirror', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
            { id: 'skills', label: 'Skills', icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
            { id: 'channels', label: 'Channels', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
            { id: 'settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
            { id: 'health', label: 'System Health', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${activeTab === tab.id ? 'bg-brand/10 text-brand shadow-sm' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={tab.icon}></path></svg>
              <span className="font-medium text-sm">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="mt-8 pt-6 border-t border-gray-800">
          <button
            onClick={handleRestart}
            disabled={isRestarting}
            className="w-full flex items-center justify-center gap-2 bg-red-950/20 text-red-500 border border-red-900/30 px-3 py-2.5 rounded-lg hover:bg-red-900/40 transition-all active:scale-95 disabled:opacity-50 text-sm font-bold"
          >
            <svg className={`w-4 h-4 ${isRestarting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            {isRestarting ? 'Restarting...' : 'System Restart'}
          </button>
        </div>
      </aside>

      <section className="md:col-span-3 bg-gray-900 rounded-2xl border border-gray-800 flex flex-col shadow-2xl overflow-hidden min-h-[700px]">
        {activeTab === 'chat' && (
          <>
            <div className="px-6 py-4 bg-gray-900/50 border-b border-gray-800 flex justify-between items-center backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Chat Mirror</h2>
                <div className="flex items-center gap-1.5 bg-green-900/20 text-green-500 px-2 py-0.5 rounded-full border border-green-900/50">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Live</span>
                </div>
              </div>
              <div className="text-[10px] text-gray-500 font-mono">{(status?.channels || []).filter((c: any) => c.online).length} channel(s) online</div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-black/20">
              {messages.length === 0 ? (
                <div className="flex flex-col justify-end h-full pb-2">
                  {!isBootstrapped && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-none px-4 py-3 bg-gray-800 text-gray-100 shadow-sm">
                        <p className="text-sm leading-relaxed">Hey! Before I can help you, I need to learn a bit about you. Send me a message to kick off a short setup conversation — I'll ask your name, how you'd like to be addressed, and a few other things to get started.</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                messages.map((msg, i) => {
                  let displayContent = msg.content;
                  try {
                    const parsed = JSON.parse(msg.content);

                    if (parsed.parts && Array.isArray(parsed.parts)) {
                      displayContent = parsed.parts
                        .map((part: any) => {
                          if (part.type === 'text') {
                            return part.text.replace(/<working_memory_data>[\s\S]*?<\/working_memory_data>/g, '').trim();
                          }
                          return '';
                        })
                        .filter(Boolean)
                        .join('\n\n');
                    }
                    else if (parsed.content) {
                      displayContent = parsed.content.replace(/<working_memory_data>[\s\S]*?<\/working_memory_data>/g, '').trim();
                    }
                    else if (parsed.text) {
                      displayContent = parsed.text.replace(/<working_memory_data>[\s\S]*?<\/working_memory_data>/g, '').trim();
                    }
                    else if (parsed.error) {
                      displayContent = typeof parsed.error === 'string'
                        ? parsed.error
                        : (parsed.error.message || JSON.stringify(parsed.error));
                    }
                    else if (parsed.message) {
                      displayContent = parsed.message;
                    }
                  } catch (e) {
                    // Not JSON, use as is
                  }

                  displayContent = displayContent.replace(/<working_memory_data>[\s\S]*?<\/working_memory_data>/g, '').trim();

                  if (!displayContent) return null;

                  return (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2 shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-br-none'
                          : 'bg-gray-800 text-gray-100 rounded-bl-none'
                      }`}>
                         <div className="text-sm leading-relaxed">
                           <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                            {displayContent}
                           </ReactMarkdown>
                         </div>
                         <div className={`text-[9px] mt-1 opacity-60 font-medium ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                           {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                         </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 bg-gray-900 border-t border-gray-800">
              <div className="flex gap-2 bg-gray-800/50 p-1.5 rounded-xl border border-gray-700/50">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  placeholder={isSending ? "Tars is thinking..." : "Chat with your agent from here..."}
                  className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none placeholder:text-gray-600 resize-none overflow-hidden leading-5"
                  value={inputValue}
                  onInput={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  disabled={isSending}
                  style={{ maxHeight: '160px', overflowY: inputValue.split('\n').length > 8 ? 'auto' : 'hidden' }}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isSending || !inputValue.trim()}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                    isSending || !inputValue.trim()
                      ? 'bg-brand/10 text-brand/30 cursor-not-allowed'
                      : 'bg-brand/20 text-brand hover:bg-brand/30 active:scale-95'
                  }`}
                >
                  {isSending ? (
                    <div className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Thinking...</span>
                    </div>
                  ) : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'skills' && (
          selectedSkill ? renderSkillDetail() : renderSkillsList()
        )}

        {activeTab === 'channels' && (
          selectedChannel ? renderChannelDetail() : renderChannelsList()
        )}

        {activeTab === 'settings' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-8 border-b border-gray-800 pb-4 flex items-center gap-3">
              <svg className="w-6 h-6 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>
              Configuration
            </h2>
            <div className="space-y-8 max-w-xl">
               <div className="grid grid-cols-1 gap-6">
                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 group-hover:text-brand transition-colors">Bootstrap Timestamp</label>
                    <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700 text-gray-400 font-mono text-xs shadow-inner">{status?.timestamp || 'Pending'}</div>
                  </div>
                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 group-hover:text-brand transition-colors">Active Channels</label>
                    <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700 text-gray-100 font-mono shadow-inner">
                      {(status?.channels || []).length > 0
                        ? (status.channels as any[]).map((ch: any) => ch.name).join(', ')
                        : 'None'}
                    </div>
                  </div>
               </div>
               <div className="bg-brand/5 border border-brand/20 p-4 rounded-xl">
                  <p className="text-xs text-brand/80 leading-relaxed flex gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Settings are currently read-only. To modify, edit your <code>.env</code> file and restart the system.
                  </p>
               </div>
            </div>
          </div>
        )}

        {activeTab === 'health' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-8 border-b border-gray-800 pb-4 flex items-center gap-3">
              <svg className="w-6 h-6 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              System Health
            </h2>
            <div className="grid grid-cols-1 gap-4">
               <div className="flex items-center justify-between p-5 bg-gray-800/30 rounded-2xl border border-gray-800 hover:border-gray-700 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center">
                       <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_12px_rgba(34,197,94,0.6)]"></div>
                    </div>
                    <div>
                      <span className="block font-bold">UI API Server</span>
                      <span className="text-[10px] text-gray-500 font-mono">Port {window.location.port || '5827'}</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-black text-green-500 bg-green-950/40 px-3 py-1.5 rounded-lg border border-green-900/50 uppercase tracking-tighter">ONLINE</span>
               </div>

               {(status?.channels || []).map((ch: any) => (
                 <div key={ch.id} className="flex items-center justify-between p-5 bg-gray-800/30 rounded-2xl border border-gray-800 hover:border-gray-700 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 ${ch.online ? 'bg-green-500/10' : 'bg-red-500/10'} rounded-full flex items-center justify-center`}>
                         <div className={`w-3 h-3 ${ch.online ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 'bg-red-500'} rounded-full animate-pulse`}></div>
                      </div>
                      <div>
                        <span className="block font-bold">{ch.name}</span>
                        <span className="text-[10px] text-gray-500 font-mono">Status: {ch.online ? 'Online' : 'Offline'}</span>
                      </div>
                    </div>
                    <span className={`text-[10px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-tighter ${
                      ch.online
                        ? 'text-green-500 bg-green-950/40 border-green-900/50'
                        : 'text-red-500 bg-red-950/40 border-red-900/50'
                    }`}>
                      {ch.online ? 'ONLINE' : 'OFFLINE'}
                    </span>
                 </div>
               ))}
               {(!status?.channels || status.channels.length === 0) && (
                 <div className="text-center py-8 text-gray-500 text-sm">No channels installed.</div>
               )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
