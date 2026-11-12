import React, { useRef } from 'react';
import { useStudio } from '../store';
import { Icon } from './icons';
import { Badge, IconButton } from './controls';
import { readFilesFromDataTransfer } from '../io';
import { NODE_DEFS } from '../../core/graph';

export function AssetRail(): React.ReactElement {
  const {
    graph,
    assetsByNode,
    activeAsset,
    setActiveAsset,
    selectedNodeId,
    selectNode,
    setSelectedOutput,
    selectedOutputId,
    setMode,
    preview,
    addAssets,
    notify,
  } = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const inputs = graph.nodes.filter((n) => n.type === 'input');
  const outputs = graph.nodes.filter((n) => n.type === 'output');
  const selectedInput = graph.nodes.find((n) => n.type === 'input' && n.id === selectedNodeId) ?? inputs[0];
  const targetInput = selectedInput ?? inputs[0];

  return (
    <aside className="asset-rail">
      <div className="rail-section rail-project">
        <span className="rail-kicker">Project</span>
        <div className="rail-title">PixelArtify Studio</div>
        <div className="rail-subtitle">
          {graph.nodes.length} nodes · {graph.edges.length} links
        </div>
      </div>

      <div className="rail-section">
        <div className="rail-heading">
          <span>Inputs</span>
          <button type="button" className="text-btn" onClick={() => setMode('graph')}>
            <Icon name="graph" size={12} /> edit
          </button>
        </div>
        {inputs.length === 0 ? <p className="rail-empty">Add a Media input node.</p> : null}
        {inputs.map((node) => {
          const assets = assetsByNode[node.id] ?? [];
          return (
            <button
              key={node.id}
              type="button"
              className={`rail-input ${selectedNodeId === node.id ? 'is-active' : ''}`}
              onClick={() => {
                selectNode(node.id);
                if (assets[0]) setActiveAsset(assets[0].id);
              }}
            >
              <span className="rail-input-icon">
                <Icon name="folder" size={16} />
              </span>
              <span className="rail-input-copy">
                <strong>{String(node.params.label ?? node.title)}</strong>
                <small>{assets.length} asset{assets.length === 1 ? '' : 's'}</small>
              </span>
              <Badge>{assets.length}</Badge>
            </button>
          );
        })}
        <div className="rail-drop" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => {
          e.preventDefault();
          if (!targetInput) {
            notify('Add a Media input node first.', 'warn');
            return;
          }
          const files = e.dataTransfer.items?.length
            ? await readFilesFromDataTransfer(e.dataTransfer.items)
            : Array.from(e.dataTransfer.files);
          await addAssets(targetInput.id, files);
        }}>
          <Icon name="upload" size={14} />
          <span>Drop files here</span>
          <button type="button" className="text-btn" onClick={() => fileRef.current?.click()}>
            browse
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (!targetInput) {
              notify('Add a Media input node first.', 'warn');
              return;
            }
            await addAssets(targetInput.id, files);
          }}
        />
      </div>

      <div className="rail-section rail-assets">
        <div className="rail-heading">
          <span>Media</span>
          <span className="rail-count">{Object.values(assetsByNode).flat().length}</span>
        </div>
        <div className="rail-asset-grid">
          {Object.entries(assetsByNode).flatMap(([nodeId, assets]) =>
            assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className={`rail-thumb ${activeAsset?.id === asset.id ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveAsset(asset.id);
                  selectNode(nodeId);
                }}
                title={`${asset.name}\n${asset.width}×${asset.height}`}
              >
                <img src={asset.thumb} alt="" draggable={false} />
                {asset.kind === 'video' ? <span className="thumb-video"><Icon name="video" size={10} /></span> : null}
                <span className="thumb-name">{asset.name}</span>
              </button>
            )),
          )}
        </div>
        {Object.values(assetsByNode).flat().length === 0 ? (
          <div className="rail-empty-state">
            <Icon name="image" size={22} />
            <span>No media imported</span>
          </div>
        ) : null}
      </div>

      <div className="rail-section rail-outputs">
        <div className="rail-heading">
          <span>Outputs</span>
          <Badge>{outputs.length}</Badge>
        </div>
        {outputs.map((node) => {
          const output = node.params.output as { format?: string } | undefined;
          return (
            <button
              key={node.id}
              type="button"
              className={`rail-output ${selectedOutputId === node.id ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedOutput(node.id);
                setMode('studio');
              }}
            >
              <Icon name="download" size={15} />
              <span>{String(node.params.label ?? node.title)}</span>
              <em>{output?.format ?? 'png'}</em>
            </button>
          );
        })}
        {outputs.length === 0 ? <p className="rail-empty">No output node.</p> : null}
      </div>

      <div className="rail-spacer" />

      {preview ? (
        <div className="rail-section rail-stats">
          <div className="rail-stat">
            <span>Art</span>
            <strong>
              {preview.size.width}×{preview.size.height}
            </strong>
          </div>
          <div className="rail-stat">
            <span>Export</span>
            <strong>
              {preview.size.exportWidth}×{preview.size.exportHeight}
            </strong>
          </div>
          <div className="rail-stat">
            <span>Palette</span>
            <strong>{preview.palette.length || 'free'}</strong>
          </div>
          {preview.palette.length > 0 ? (
            <div className="rail-palette">
              {preview.palette.slice(0, 16).map((c, i) => (
                <i key={`${c}${i}`} style={{ background: c }} title={c} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rail-footer">
        <button type="button" className="ghost-btn small" onClick={() => setMode('graph')}>
          <Icon name="plus" size={14} /> Node graph
        </button>
        <span className="rail-version">v0.1.0 · MIT</span>
      </div>
    </aside>
  );
}
