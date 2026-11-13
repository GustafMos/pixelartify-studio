import React from 'react';
import { NODE_DEFS } from '../../core/graph';
import type { GraphNode } from '../../core/types';
import { useStudio } from '../store';
import { nodeCpuWarning } from '../bottlenecks';
import { Badge, EmptyState, IconButton, TextField } from './controls';
import { Icon } from './icons';
import { InputPanel } from './inspectors/InputPanel';
import { CropPanel, ResizePanel, ChannelsPanel } from './inspectors/GeometryPanels';
import { ColorPanel } from './inspectors/ColorPanel';
import { PixelatePanel } from './inspectors/PixelatePanel';
import { PalettePanel } from './inspectors/PalettePanel';
import { DitherPanel } from './inspectors/DitherPanel';
import { ExtractPanel, ComposePanel } from './inspectors/LayerPanels';
import { PreprocessPanel, PostprocessPanel } from './inspectors/EffectPanels';
import { OutputPanel } from './inspectors/OutputPanel';
import {
  AnimatePanel,
  BackgroundPanel,
  Object3DPanel,
  RetimePanel,
  TimelinePanel,
} from './inspectors/ScenePanels';
import {
  ConstantPanel,
  MathPanel,
  TextPanel,
  TransformPanel,
} from './inspectors/ValuePanels';
import { Shape2DPanel, ParticlesPanel } from './inspectors/ShapePanels';
import { ConnectionsPanel } from './ConnectionsPanel';

export function Inspector(): React.ReactElement {
  const {
    selectedNode,
    graph,
    updateNode,
    duplicateNode,
    deleteNode,
    selectNode,
    preview,
    previewError,
    isRendering,
    setPaletteStudioOpen,
  } = useStudio();

  if (!selectedNode) {
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <span className="inspector-kicker">Inspector</span>
        </div>
        <EmptyState icon="node" title="No node selected">
          Select a node in the graph or add one to start shaping your look.
        </EmptyState>
      </aside>
    );
  }

  const def = NODE_DEFS[selectedNode.type];
  const cpuWarning = nodeCpuWarning(selectedNode, graph);

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="inspector-title-row">
          <span className="node-icon" style={{ color: def.accent }}>
            <Icon name={nodeIcon(selectedNode.type)} size={16} />
          </span>
          <input
            className="inspector-title-input"
            value={selectedNode.title}
            onChange={(e) => updateNode(selectedNode.id, { title: e.target.value })}
            aria-label="Node title"
          />
          <IconButton
            icon="copy"
            label="Duplicate node"
            size={15}
            onClick={() => duplicateNode(selectedNode.id)}
          />
          <IconButton
            icon="trash"
            label="Delete node"
            size={15}
            danger
            onClick={() => {
              deleteNode(selectedNode.id);
              const next = graph.nodes.find((n) => n.id !== selectedNode.id);
              selectNode(next?.id ?? null);
            }}
          />
        </div>
        <div className="inspector-subrow">
          <Badge tone="accent">{def.title}</Badge>
          <span className="inspector-desc">{def.description}</span>
        </div>
      </div>

      {cpuWarning ? (
        <div className="cpu-warning" title={cpuWarning.detail}>
          <span className="node-warning">!</span>
          <span>
            <strong>{cpuWarning.title}.</strong> {cpuWarning.detail}
          </span>
        </div>
      ) : null}

      <div className="inspector-status">
        <span className="status-dot" />
        {isRendering ? 'Rendering preview…' : previewError ? <span className="error-text">{previewError}</span> : preview ? `${preview.size.width}×${preview.size.height} art · ${preview.stats.durationMs.toFixed(0)} ms` : 'Select media to preview'}
        <button type="button" className="text-btn" onClick={() => setPaletteStudioOpen(true)}>
          <Icon name="palette" size={13} /> Palette Studio
        </button>
      </div>

      <div className="inspector-scroll">
        <ConnectionsPanel node={selectedNode} />
        {renderPanel(selectedNode)}
      </div>
    </aside>
  );
}

function renderPanel(node: GraphNode): React.ReactElement {
  switch (node.type) {
    case 'input':
      return <InputPanel node={node} />;
    case 'crop':
      return <CropPanel node={node} />;
    case 'resize':
      return <ResizePanel node={node} />;
    case 'channels':
      return <ChannelsPanel node={node} />;
    case 'color':
      return <ColorPanel node={node} />;
    case 'pixelate':
      return <PixelatePanel node={node} />;
    case 'palette':
      return <PalettePanel node={node} />;
    case 'dither':
      return <DitherPanel node={node} />;
    case 'extract':
      return <ExtractPanel node={node} />;
    case 'compose':
      return <ComposePanel node={node} />;
    case 'background':
      return <BackgroundPanel node={node} />;
    case 'object3d':
      return <Object3DPanel node={node} />;
    case 'animate':
      return <AnimatePanel node={node} />;
    case 'timeline':
      return <TimelinePanel node={node} />;
    case 'retime':
      return <RetimePanel node={node} />;
    case 'group':
      return <GroupPanel node={node} />;
    case 'preprocess':
      return <PreprocessPanel node={node} />;
    case 'postprocess':
      return <PostprocessPanel node={node} />;
    case 'output':
      return <OutputPanel node={node} />;
    case 'merge':
      return <MergePanel node={node} />;
    case 'router':
      return <RouterPanel node={node} />;
    case 'constant':
      return <ConstantPanel node={node} />;
    case 'math':
      return <MathPanel node={node} />;
    case 'text':
      return <TextPanel node={node} />;
    case 'transform':
      return <TransformPanel node={node} />;
    case 'switcher':
      return <SwitcherPanel node={node} />;
    case 'shape2d':
      return <Shape2DPanel node={node} />;
    case 'particles':
      return <ParticlesPanel node={node} />;
    default:
      return <div />;
  }
}

function GroupPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { graph, duplicateGroup, ungroup, setGroupExpanded, updateNode, saveGroupAsSubgraph } = useStudio();
  const ids = Array.isArray(node.params.nodeIds) ? (node.params.nodeIds as string[]) : [];
  const members = graph.nodes.filter((n) => ids.includes(n.id) && n.type !== 'group');
  const expanded = node.params.expanded !== false;
  return (
    <div className="inspector-panel">
      <div className="stat-strip">
        <div>
          <span>Members</span>
          <strong>{members.length}</strong>
        </div>
        <div>
          <span>View</span>
          <strong>{expanded ? 'expanded' : 'collapsed'}</strong>
        </div>
      </div>
      <TextField
        label="Group name"
        value={node.title}
        onChange={(title) => updateNode(node.id, { title })}
      />
      <div className="btn-column">
        <button type="button" className="ghost-btn small" onClick={() => setGroupExpanded(node.id, !expanded)}>
          <Icon name={expanded ? 'minus' : 'plus'} size={14} /> {expanded ? 'Collapse group' : 'Expand group'}
        </button>
        <button type="button" className="ghost-btn small" onClick={() => duplicateGroup(node.id)}>
          <Icon name="copy" size={14} /> Duplicate whole group
        </button>
        <button type="button" className="ghost-btn small" onClick={() => saveGroupAsSubgraph(node.id, node.title)}>
          <Icon name="save" size={14} /> Save as subgraph
        </button>
        <button type="button" className="ghost-btn small danger" onClick={() => ungroup(node.id)}>
          <Icon name="close" size={14} /> Ungroup
        </button>
      </div>
      <div className="info-callout">
        <Icon name="layers" size={16} />
        <span>
          A group is an organisational box. Its members keep their normal wires and still evaluate
          independently. Collapse it to a single box with combined input and output dots, or
          duplicate it to clone every member node and internal wire at once. Rename it above and
          save it as a reusable subgraph.
        </span>
      </div>
      {members.length === 0 ? <p className="micro-copy">This group no longer has members.</p> : null}
    </div>
  );
}

function MergePanel({ node }: { node: GraphNode }): React.ReactElement {
  const { graph } = useStudio();
  const inputs = graph.edges.filter((e) => e.toNode === node.id);
  return (
    <div className="inspector-panel">
      <div className="stat-strip">
        <div>
          <span>Connected inputs</span>
          <strong>{inputs.length}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>concatenate</strong>
        </div>
      </div>
      <div className="info-callout">
        <Icon name="link" size={16} />
        <span>
          Merge combines media bundles into one batch. Each asset is still processed independently, so a folder
          of 480p images and a folder of 1080p images can share one output with consistent art scale.
        </span>
      </div>
      <div className="edge-list">
        {inputs.map((e) => {
          const from = graph.nodes.find((n) => n.id === e.fromNode);
          return (
            <div key={e.id} className="edge-row">
              <Icon name="link" size={13} />
              <span>{from?.title ?? e.fromNode}</span>
            </div>
          );
        })}
        {inputs.length === 0 ? <p className="micro-copy">Connect two or more Media inputs.</p> : null}
      </div>
    </div>
  );
}

function SwitcherPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { graph, updateNodeParams } = useStudio();
  const inputs = graph.edges.filter((e) => e.toNode === node.id && e.toPort === 'media');
  const active = Math.max(0, Math.min(inputs.length - 1, Number(node.params.activeIndex ?? 0) || 0));
  return (
    <div className="inspector-panel">
      <div className="stat-strip">
        <div>
          <span>Connected inputs</span>
          <strong>{inputs.length}</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>#{active + 1}</strong>
        </div>
      </div>
      <div className="btn-column">
        {inputs.map((edge, i) => {
          const from = graph.nodes.find((n) => n.id === edge.fromNode);
          return (
            <button
              key={edge.id}
              type="button"
              className={`ghost-btn small ${i === active ? 'is-active' : ''}`}
              onClick={() => updateNodeParams(node.id, { activeIndex: i })}
            >
              <Icon name="link" size={13} /> {i + 1}. {from?.title ?? edge.fromNode}
            </button>
          );
        })}
      </div>
      {inputs.length === 0 ? (
        <p className="micro-copy">Connect two or more media branches to switch between them.</p>
      ) : null}
    </div>
  );
}

function RouterPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { graph } = useStudio();
  const inputs = graph.edges.filter((e) => e.toNode === node.id);
  const outputs = graph.edges.filter((e) => e.fromNode === node.id);
  const byType = (type: string): [number, number] => [
    inputs.filter((e) => e.toPort === type).length,
    outputs.filter((e) => e.fromPort === type).length,
  ];
  return (
    <div className="inspector-panel">
      <div className="stat-strip">
        <div>
          <span>Media</span>
          <strong>
            {byType('media')[0]} in → {byType('media')[1]} out
          </strong>
        </div>
        <div>
          <span>Masks</span>
          <strong>
            {byType('mask')[0]} in → {byType('mask')[1]} out
          </strong>
        </div>
        <div>
          <span>Palettes</span>
          <strong>
            {byType('palette')[0]} in → {byType('palette')[1]} out
          </strong>
        </div>
      </div>
      <div className="info-callout">
        <Icon name="link" size={16} />
        <span>
          Router does nothing to the image. It only forwards media, masks and palettes. Use it to keep a
          branch alive while you replace, bypass or delete a node.
        </span>
      </div>
      {inputs.length === 0 || outputs.length === 0 ? (
        <p className="micro-copy">
          Connect an upstream output to its matching input, then connect the router output to the rest of
          the tree.
        </p>
      ) : null}
    </div>
  );
}

function nodeIcon(type: GraphNode['type']): Parameters<typeof Icon>[0]['name'] {
  const map: Record<GraphNode['type'], Parameters<typeof Icon>[0]['name']> = {
    input: 'image',
    crop: 'fit',
    resize: 'zoomIn',
    channels: 'layers',
    color: 'sliders',
    preprocess: 'wand',
    pixelate: 'grid',
    palette: 'palette',
    dither: 'sparkles',
    extract: 'eye',
    compose: 'layers',
    background: 'background',
    object3d: 'cube',
    animate: 'wave',
    timeline: 'clock',
    retime: 'gauge',
    group: 'layers',
    postprocess: 'settings',
    merge: 'link',
    router: 'link',
    constant: 'hash',
    math: 'func',
    text: 'text',
    transform: 'move',
    switcher: 'link',
    shape2d: 'shape',
    particles: 'sparkles',
    output: 'download',
  };
  return map[type];
}
