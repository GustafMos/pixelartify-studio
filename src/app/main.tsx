import React from 'react';
import { createRoot } from 'react-dom/client';
import { StudioProvider } from './store';
import { App } from './App';
import { PopupViewer } from './PopupViewer';
import { registerBuiltinPlugins } from './components/inspectors/PluginPanel';
import { setGlobalPixelator, setGlobalDitherFinisher, setGlobalLayerCompositor } from '../core/pipeline';
import { setGlobalResizer } from '../core/image';
import { setGlobalEffectAccelerator } from '../core/preprocess';
import { gpuPixelate } from './gpuPixelate';
import { gpuDither } from './gpuFinish';
import { gpuResize } from './gpuResize';
import { applyGpuEffects } from './gpuEffects';
import { gpuCompositeLayers } from './gpuLayers';
import './styles.css';

// Use the WebGL2 backends when available; all fall back to the CPU path
// automatically inside the pipeline.
setGlobalPixelator(gpuPixelate);
setGlobalDitherFinisher(gpuDither);
setGlobalResizer(gpuResize);
setGlobalEffectAccelerator(applyGpuEffects);
setGlobalLayerCompositor(gpuCompositeLayers);
registerBuiltinPlugins();

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
          <h1>RipScorpy Media Processing Suite hit an error</h1>
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

const isViewer = new URLSearchParams(window.location.search).has('viewer');

createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isViewer ? (
        <PopupViewer />
      ) : (
        <StudioProvider>
          <App />
        </StudioProvider>
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
