/**
 * ColorWheel - self-contained HSV color picker for PixelArtify Studio.
 *
 * Usage:
 *   <ColorWheel value={hex} onChange={setHex} onCreatePalette={openPaletteStudio} />
 *
 * All chrome uses neutral theme greys (with CSS variables where available); only the
 * wheel, SV square and live swatch are colored. Every class name is prefixed with
 * `cw-` so the integrator can add focus/hover CSS without collisions:
 *
 *   cw-root, cw-head, cw-swatch, cw-head-copy, cw-label, cw-hex,
 *   cw-wheel-wrap, cw-wheel, cw-wheel-marker, cw-sv, cw-sv-marker,
 *   cw-rgb-row, cw-channel, cw-channel-label, cw-rgb-input, cw-create
 *
 * Layout/colors are also defined inline (see `styles` below), so the component
 * looks correct standalone before any CSS is added.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export type Hsv = { h: number; s: number; v: number };
export type Rgb = { r: number; g: number; b: number };

const WHEEL_SIZE = 170;
const SV_HEIGHT = 84;
const WHEEL_RADIUS = WHEEL_SIZE / 2 - 10;

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const normHue = (h: number): number => ((h % 360) + 360) % 360;

/** Parse `#rrggbb` (the leading `#` is optional) and return a lowercase normalized hex, or null. */
export function normalizeHex(input: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(input.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexToHsv(hex: string): Hsv {
  const norm = normalizeHex(hex) ?? '#000000';
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }

  return {
    h: normHue(h),
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function rgbToHsv(rgb: Rgb): Hsv {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }

  return {
    h: normHue(h),
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function hsvToRgb(hsv: Hsv): Rgb {
  const h = normHue(hsv.h);
  const s = clamp(hsv.s, 0, 1);
  const v = clamp(hsv.v, 0, 1);

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

const channelHex = (n: number): string =>
  clamp(Math.round(n), 0, 255)
    .toString(16)
    .padStart(2, '0');

export function hsvToHex(hsv: Hsv): string {
  const { r, g, b } = hsvToRgb(hsv);
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

function beginDrag(
  event: React.PointerEvent<HTMLDivElement>,
  dragging: { current: boolean },
  update: (clientX: number, clientY: number) => void,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.current = true;
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    /* pointer capture is not supported - clicks still work */
  }
  update(event.clientX, event.clientY);
}

function moveDrag(
  event: React.PointerEvent<HTMLDivElement>,
  dragging: { current: boolean },
  update: (clientX: number, clientY: number) => void,
): void {
  if (!dragging.current) return;
  update(event.clientX, event.clientY);
}

function finishDrag(
  event: React.PointerEvent<HTMLDivElement>,
  dragging: { current: boolean },
): void {
  if (!dragging.current) return;
  dragging.current = false;
  try {
    event.currentTarget.releasePointerCapture(event.pointerId);
  } catch {
    /* already released */
  }
}

export function ColorWheel(props: {
  value: string;
  onChange: (hex: string) => void;
  onCreatePalette?: () => void;
}): React.ReactElement {
  const { value, onChange, onCreatePalette } = props;

  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState<string>(() => normalizeHex(value) ?? value);

  const hsvRef = useRef(hsv);
  const lastEmitted = useRef<string>(normalizeHex(value) ?? hsvToHex(hsv));
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);
  const wheelDragging = useRef(false);
  const svDragging = useRef(false);

  // Keep internal state in sync with externally-driven `value` changes, without
  // clobbering the hue/selection while the user is dragging (the incoming hex may
  // be a quantized version of our own output, e.g. #000000 at V=0).
  useEffect(() => {
    const norm = normalizeHex(value);
    if (!norm) return;
    setHexText(norm);
    lastEmitted.current = norm;
    if (hsvToHex(hsvRef.current) === norm) return;
    const next = hexToHsv(norm);
    hsvRef.current = next;
    setHsv(next);
  }, [value]);

  const emit = useCallback(
    (next: Hsv): void => {
      hsvRef.current = next;
      setHsv(next);
      const hex = hsvToHex(next);
      if (hex !== lastEmitted.current) {
        lastEmitted.current = hex;
        onChange(hex);
      }
    },
    [onChange],
  );

  const setHueFromPoint = useCallback(
    (clientX: number, clientY: number): void => {
      const el = wheelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
      emit({ ...hsvRef.current, h: normHue(degrees + 90) });
    },
    [emit],
  );

  const setSvFromPoint = useCallback(
    (clientX: number, clientY: number): void => {
      const el = svRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const s = clamp((clientX - rect.left) / rect.width, 0, 1);
      const v = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
      emit({ ...hsvRef.current, s, v });
    },
    [emit],
  );

  const onWheelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 2;
    let delta = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = step;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -step;
    if (delta === 0) return;
    event.preventDefault();
    emit({ ...hsvRef.current, h: normHue(hsvRef.current.h + delta) });
  };

  const onSvKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const current = hsvRef.current;
    let next: Hsv;
    switch (event.key) {
      case 'ArrowLeft':
        next = { ...current, s: clamp(current.s - step, 0, 1) };
        break;
      case 'ArrowRight':
        next = { ...current, s: clamp(current.s + step, 0, 1) };
        break;
      case 'ArrowDown':
        next = { ...current, v: clamp(current.v - step, 0, 1) };
        break;
      case 'ArrowUp':
        next = { ...current, v: clamp(current.v + step, 0, 1) };
        break;
      default:
        return;
    }
    event.preventDefault();
    emit(next);
  };

  const onHexChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const text = event.target.value;
    setHexText(text);
    const norm = normalizeHex(text);
    if (!norm) return;
    emit(hexToHsv(norm));
  };

  const onHexBlur = (event: React.FocusEvent<HTMLInputElement>): void => {
    const norm = normalizeHex(event.currentTarget.value);
    if (norm) {
      setHexText(norm);
      return;
    }
    setHexText(normalizeHex(value) ?? hsvToHex(hsvRef.current));
  };

  const setChannel = (channel: 'r' | 'g' | 'b', raw: string): void => {
    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const rgb = hsvToRgb(hsvRef.current);
    emit(rgbToHsv({ ...rgb, [channel]: clamp(Math.round(parsed), 0, 255) }));
  };

  const rgb = hsvToRgb(hsv);
  const hex = hsvToHex(hsv);
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  const hueRadians = (hsv.h * Math.PI) / 180;
  const wheelMarkerX = WHEEL_SIZE / 2 + WHEEL_RADIUS * Math.sin(hueRadians);
  const wheelMarkerY = WHEEL_SIZE / 2 - WHEEL_RADIUS * Math.cos(hueRadians);

  const wheelBackground =
    'radial-gradient(circle at center, #1f1f1f 0 55%, rgba(31, 31, 31, 0) 56%), ' +
    'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)';

  const svBackground =
    'linear-gradient(to top, #000000, rgba(0, 0, 0, 0)), ' +
    'linear-gradient(to right, #ffffff, rgba(255, 255, 255, 0)), ' +
    hueColor;

  return (
    <div className="cw-root" style={styles.root} role="group" aria-label="Color picker">
      <div className="cw-head" style={styles.head}>
        <div
          className="cw-swatch"
          style={{ ...styles.swatch, backgroundColor: hex }}
          title={hex}
          aria-hidden="true"
        />
        <div className="cw-head-copy" style={styles.headCopy}>
          <span className="cw-label" style={styles.label}>
            Hex
          </span>
          <input
            className="cw-hex"
            style={styles.hex}
            type="text"
            value={hexText}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            aria-label="Hex color"
            title="Hex color (#rrggbb)"
            onChange={onHexChange}
            onBlur={onHexBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                setHexText(normalizeHex(value) ?? hsvToHex(hsvRef.current));
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      </div>

      <div className="cw-wheel-wrap" style={styles.wheelWrap}>
        <div
          ref={wheelRef}
          className="cw-wheel"
          style={{ ...styles.wheel, background: wheelBackground }}
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          aria-valuetext={`${Math.round(hsv.h)} degrees`}
          title="Hue"
          onPointerDown={(event) => beginDrag(event, wheelDragging, setHueFromPoint)}
          onPointerMove={(event) => moveDrag(event, wheelDragging, setHueFromPoint)}
          onPointerUp={(event) => finishDrag(event, wheelDragging)}
          onPointerCancel={(event) => finishDrag(event, wheelDragging)}
          onKeyDown={onWheelKeyDown}
        />
        <div
          className="cw-wheel-marker"
          style={{
            ...styles.marker,
            left: wheelMarkerX,
            top: wheelMarkerY,
            backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
          }}
        />
      </div>

      <div
        ref={svRef}
        className="cw-sv"
        style={{ ...styles.sv, background: svBackground }}
        role="group"
        tabIndex={0}
        aria-label="Saturation and brightness"
        title="Saturation / Brightness"
        onPointerDown={(event) => beginDrag(event, svDragging, setSvFromPoint)}
        onPointerMove={(event) => moveDrag(event, svDragging, setSvFromPoint)}
        onPointerUp={(event) => finishDrag(event, svDragging)}
        onPointerCancel={(event) => finishDrag(event, svDragging)}
        onKeyDown={onSvKeyDown}
      >
        <div
          className="cw-sv-marker"
          style={{
            ...styles.marker,
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
          }}
        />
      </div>

      <div className="cw-rgb-row" style={styles.rgbRow}>
        <ChannelInput label="R" value={rgb.r} onCommit={(n) => setChannel('r', String(n))} />
        <ChannelInput label="G" value={rgb.g} onCommit={(n) => setChannel('g', String(n))} />
        <ChannelInput label="B" value={rgb.b} onCommit={(n) => setChannel('b', String(n))} />
      </div>

      {onCreatePalette ? (
        <button type="button" className="cw-create" style={styles.create} onClick={onCreatePalette}>
          Create palette
        </button>
      ) : null}
    </div>
  );
}

function ChannelInput(props: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const { label, value, onCommit } = props;
  const [text, setText] = useState<string>(() => String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <label className="cw-channel" style={styles.channel}>
      <span className="cw-channel-label" style={styles.channelLabel}>
        {label}
      </span>
      <input
        className="cw-rgb-input"
        style={styles.rgbInput}
        type="text"
        inputMode="numeric"
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-label={`${label} channel`}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^0-9]/g, '').slice(0, 3);
          setText(digits);
          if (digits === '') return;
          const parsed = Number(digits);
          if (Number.isFinite(parsed)) onCommit(clamp(Math.round(parsed), 0, 255));
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

const MONO = 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace';

const styles = {
  root: {
    width: 236,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 10,
    background: '#1f1f1f',
    border: '1px solid #343434',
    borderRadius: 2,
    color: '#e7e7e7',
    fontFamily: '"Segoe UI", Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: 10,
    lineHeight: 1.3,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 32,
    height: 32,
    flex: '0 0 auto',
    boxSizing: 'border-box',
    borderRadius: 2,
    border: '1px solid #454545',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
  },
  headCopy: {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  label: {
    fontSize: 8,
    lineHeight: 1,
    letterSpacing: '0.9px',
    textTransform: 'uppercase',
    color: '#6d6d6d',
  },
  hex: {
    width: '100%',
    height: 22,
    boxSizing: 'border-box',
    background: '#161616',
    border: '1px solid #343434',
    borderRadius: 2,
    color: '#e7e7e7',
    padding: '0 6px',
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.4px',
    outline: 'none',
  },
  wheelWrap: {
    position: 'relative',
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    alignSelf: 'center',
    flex: '0 0 auto',
  },
  wheel: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    boxSizing: 'border-box',
    borderRadius: '50%',
    cursor: 'crosshair',
    touchAction: 'none',
    userSelect: 'none',
    boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.08), 0 4px 12px rgba(0, 0, 0, 0.35)',
  },
  sv: {
    position: 'relative',
    width: '100%',
    height: SV_HEIGHT,
    boxSizing: 'border-box',
    borderRadius: 2,
    cursor: 'crosshair',
    touchAction: 'none',
    userSelect: 'none',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 2px 8px rgba(0, 0, 0, 0.3)',
  },
  marker: {
    position: 'absolute',
    width: 12,
    height: 12,
    boxSizing: 'border-box',
    borderRadius: '50%',
    border: '2px solid #ffffff',
    boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.65)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  },
  rgbRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 5,
  },
  channel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 24,
    boxSizing: 'border-box',
    padding: '0 5px',
    background: '#161616',
    border: '1px solid #343434',
    borderRadius: 2,
    cursor: 'text',
  },
  channelLabel: {
    flex: '0 0 auto',
    fontFamily: MONO,
    fontSize: 8,
    color: '#6d6d6d',
  },
  rgbInput: {
    flex: '1 1 auto',
    width: '100%',
    minWidth: 0,
    background: 'transparent',
    border: 0,
    padding: 0,
    color: '#e7e7e7',
    fontFamily: MONO,
    fontSize: 10,
    textAlign: 'right',
    outline: 'none',
  },
  create: {
    height: 26,
    boxSizing: 'border-box',
    background: '#262626',
    border: '1px solid #454545',
    borderRadius: 2,
    color: '#e7e7e7',
    fontSize: 9.5,
    letterSpacing: '0.3px',
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>;
