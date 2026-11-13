import React, { useRef } from 'react';
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
import { parseMesh } from '../../../core/meshImport';
import {
  DEFAULT_MOTION,
  evaluateMotion,
  type MotionSettings,
} from '../../../core/motion';
import { useStudio } from '../../store';
import { Icon } from '../icons';
import {
  Badge,
  ColorField,
  NumberField,
  Section,
  SelectField,
  Slider,
  TextField,
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

const MOTION_PRESETS: Array<{ name: string; patch: Partial<MotionSettings> }> = [
  {
    name: 'Spin',
    patch: { rotationX: 'sin(t * 1.5) * 12', rotationY: 't * 60', rotationZ: '0' },
  },
  {
    name: 'Float',
    patch: { x: '0', y: 'sin(t * 1.6) * 0.18', rotationX: 'sin(t) * 10', rotationY: 't * 15' },
  },
  {
    name: 'Drift & wrap',
    patch: { x: 't * 0.5', y: 'sin(t * 2) * 0.06', wrap: 'horizontal', loop: false },
  },
  {
    name: 'Pulse',
    patch: { scale: '1 + sin(t * 3) * 0.12' },
  },
];

export function AnimatePanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams, animationTime } = useStudio();
  const p: MotionSettings = { ...DEFAULT_MOTION, ...(node.params as Partial<MotionSettings>) };
  const set = (patch: Partial<MotionSettings>): void => updateNodeParams(node.id, patch);
  const sample = evaluateMotion(p, animationTime);
  const frameCount = Math.max(1, Math.round(p.duration * p.fps));

  return (
    <div className="inspector-panel">
      <Section
        title="Continuous motion"
        subtitle="Connect Motion to a 3D object or Background. Formulas run every animation frame."
      >
        <div className="two-col">
          <NumberField
            label="Duration"
            value={p.duration}
            min={0.1}
            step={0.1}
            unit="s"
            hint="Timeline length. Used when Loop is enabled."
            onChange={(duration) => set({ duration })}
          />
          <NumberField
            label="Frame rate"
            value={p.fps}
            min={1}
            step={1}
            unit="fps"
            hint="Timeline preview and frame-based formulas."
            onChange={(fps) => set({ fps })}
          />
        </div>
        <Toggle
          label={`Loop (${frameCount} frames)`}
          checked={p.loop}
          hint="Restart at t = 0 after Duration. Leave off for continuous, ever-increasing motion."
          onChange={(loop) => set({ loop })}
        />
        <SelectField
          label="When it leaves the frame"
          value={p.wrap}
          options={[
            { value: 'horizontal', label: 'Wrap left/right' },
            { value: 'both', label: 'Wrap both axes' },
            { value: 'none', label: 'Leave the frame' },
          ]}
          onChange={(wrap) => set({ wrap })}
        />
        {p.wrap !== 'none' ? (
          <Slider
            label="Wrap width"
            value={p.wrapWidth}
            min={0.5}
            max={8}
            step={0.1}
            hint="Half-frame units. 2.0 wraps exactly at the left and right frame edges."
            onChange={(wrapWidth) => set({ wrapWidth })}
          />
        ) : null}
        <div className="motion-presets">
          {MOTION_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="ghost-btn small"
              onClick={() => set(preset.patch)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="motion-readout">
          t={sample.time.toFixed(2)}s · frame {Math.round(sample.frame)} · x {sample.x.toFixed(2)} ·
          y {sample.y.toFixed(2)} · rotY {sample.rotationY.toFixed(1)}°
        </div>
      </Section>

      <Section
        title="Formulas"
        subtitle="Variables: t, frame, lt, loopFrame, duration, fps, pi, tau. Functions: sin, cos, tan, abs, min, max, floor, ceil, round, sqrt, pow, clamp, lerp, step, smoothstep."
      >
        <TextField
          label="Translate X"
          value={p.x}
          hint="World units. Use t * 0.5 for a constant drift, or sin(t * 2) * 0.4 to oscillate."
          onChange={(x) => set({ x })}
        />
        <TextField
          label="Translate Y"
          value={p.y}
          hint="Positive values move up. Use sin(t * 1.5) * 0.2 to float."
          onChange={(y) => set({ y })}
        />
        <TextField
          label="Translate Z"
          value={p.z}
          hint="Depth offset for 3D objects."
          onChange={(z) => set({ z })}
        />
        <TextField
          label="Rotate X"
          value={p.rotationX}
          hint="Degrees. sin(t) * 15 gives a gentle tilt."
          onChange={(rotationX) => set({ rotationX })}
        />
        <TextField
          label="Rotate Y"
          value={p.rotationY}
          hint="Degrees. t * 60 spins once every six seconds."
          onChange={(rotationY) => set({ rotationY })}
        />
        <TextField
          label="Rotate Z"
          value={p.rotationZ}
          hint="Degrees. Also rotates Background patterns."
          onChange={(rotationZ) => set({ rotationZ })}
        />
        <TextField
          label="Scale"
          value={p.scale}
          hint="1 = original. 1 + sin(t * 3) * 0.12 pulses."
          onChange={(scale) => set({ scale })}
        />
      </Section>

      <div className="info-callout">
        <Icon name="wave" size={16} />
        <span>
          Enable <strong>Animate</strong> on Film grain or Noise displacement in the Pre-process or
          Post-process inspector to make the texture move too. The viewer timeline appears whenever
          this graph contains an Animate node.
        </span>
      </div>
    </div>
  );
}

export function TimelinePanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const p = node.params as { duration?: number; fps?: number; loop?: boolean };
  const duration = Math.max(0.1, Number(p.duration ?? 4));
  const fps = Math.max(1, Math.round(Number(p.fps ?? 24)));
  const frames = Math.max(1, Math.round(duration * fps));
  const set = (patch: Record<string, unknown>): void => updateNodeParams(node.id, patch);

  return (
    <div className="inspector-panel">
      <Section
        title="Timeline"
        subtitle="Stretch still media across time so effects, grain and overlays can animate over it."
      >
        <div className="two-col">
          <NumberField
            label="Duration"
            value={duration}
            min={0.1}
            step={0.1}
            unit="s"
            onChange={(value) => set({ duration: value })}
          />
          <NumberField
            label="Frame rate"
            value={fps}
            min={1}
            max={60}
            step={1}
            unit="fps"
            onChange={(value) => set({ fps: Math.round(value) })}
          />
        </div>
        <Toggle
          label={`Loop (${frames} frames)`}
          checked={p.loop !== false}
          hint="Loop the viewer timeline after Duration."
          onChange={(loop) => set({ loop })}
        />
        <p className="micro-copy">
          The image itself stays still; connect an Animate node to overlays or enable Animate on
          grain / noise displacement to create motion. Use Render animation in the Output inspector
          to export the sequence.
        </p>
      </Section>
      <div className="info-callout">
        <Icon name="clock" size={16} />
        <span>
          Chain this after a Media input and before Pixelate. Video inputs keep their own duration
          and are passed through unchanged.
        </span>
      </div>
    </div>
  );
}

export function RetimePanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams } = useStudio();
  const p = node.params as {
    mode?: string;
    sourceFps?: number;
    targetFps?: number;
    quality?: string;
  };
  const mode = p.mode === 'optical-flow' ? 'optical-flow' : 'stop-motion';
  const sourceFps = Math.max(1, Math.round(Number(p.sourceFps ?? 12)));
  const targetFps = Math.max(1, Math.round(Number(p.targetFps ?? 12)));
  const set = (patch: Record<string, unknown>): void => updateNodeParams(node.id, patch);

  return (
    <div className="inspector-panel">
      <Section
        title="Video retime"
        subtitle="Applied during video / spritesheet export and stop-motion preview."
      >
        <SelectField
          label="Mode"
          value={mode}
          options={[
            { value: 'stop-motion', label: 'Stop motion (lower fps)' },
            { value: 'optical-flow', label: 'Optical flow (interpolate)' },
          ]}
          onChange={(value) => set({ mode: value })}
        />
        {mode === 'stop-motion' ? (
          <NumberField
            label="Output frame rate"
            value={targetFps}
            min={1}
            max={60}
            step={1}
            unit="fps"
            hint="Samples the source at this rate and exports a choppy sequence. Try 12 fps."
            onChange={(value) => set({ targetFps: Math.round(value) })}
          />
        ) : (
          <>
            <div className="two-col">
              <NumberField
                label="Source rate"
                value={sourceFps}
                min={1}
                max={60}
                step={1}
                unit="fps"
                hint="Decode the source at this rate before interpolating."
                onChange={(value) => set({ sourceFps: Math.round(value) })}
              />
              <NumberField
                label="Target rate"
                value={targetFps}
                min={1}
                max={60}
                step={1}
                unit="fps"
                hint="Export the interpolated result at this rate."
                onChange={(value) => set({ targetFps: Math.round(value) })}
              />
            </div>
            <SelectField
              label="Flow quality"
              value={p.quality === 'fast' || p.quality === 'best' ? p.quality : 'balanced'}
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'best', label: 'Best' },
              ]}
              onChange={(quality) => set({ quality })}
            />
            <p className="micro-copy">
              Motion is estimated with block matching and the two source frames are warped and
              blended. This is a fast approximation, not a production optical-flow solver. Live
              preview plays at the source timing; the interpolated result is written during export.
            </p>
          </>
        )}
      </Section>
      <div className="info-callout">
        <Icon name="gauge" size={16} />
        <span>
          Place Retime after a Media input and before Pixelate. Stop motion preview quantises the
          video clock to the output rate. Optical-flow output uses the normal video export button.
        </span>
      </div>
    </div>
  );
}

export function Object3DPanel({ node }: { node: GraphNode }): React.ReactElement {
  const { updateNodeParams, notify } = useStudio();
  const connected = useHasMediaInput(node);
  const p: Render3DParams = { ...DEFAULT_OBJECT3D, ...(node.params as Partial<Render3DParams>) };
  const set = (patch: Partial<Render3DParams>): void => updateNodeParams(node.id, patch);
  const meshRef = useRef<HTMLInputElement>(null);

  const loadMesh = async (file: File): Promise<void> => {
    try {
      const mesh = parseMesh(file.name, await file.text());
      if (!mesh || mesh.vertices.length === 0) {
        notify(`Could not parse “${file.name}” as OBJ/FBX/GLTF.`, 'error');
        return;
      }
      set({ mesh, meshName: file.name });
      notify(`Loaded “${file.name}” (${mesh.vertices.length} vertices, ${mesh.triangles.length / 3} triangles).`, 'success');
    } catch (err) {
      notify(`Mesh import failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  return (
    <div className="inspector-panel">
      <Section
        title="Primitive"
        subtitle="Orthographic camera with z-buffered Lambert shading."
      >
        <SelectField
          label="Shape"
          value={p.mesh ? 'mesh' : p.primitive}
          options={[
            ...(p.mesh ? [{ value: 'mesh' as const, label: `Mesh · ${p.meshName ?? 'imported'}` }] : []),
            ...PRIMITIVES_3D,
          ]}
          onChange={(v) => set({ primitive: v as Render3DParams['primitive'], mesh: undefined, meshName: undefined })}
        />
        <div className="two-col">
          <button type="button" className="ghost-btn small" onClick={() => meshRef.current?.click()}>
            <Icon name="upload" size={14} /> Import mesh
          </button>
          {p.mesh ? (
            <button
              type="button"
              className="ghost-btn small danger"
              onClick={() => set({ mesh: undefined, meshName: undefined })}
            >
              <Icon name="close" size={14} /> Clear
            </button>
          ) : null}
        </div>
        <input
          ref={meshRef}
          type="file"
          accept=".obj,.fbx,.gltf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void loadMesh(file);
          }}
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
