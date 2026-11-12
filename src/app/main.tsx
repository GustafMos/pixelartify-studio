import React from 'react';
import { createRoot } from 'react-dom/client';
import { StudioProvider } from './store';
import { App } from './App';
import { setGlobalPixelator, setGlobalDitherFinisher } from '../core/pipeline';
import { gpuPixelate } from './gpuPixelate';
import { gpuDither } from './gpuFinish';
import './styles.css';

// Use the WebGL2 sampler and dither finisher when available; both fall back to
// the CPU implementation automatically inside the pipeline.
setGlobalPixelator(gpuPixelate);
setGlobalDitherFinisher(gpuDither);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="fatal-error">
          <h1>PixelArtify Studio hit an error</h1>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing.');
createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StudioProvider>
        <App />
      </StudioProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
