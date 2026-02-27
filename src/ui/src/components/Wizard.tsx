import { useState, useEffect } from 'preact/hooks';
import { QRCodeSVG } from 'qrcode.react';

export function Wizard({ onComplete }: { onComplete: (timestamp: string) => void }) {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState({
    name: 'Tars',
    apiKey: '',
    model: 'google/gemini-2.0-flash',
    botNumber: '',
    targetNumber: '',
    promptsPath: 'agent/',
  });
  const [signalUri, setSignalUri] = useState('');
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState('');

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

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

  const startLinking = () => {
    setLinking(true);
    const eventSource = new EventSource('/api/signal/link');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'uri') {
        setSignalUri(data.value);
      } else if (data.type === 'success') {
        setLinked(true);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      setError('Signal linking failed or timed out.');
      eventSource.close();
      setLinking(false);
    };
  };

  const finalize = async () => {
    try {
      const res = await fetch('/api/bootstrap/finalize', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onComplete(data.timestamp);
      }
    } catch (err) {
      setError('Failed to finalize bootstrap');
    }
  };

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
              <p className="text-xs text-gray-500 mt-1">Leave blank to use Gemini CLI (OAuth)</p>
            </div>
            <button onClick={handleNext} className="w-full bg-brand py-2 rounded font-bold mt-4">Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Step 2: Signal Numbers</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Bot Number (E.164)</label>
              <input
                type="text"
                placeholder="+1234567890"
                value={config.botNumber}
                onInput={(e) => setConfig({ ...config, botNumber: (e.target as HTMLInputElement).value })}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 focus:border-brand outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Your Number (Target)</label>
              <input
                type="text"
                placeholder="+1987654321"
                value={config.targetNumber}
                onInput={(e) => setConfig({ ...config, targetNumber: (e.target as HTMLInputElement).value })}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 focus:border-brand outline-none"
              />
            </div>
            <div className="flex gap-4">
              <button onClick={handleBack} className="flex-1 bg-gray-800 py-2 rounded font-bold">Back</button>
              <button onClick={saveConfig} className="flex-1 bg-brand py-2 rounded font-bold">Save & Continue</button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Step 3: Link Signal</h2>
          {!signalUri && !linking ? (
            <button onClick={startLinking} className="bg-brand px-8 py-3 rounded-lg font-bold">Generate Link QR Code</button>
          ) : signalUri && !linked ? (
            <div className="bg-white p-4 inline-block rounded-lg mb-4">
              <QRCodeSVG value={signalUri} size={256} />
              <p className="text-black mt-2 text-sm font-medium">Scan with Signal app (Settings > Linked Devices)</p>
            </div>
          ) : linked ? (
            <div className="text-green-500 mb-4">
              <svg className="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              <p className="text-xl font-bold">Device Linked!</p>
            </div>
          ) : (
            <div className="animate-pulse text-gray-400">Waiting for QR code...</div>
          )}
          {linked && <button onClick={handleNext} className="w-full bg-brand py-2 rounded font-bold mt-4">Continue</button>}
          {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}
        </div>
      )}

      {step === 4 && (
        <div className="text-center">
          <h2 className="text-3xl font-bold mb-4">All Set!</h2>
          <p className="text-gray-400 mb-8">Tars is configured and ready to go.</p>
          <button onClick={finalize} className="w-full bg-brand py-3 rounded-xl text-xl font-bold">Enter Dashboard</button>
        </div>
      )}
    </div>
  );
}
