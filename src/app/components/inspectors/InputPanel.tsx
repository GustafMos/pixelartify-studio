import React, { useRef, useState } from 'react';
import type { GraphNode } from '../../../core/types';
import { Icon } from '../icons';
import { IconButton, Badge, EmptyState, Section } from '../controls';
import { useStudio } from '../../store';
import { readFilesFromDataTransfer, humanBytes } from '../../io';

export function InputPanel({ node }: { node: GraphNode }): React.ReactElement {
  const {
    assetsByNode,
    activeAsset,
    addAssets,
    removeAsset,
    clearAssets,
    setActiveAsset,
    isImporting,
  } = useStudio();
  const assets = assetsByNode[node.id] ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    await addAssets(node.id, files);
  };

  return (
    <div className="inspector-panel">
      <div
        className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          const files = e.dataTransfer.items?.length
            ? await readFilesFromDataTransfer(e.dataTransfer.items)
            : Array.from(e.dataTransfer.files);
          await handleFiles(files);
        }}
      >
        <Icon name="upload" size={22} />
        <strong>Drop images or videos</strong>
        <span>or add a folder to build a batch</span>
        <div className="drop-actions">
          <button type="button" className="primary-btn small" onClick={() => fileRef.current?.click()} disabled={isImporting}>
            <Icon name="plus" size={14} /> Add files
          </button>
          <button type="button" className="ghost-btn small" onClick={() => dirRef.current?.click()} disabled={isImporting}>
            <Icon name="folder" size={14} /> Add folder
          </button>
        </div>
        {isImporting ? <span className="drop-progress">Decoding assets…</span> : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={(el) => {
          dirRef.current = el;
          if (el) {
            (el as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
          }
        }}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      <Section
        title={`Assets · ${assets.length}`}
        right={
          assets.length > 0 ? (
            <button type="button" className="text-btn danger" onClick={() => clearAssets(node.id)}>
              Clear
            </button>
          ) : null
        }
      >
        {assets.length === 0 ? (
          <EmptyState icon="image" title="No media yet">
            Add a folder or multiple files. Each asset runs through the same graph and resolution policy.
          </EmptyState>
        ) : (
          <div className="asset-list">
            {assets.map((asset) => {
              const active = activeAsset?.id === asset.id;
              return (
                <div
                  key={asset.id}
                  className={`asset-row ${active ? 'is-active' : ''}`}
                  onClick={() => setActiveAsset(asset.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setActiveAsset(asset.id)}
                >
                  <div className="asset-thumb">
                    <img src={asset.thumb} alt="" draggable={false} />
                    {asset.kind === 'video' ? (
                      <span className="asset-kind">
                        <Icon name="video" size={11} />
                      </span>
                    ) : null}
                  </div>
                  <div className="asset-meta">
                    <strong title={asset.name}>{asset.name}</strong>
                    <span>
                      {asset.width}×{asset.height}
                      {asset.kind === 'video' && asset.duration
                        ? ` · ${asset.duration.toFixed(1)}s · ${Math.round(asset.fps ?? 0)}fps`
                        : asset.file
                          ? ` · ${humanBytes(asset.file.size)}`
                          : ''}
                    </span>
                  </div>
                  <IconButton
                    icon="trash"
                    label="Remove asset"
                    danger
                    size={14}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAsset(node.id, asset.id);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {activeAsset ? (
        <Section title="Active media" defaultOpen={false}>
          <div className="kv-grid">
            <span>Name</span>
            <strong>{activeAsset.name}</strong>
            <span>Kind</span>
            <strong>
              <Badge tone={activeAsset.kind === 'video' ? 'accent' : 'neutral'}>{activeAsset.kind}</Badge>
            </strong>
            <span>Source size</span>
            <strong>
              {activeAsset.width}×{activeAsset.height}
            </strong>
            {activeAsset.kind === 'video' ? (
              <>
                <span>Duration</span>
                <strong>{activeAsset.duration?.toFixed(2)} s</strong>
                <span>Frame rate</span>
                <strong>{activeAsset.fps?.toFixed(2)} fps</strong>
                <span>Codec</span>
                <strong>{activeAsset.videoInfo?.codec ?? 'unknown'}</strong>
              </>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
