import React, { useRef, useState } from 'react';
import type { GraphNode } from '../../../core/types';
import { listPluginNodes, getPluginNode, registerPluginNode, pluginDefaults, type PluginNodeDef } from '../../../core/plugins';
import { useStudio } from '../../store';
import { Icon } from '../icons';
import { Field } from '../Field';
import { Section, SelectField } from '../controls';

export function PluginPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams, notify } = useStudio();
  const [version, setVersion] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);
  const plugins = listPluginNodes();
  const pluginId = String(node.params.pluginId ?? '');
  const plugin = getPluginNode(pluginId);

  const selectPlugin = (id: string): void => {
    const def = getPluginNode(id);
    updateNodeParams(node.id, { pluginId: id, params: def ? pluginDefaults(def) : {} });
  };

  const importPlugin = async (file: File): Promise<void> => {
    try {
      const url = URL.createObjectURL(new Blob([await file.text()], { type: 'text/javascript' }));
      try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: PluginNodeDef };
        const def = mod.default;
        if (!def || typeof def.apply !== 'function' || !def.id) {
          throw new Error('Plugin must default-export { id, name, description, params, apply }.');
        }
        registerPluginNode(def);
        setVersion((v) => v + 1);
        if (!pluginId) selectPlugin(def.id);
        notify(`Plugin “${def.name}” loaded.`, 'success');
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      notify(`Plugin import failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  return (
    <div className="inspector-panel">
      <Section title="Plugin" subtitle="A user-defined node loaded from a plugin file.">
        <SelectField
          label="Plugin"
          value={pluginId}
          options={[
            { value: '', label: 'Select a plugin…' },
            ...plugins.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={selectPlugin}
        />
        <div className="two-col">
          <button type="button" className="ghost-btn small" onClick={() => importRef.current?.click()}>
            <Icon name="upload" size={14} /> Import plugin
          </button>
          {plugin ? <span className="micro-copy">{plugins.length} plugin{plugins.length === 1 ? '' : 's'} loaded</span> : null}
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".js,.mjs"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importPlugin(file);
          }}
        />
        {plugin ? (
          <>
            <p className="micro-copy">{plugin.description}</p>
            {plugin.params.map((p) => (
              <Field
                key={p.key}
                node={node}
                path={`params.${p.key}`}
                label={p.label}
                min={p.min}
                max={p.max}
                step={p.step}
                unit={p.unit}
                defaultValue={p.default}
              />
            ))}
          </>
        ) : (
          <div className="info-callout">
            <Icon name="sparkles" size={16} />
            <span>
              Import a <code>.js</code> file that default-exports{' '}
              <code>{'{ id, name, description, params, apply(image, params) }'}</code>. The{' '}
              <code>apply</code> function receives{' '}
              <code>{'{ width, height, data }'}</code> and returns a new image of the same shape.
            </span>
          </div>
        )}
      </Section>
    </div>
  );
}

export function registerBuiltinPlugins(): void {
  // Star Detect — isolate bright stars/objects (threshold + connected components).
  registerPluginNode({
    id: 'stardetect',
    name: 'Star Detect',
    description: 'Isolate bright stars/objects by luminance threshold; small specks are removed.',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'minSize', label: 'Min size', min: 1, max: 64, step: 1, default: 2 },
      { key: 'keepColor', label: 'Keep colour', min: 0, max: 1, step: 1, default: 1 },
    ],
    apply(image, params) {
      const { width, height, data } = image;
      const threshold = params.threshold ?? 0.5;
      const minSize = Math.max(1, Math.round(params.minSize ?? 2));
      const keepColor = (params.keepColor ?? 1) > 0.5;
      const out = new Uint8ClampedArray(data.length);

      // Mark bright pixels.
      const bright = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const l = (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255;
        bright[i] = l >= threshold ? 1 : 0;
      }

      // Connected components (4-connectivity) to drop tiny specks.
      const label = new Int32Array(width * height).fill(-1);
      let nextLabel = 0;
      const sizes: number[] = [];
      const stack: number[] = [];
      for (let i = 0; i < width * height; i++) {
        if (bright[i] !== 1 || label[i] !== -1) continue;
        const lab = nextLabel++;
        let size = 0;
        label[i] = lab;
        stack.push(i);
        while (stack.length > 0) {
          const idx = stack.pop()!;
          size++;
          const x = idx % width;
          const y = (idx / width) | 0;
          const neighbors = [
            y > 0 ? idx - width : -1,
            y < height - 1 ? idx + width : -1,
            x > 0 ? idx - 1 : -1,
            x < width - 1 ? idx + 1 : -1,
          ];
          for (const n of neighbors) {
            if (n >= 0 && bright[n] === 1 && label[n] === -1) {
              label[n] = lab;
              stack.push(n);
            }
          }
        }
        sizes[lab] = size;
      }

      for (let i = 0; i < width * height; i++) {
        const src = i * 4;
        const lab = label[i];
        const keep = lab >= 0 && sizes[lab] >= minSize;
        if (keep) {
          if (keepColor) {
            out[src] = data[src];
            out[src + 1] = data[src + 1];
            out[src + 2] = data[src + 2];
          } else {
            out[src] = 255;
            out[src + 1] = 255;
            out[src + 2] = 255;
          }
          out[src + 3] = 255;
        }
      }
      return { width, height, data: out };
    },
  });
}
