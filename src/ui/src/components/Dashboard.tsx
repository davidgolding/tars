import { useState, useEffect, useRef } from 'preact/hooks';
import { Modal } from './Modal';

interface Message {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  threadId?: string;
}

export function Dashboard() {
  const [activeTab, setActiveTab] = useState('chat');
  const [isRestarting, setIsRestarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
        // Prevent duplicate messages if they are already in the list
        if (newMessage.id && prev.some(m => m.id === newMessage.id)) return prev;
        return [...prev, newMessage];
      });
    };

    return () => {
      eventSource.close();
      clearInterval(interval);
    };
  }, []);

  useEffect(scrollToBottom, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isSending) return;

    setIsSending(true);
    const content = inputValue;
    setInputValue('');

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
      setInputValue(content); // Restore input on failure
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
              <div className="text-[10px] text-gray-500 font-mono">{status?.targetNumber}</div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-black/20">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-4">
                   <div className="p-4 bg-gray-900 rounded-full border border-gray-800">
                    <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                   </div>
                   <p className="italic text-sm">No messages in history. Start a conversation on Signal!</p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  let displayContent = msg.content;
                  try {
                    const parsed = JSON.parse(msg.content);
                    displayContent = parsed.content || displayContent;
                  } catch (e) {}

                  return (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2 shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-br-none' 
                          : 'bg-gray-800 text-gray-100 rounded-bl-none'
                      }`}>
                         <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayContent}</p>
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
                <input
                  type="text"
                  placeholder={isSending ? "Tars is thinking..." : "Chat with your Signal bot from here..."}
                  className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none placeholder:text-gray-600"
                  value={inputValue}
                  onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSending}
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

        {activeTab === 'settings' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-8 border-b border-gray-800 pb-4 flex items-center gap-3">
              <svg className="w-6 h-6 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>
              Configuration
            </h2>
            <div className="space-y-8 max-w-xl">
               <div className="grid grid-cols-1 gap-6">
                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 group-hover:text-brand transition-colors">Bot Number</label>
                    <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700 text-gray-100 font-mono shadow-inner">{status?.botNumber || 'Not set'}</div>
                  </div>
                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 group-hover:text-brand transition-colors">Authorized Number</label>
                    <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700 text-gray-100 font-mono shadow-inner">{status?.targetNumber || 'Not set'}</div>
                  </div>
                  <div className="group">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 group-hover:text-brand transition-colors">Bootstrap Timestamp</label>
                    <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700 text-gray-400 font-mono text-xs shadow-inner">{status?.timestamp || 'Pending'}</div>
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

               <div className="flex items-center justify-between p-5 bg-gray-800/30 rounded-2xl border border-gray-800 hover:border-gray-700 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 ${status?.signalOnline ? 'bg-green-500/10' : 'bg-red-500/10'} rounded-full flex items-center justify-center`}>
                       <div className={`w-3 h-3 ${status?.signalOnline ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 'bg-red-500'} rounded-full animate-pulse`}></div>
                    </div>
                    <div>
                      <span className="block font-bold">Signal Daemon</span>
                      <span className="text-[10px] text-gray-500 font-mono">Status: {status?.signalOnline ? 'Responsive' : 'Unresponsive'}</span>
                    </div>
                  </div>
                  <span className={`text-[10px] font-black ${status?.signalOnline ? 'text-green-500 bg-green-950/40 border-green-900/50' : 'text-red-500 bg-red-950/40 border-red-900/50'} px-3 py-1.5 rounded-lg border uppercase tracking-tighter`}>
                    {status?.signalOnline ? 'ONLINE' : 'OFFLINE'}
                  </span>
               </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
