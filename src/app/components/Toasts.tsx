import React from 'react';
import { useStudio } from '../store';
import { Icon } from './icons';

export function Toasts(): React.ReactElement {
  const { toasts, dismissToast } = useStudio();
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">
            <Icon
              name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'close' : t.kind === 'warn' ? 'eye' : 'sparkles'}
              size={15}
            />
          </span>
          <span>{t.message}</span>
          <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
