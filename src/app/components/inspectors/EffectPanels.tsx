import React from 'react';
import type { GraphNode, PostprocessOp, PostprocessSettings, PreprocessOp } from '../../../core/types';
import { DEFAULT_POSTPROCESS } from '../../../core';
import { useStudio } from '../../store';
import { Section, Toggle } from '../controls';
import { EffectsEditor } from '../EffectsEditor';

export function PreprocessPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const ops = (node.params.ops as PreprocessOp[] | undefined) ?? [];
  return (
    <div className="inspector-panel">
      <Section title="Pre-processing stack" subtitle="Applied at the canonical working resolution before pixelation.">
        <EffectsEditor
          stage="pre"
          ops={ops}
          onChange={(next) => updateNodeParams(node.id, { ops: next })}
        />
      </Section>
      <div className="info-callout">
        <span>
          Effects are resolution-relative: brush radii and feature sizes are measured in <strong>art pixels</strong>,
          so a 480p and a 1080p source get the same painterly scale.
        </span>
      </div>
    </div>
  );
}

export function PostprocessPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const post = (node.params.postprocess as PostprocessSettings | undefined) ?? { ...DEFAULT_POSTPROCESS };
  const ops = post.ops as PostprocessOp[];
  return (
    <div className="inspector-panel">
      <Section title="Post-processing stack" subtitle="Applied to the finished pixel art at art resolution.">
        <EffectsEditor
          stage="post"
          ops={ops}
          onChange={(next) => updateNodeParams(node.id, { postprocess: { ...post, ops: next } })}
        />
        <Toggle
          label="Re-snap to palette after effects"
          checked={post.lockPalette}
          onChange={(v) => updateNodeParams(node.id, { postprocess: { ...post, lockPalette: v } })}
          hint="Keeps bloom, grain and outlines inside the chosen palette."
        />
      </Section>
      <div className="info-callout">
        <span>
          Post effects run after dithering. The <strong>Sprite outline</strong> effect is the fastest way to
          make a cutout read cleanly against game backgrounds.
        </span>
      </div>
    </div>
  );
}
