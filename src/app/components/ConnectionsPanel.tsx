import React from 'react';
import type { GraphNode } from '../../core/types';
import { NODE_DEFS, type SocketType } from '../../core/graph';
import { useStudio } from '../store';
import { Badge, IconButton, Section } from './controls';
import { Icon } from './icons';

const TYPE_LABEL: Record<SocketType, string> = {
  media: 'media',
  mask: 'mask',
  palette: 'palette',
  motion: 'motion',
};

const TYPE_TONE: Record<SocketType, 'accent' | 'success' | 'warn'> = {
  media: 'accent',
  mask: 'success',
  palette: 'warn',
  motion: 'accent',
};

export function ConnectionsPanel({ node }: { node: GraphNode }): React.ReactElement | null {
  const { graph, addEdge, deleteEdge } = useStudio();
  const def = NODE_DEFS[node.type];
  if (def.inputs.length === 0 && def.outputs.length === 0) return null;

  const nodeTitle = (id: string): string =>
    graph.nodes.find((n) => n.id === id)?.title ?? 'Missing node';

  const availableSources = (type: SocketType): Array<{ node: GraphNode; portId: string; portLabel: string }> => {
    const out: Array<{ node: GraphNode; portId: string; portLabel: string }> = [];
    for (const n of graph.nodes) {
      if (n.id === node.id) continue;
      for (const port of NODE_DEFS[n.type].outputs) {
        if (port.type === type) out.push({ node: n, portId: port.id, portLabel: port.label });
      }
    }
    return out.sort((a, b) => a.node.title.localeCompare(b.node.title));
  };

  return (
    <Section title="Connections" defaultOpen>
      <div className="connections-panel">
        {def.inputs.length > 0 ? (
          <div className="connection-group">
            <span className="connection-group-title">Inputs</span>
            {def.inputs.map((port) => {
              const edges = graph.edges.filter((e) => e.toNode === node.id && e.toPort === port.id);
              const sources = availableSources(port.type);
              return (
                <div key={port.id} className="connection-port">
                  <div className="connection-port-head">
                    <span className={`connection-dot port-${port.type}`} />
                    <span>{port.label}</span>
                    <Badge tone={TYPE_TONE[port.type]}>{TYPE_LABEL[port.type]}</Badge>
                    {port.multiple ? <em>multi</em> : null}
                  </div>
                  {edges.map((edge) => (
                    <div key={edge.id} className="connection-row">
                      <Icon name="link" size={12} />
                      <span className="connection-source">
                        {nodeTitle(edge.fromNode)}
                        <em>
                          {NODE_DEFS[graph.nodes.find((n) => n.id === edge.fromNode)?.type ?? 'input'].outputs.find(
                            (p) => p.id === edge.fromPort,
                          )?.label ?? edge.fromPort}
                        </em>
                      </span>
                      <IconButton
                        icon="close"
                        label="Disconnect"
                        size={13}
                        danger
                        onClick={() => deleteEdge(edge.id)}
                      />
                    </div>
                  ))}
                  {(edges.length === 0 || port.multiple) && sources.length > 0 ? (
                    <select
                      className="connection-add-select"
                      value=""
                      onChange={(e) => {
                        const [sourceNode, sourcePort] = e.target.value.split('::');
                        if (sourceNode && sourcePort) addEdge(sourceNode, sourcePort, node.id, port.id);
                      }}
                      aria-label={`Connect ${port.label}`}
                    >
                      <option value="">
                        {edges.length === 0 ? 'Connect input…' : 'Add another input…'}
                      </option>
                      {sources.map((s) => (
                        <option key={`${s.node.id}::${s.portId}`} value={`${s.node.id}::${s.portId}`}>
                          {s.node.title} › {s.portLabel}
                        </option>
                      ))}
                    </select>
                  ) : edges.length === 0 ? (
                    <p className="micro-copy">No compatible {TYPE_LABEL[port.type]} outputs in the graph.</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {def.outputs.length > 0 ? (
          <div className="connection-group">
            <span className="connection-group-title">Outputs</span>
            {def.outputs.map((port) => {
              const edges = graph.edges.filter((e) => e.fromNode === node.id && e.fromPort === port.id);
              return (
                <div key={port.id} className="connection-port">
                  <div className="connection-port-head">
                    <span className={`connection-dot port-${port.type}`} />
                    <span>{port.label}</span>
                    <Badge tone={TYPE_TONE[port.type]}>{TYPE_LABEL[port.type]}</Badge>
                  </div>
                  {edges.map((edge) => (
                    <div key={edge.id} className="connection-row">
                      <Icon name="link" size={12} />
                      <span className="connection-source">
                        {nodeTitle(edge.toNode)}
                        <em>
                          {NODE_DEFS[graph.nodes.find((n) => n.id === edge.toNode)?.type ?? 'output'].inputs.find(
                            (p) => p.id === edge.toPort,
                          )?.label ?? edge.toPort}
                        </em>
                      </span>
                      <IconButton
                        icon="close"
                        label="Disconnect"
                        size={13}
                        danger
                        onClick={() => deleteEdge(edge.id)}
                      />
                    </div>
                  ))}
                  {edges.length === 0 ? <p className="micro-copy">Not connected.</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
