import { ComponentChildren } from 'preact';

interface ModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  type?: 'info' | 'danger' | 'success';
}

export function Modal({ 
  isOpen, 
  title, 
  message, 
  confirmLabel = 'OK', 
  cancelLabel, 
  onConfirm, 
  onCancel,
  type = 'info'
}: ModalProps) {
  if (!isOpen) return null;

  const typeColors = {
    info: 'bg-brand text-white hover:bg-brand/90',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    success: 'bg-green-600 text-white hover:bg-green-700'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6">
          <h3 className="text-xl font-bold mb-2">{title}</h3>
          <p className="text-gray-400 text-sm leading-relaxed">{message}</p>
        </div>
        <div className="px-6 py-4 bg-gray-800/50 flex justify-end gap-3">
          {cancelLabel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 ${typeColors[type]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
