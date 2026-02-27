import { useState, useEffect } from 'preact/hooks';
import { Wizard } from './components/Wizard';
import { Dashboard } from './components/Dashboard';

export function App() {
  const [status, setStatus] = useState<{ bootstrapped: boolean, timestamp?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = () => {
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        setStatus(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch status:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleBootstrapComplete = (timestamp: string) => {
    setStatus({ bootstrapped: true, timestamp });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand"></div>
          <p className="text-gray-500 animate-pulse font-medium">Initializing TARS...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-white selection:bg-brand/30">
      <header className="bg-gray-900/50 backdrop-blur-md sticky top-0 z-10 border-b border-gray-800 p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center font-black text-white shadow-lg shadow-brand/20">T</div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">TARS</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border ${status?.bootstrapped ? 'text-green-500 border-green-900/50 bg-green-900/20' : 'text-yellow-500 border-yellow-900/50 bg-yellow-900/20'}`}>
              {status?.bootstrapped ? 'System Bootstrapped' : 'Setup Mode'}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto p-4 md:p-8">
        {!status?.bootstrapped ? (
          <Wizard onComplete={handleBootstrapComplete} />
        ) : (
          <Dashboard />
        )}
      </main>

      <footer className="bg-gray-950 border-t border-gray-900 p-6 text-center text-gray-600 text-xs">
        <div className="container mx-auto">
          <p className="font-medium">Tars Personal Assistant &copy; 2026</p>
          <p className="mt-1 text-gray-700">A lean, secure, local-first AI agent</p>
        </div>
      </footer>
    </div>
  );
}
