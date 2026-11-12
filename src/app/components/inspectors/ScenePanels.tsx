import React from 'react';
import type { GraphNode } from '../../../core/types';
import {
  BACKGROUND_MODES,
  DEFAULT_BACKGROUND,
  type BackgroundParams,
} from '../../../core/background';
import {
  DEFAULT_OBJECT3D,
  PRIMITIVES_3D,
  type Render3DParams,
} from '../../../core/render3d';
import { useStudio } from '../../store';
import { Icon } from '../icons';
import {
  Badge,
  ColorField,
  Section,
  SelectField,
  Slider,
  Toggle,
} from '../controls';

function useHasMediaInput(node: GraphNode): boolean {
  const { graph } = useStudio();
  return graph.edges.some((edge) => edge.toNode === node.id && edge.toPort === 'media');
}

export function BackgroundPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const connected = useHasMediaInput(node);
  const p: BackgroundParams = { ...DEFAULT_BACKGROUND, ...(node.params as Partial<BackgroundParams>) };
  const set = (patch: Partial<BackgroundParams>): void => updateNodeParams(node.id, patch);
  const pattern = p.mode === 'checker' || p.mode === 'stripes' || p.mode === 'grid' || p.mode === 'dots';
  const twoColour = p.mode !== 'solid' && p.mode !== 'transparent';

  return (
    <div className="inspector-panel">
      <Section
        title="Background"
        subtitle={connected ? 'Generated behind the connected media.' : 'Standalone generated image.'}
      >
        <SelectField
          label="Type"
          value={p.mode}
          options={BACKGROUND_MODES}
          onChange={(mode) => set({ mode })}
        />
        {p.mode !== 'transparent' ? (
          <ColorField
            label={twoColour ? 'Colour A' : 'Colour'}
            value={p.colorA}
            onChange={(colorA) => set({ colorA })}
          />
        ) : null}
        {twoColour ? (
          <ColorField label="Colour B" value={p.colorB} onChange={(colorB) => set({ colorB })} />
        ) : null}
        {p.mode === 'linear' ? (
          <Slider
            label="Angle"
            value={p.angle}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(angle) => set({ angle })}
          />
        ) : null}
        {p.mode === 'radial' ? (
          <>
            <Slider
              label="Centre X"
              value={p.offsetX}
              min={-1}
              max={1}
              step={0.01}
              onChange={(offsetX) => set({ offsetX })}
            />
            <Slider
              label="Centre Y"
              value={p.offsetY}
              min={-1}
              max={1}
              step={0.01}
              onChange={(offsetY) => set({ offsetY })}
            />
          </>
        ) : null}
        {pattern ? (
          <Slider
            label="Cell size"
            value={p.scale}
            min={2}
            max={256}
            step={1}
            unit="px"
            hint="Pattern cell size in source pixels."
            onChange={(scale) => set({ scale })}
          />
        ) : null}
        {p.mode === 'stripes' ? (
          <Slider
            label="Angle"
            value={p.angle}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(angle) => set({ angle })}
          />
        ) : null}
        {p.mode === 'grid' ? (
          <>
            <Slider
              label="Line width"
              value={p.lineWidth}
              min={1}
              max={32}
              step={1}
              unit="px"
              onChange={(lineWidth) => set({ lineWidth })}
            />
            <Slider
              label="Angle"
              value={p.angle}
              min={-180}
              max={180}
              step={1}
              unit="°"
              onChange={(angle) => set({ angle })}
            />
          </>
        ) : null}
        {p.mode === 'dots' ? (
          <Slider
            label="Dot radius"
            value={p.dotRadius}
            min={0.05}
            max={0.95}
            step={0.01}
            onChange={(dotRadius) => set({ dotRadius })}
          />
        ) : null}
        {p.mode === 'noise' ? (
          <Slider
            label="Contrast"
            value={p.noise}
            min={0}
            max={1}
            step={0.01}
            onChange={(noise) => set({ noise })}
          />
        ) : null}
        {!connected ? (
          <div className="two-col">
            <Slider
              label="Width"
              value={p.width}
              min={16}
              max={2048}
              step={1}
              unit="px"
              onChange={(width) => set({ width })}
            />
            <Slider
              label="Height"
              value={p.height}
              min={16}
              max={2048}
              step={1}
              unit="px"
              onChange={(height) => set({ height })}
            />
          </div>
        ) : null}
        <button
          type="button"
          className="ghost-btn small"
          onClick={() => set({ ...DEFAULT_BACKGROUND })}
        >
          <Icon name="refresh" size={14} /> Reset background
        </button>
      </Section>
      <div className="info-callout">
        <Icon name="background" size={16} />
        <span>
          {connected
            ? 'The background matches the connected media size and is applied behind it. Transparent areas of the source show the generated background.'
            : 'Connect a Media input to place this behind an image or video, or leave it standalone and pipe it into Pixelate, Palette and Dither.'}
        </span>
      </div>
    </div>
  );
}

export function Object3DPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const connected = useHasMediaInput(node);
  const p: Render3DParams = { ...DEFAULT_OBJECT3D, ...(node.params as Partial<Render3DParams>) };
  const set = (patch: Partial<Render3DParams>): void => updateNodeParams(node.id, patch);

  return (
    <div className="inspector-panel">
      <Section
        title="Primitive"
        subtitle="Orthographic camera with z-buffered Lambert shading."
      >
        <SelectField
          label="Shape"
          value={p.primitive}
          options={PRIMITIVES_3D}
          onChange={(primitive) => set({ primitive })}
        />
        <ColorField label="Object colour" value={p.color} onChange={(color) => set({ color })} />
        {!connected ? (
          <>
            <SelectField
              label="Background"
              value={p.background}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'solid', label: 'Solid colour' },
              ]}
              onChange={(background) => set({ background })}
            />
            {p.background === 'solid' ? (
              <ColorField
                label="Backdrop"
                value={p.backgroundColor}
                onChange={(backgroundColor) => set({ backgroundColor })}
              />
            ) : null}
            <div className="two-col">
              <Slider
                label="Width"
                value={p.width}
                min={16}
                max={2048}
                step={1}
                unit="px"
                onChange={(width) => set({ width })}
              />
              <Slider
                label="Height"
                value={p.height}
                min={16}
                max={2048}
                step={1}
                unit="px"
                onChange={(height) => set({ height })}
              />
            </div>
          </>
        ) : (
          <Badge tone="accent">Composited over input</Badge>
        )}
      </Section>

      <Section title="Pose" subtitle="Euler rotation in degrees and position in view units.">
        <Slider
          label="Rotate X"
          value={p.rotationX}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(rotationX) => set({ rotationX })}
        />
        <Slider
          label="Rotate Y"
          value={p.rotationY}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(rotationY) => set({ rotationY })}
        />
        <Slider
          label="Rotate Z"
          value={p.rotationZ}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(rotationZ) => set({ rotationZ })}
        />
        <div className="two-col">
          <Slider
            label="Move X"
            value={p.positionX}
            min={-1.5}
            max={1.5}
            step={0.01}
            onChange={(positionX) => set({ positionX })}
          />
          <Slider
            label="Move Y"
            value={p.positionY}
            min={-1.5}
            max={1.5}
            step={0.01}
            hint="Move the object up or down in the frame."
            onChange={(positionY) => set({ positionY })}
          />
        </div>
        <div className="two-col">
          <Slider
            label="Move Z"
            value={p.positionZ}
            min={-1.5}
            max={1.5}
            step={0.01}
            onChange={(positionZ) => set({ positionZ })}
          />
          <Slider
            label="Scale"
            value={p.scale}
            min={0.2}
            max={2.5}
            step={0.01}
            onChange={(scale) => set({ scale })}
          />
        </div>
        <button
          type="button"
          className="ghost-btn small"
          onClick={() =>
            set({ rotationX: -18, rotationY: 32, rotationZ: 0, positionX: 0, positionY: 0, positionZ: 0, scale: 1 })
          }
        >
          <Icon name="refresh" size={14} /> Reset pose
        </button>
      </Section>

      <Section title="Camera & light">
        <Slider
          label="Zoom"
          value={p.zoom}
          min={0.3}
          max={3}
          step={0.01}
          onChange={(zoom) => set({ zoom })}
        />
        <Slider
          label="Shading"
          value={p.shading}
          min={0}
          max={1}
          step={0.01}
          hint="0 is flat and unlit; 1 is fully shaded."
          onChange={(shading) => set({ shading })}
        />
        <Slider
          label="Ambient"
          value={p.ambient}
          min={0}
          max={1}
          step={0.01}
          onChange={(ambient) => set({ ambient })}
        />
        <Slider
          label="Light angle"
          value={p.lightAngle}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(lightAngle) => set({ lightAngle })}
        />
        <Toggle
          label="Anti-alias"
          checked={p.antiAlias > 0.5}
          hint="Render at 2× and downsample for smooth edges. Disable for crisp pixel edges."
          onChange={(on) => set({ antiAlias: on ? 1 : 0 })}
        />
      </Section>

      <div className="info-callout">
        <Icon name="cube" size={16} />
        <span>
          {connected
            ? 'The object is rendered with a transparent background and composited on top of the connected media. Use a Background node before this one for a backdrop.'
            : 'Standalone output. Connect this to Pixelate or Dither to turn the render into pixel art, or connect media to use the object as an overlay.'}
        </span>
      </div>
    </div>
  );
}
