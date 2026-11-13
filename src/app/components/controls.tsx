import React, { useEffect, useId, useState } from 'react';
import { Icon, type IconName } from './icons';
import { ColorWheel, normalizeHex } from './ColorWheel';
import { useStudio } from '../store';

export function Section({
  title,
  subtitle,
  children,
  defaultOpen = true,
  right,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'is-open' : ''} ${className}`}>
      <header className="section-head">
        <button type="button" className="section-toggle" onClick={() => setOpen((v) => !v)}>
          <Icon name="chevron" size={14} className="section-chevron" />
          <span className="section-title">{title}</span>
        </button>
        {right ? <div className="section-right">{right}</div> : null}
      </header>
      {open ? (
        <div className="section-body">
          {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  hint,
  disabled,
  format,
  defaultValue,
  pinned,
  onTogglePin,
  driven,
  onToggleDrive,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  unit?: string;
  hint?: string;
  disabled?: boolean;
  format?: (value: number) => string;
  defaultValue?: number;
  pinned?: boolean;
  onTogglePin?: () => void;
  driven?: boolean;
  onToggleDrive?: () => void;
}): React.ReactElement {
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0;
  const display = format ? format(value) : Number(value).toFixed(decimals);
  const locked = Boolean(disabled || driven);
  return (
    <div
      className={`control slider-control ${disabled ? 'is-disabled' : ''} ${driven ? 'is-driven' : ''}`}
      title={hint}
    >
      <div className="control-row">
        <label className="control-label">{label}</label>
        <ControlActions
          pinned={pinned}
          driven={driven}
          onReset={defaultValue !== undefined ? () => onChange(defaultValue) : undefined}
          onTogglePin={onTogglePin}
          onToggleDrive={onToggleDrive}
        />
        <span className="control-value">
          <input
            className="num-input"
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(value) ? value : 0}
            disabled={locked}
            aria-label={label}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(n);
            }}
          />
          {unit ? <em>{unit}</em> : null}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={locked}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  hint,
  disabled,
  defaultValue,
  pinned,
  onTogglePin,
  driven,
  onToggleDrive,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  unit?: string;
  hint?: string;
  disabled?: boolean;
  defaultValue?: number;
  pinned?: boolean;
  onTogglePin?: () => void;
  driven?: boolean;
  onToggleDrive?: () => void;
}): React.ReactElement {
  const locked = Boolean(disabled || driven);
  return (
    <div
      className={`control number-control ${disabled ? 'is-disabled' : ''} ${driven ? 'is-driven' : ''}`}
      title={hint}
    >
      <div className="control-row">
        <label className="control-label">{label}</label>
        <ControlActions
          pinned={pinned}
          driven={driven}
          onReset={defaultValue !== undefined ? () => onChange(defaultValue) : undefined}
          onTogglePin={onTogglePin}
          onToggleDrive={onToggleDrive}
        />
      </div>
      <div className="number-wrap">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          disabled={locked}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function ControlActions({
  pinned,
  driven,
  onReset,
  onTogglePin,
  onToggleDrive,
}: {
  pinned?: boolean;
  driven?: boolean;
  onReset?: () => void;
  onTogglePin?: () => void;
  onToggleDrive?: () => void;
}): React.ReactElement | null {
  if (!onReset && !onTogglePin && !onToggleDrive) return null;
  return (
    <span className="control-actions">
      {onTogglePin ? (
        <button
          type="button"
          className={`mini-btn ${pinned ? 'is-active' : ''}`}
          title={pinned ? 'Unpin from node' : 'Pin to node'}
          onClick={onTogglePin}
        >
          <Icon name="pin" size={12} />
        </button>
      ) : null}
      {onToggleDrive ? (
        <button
          type="button"
          className={`mini-btn ${driven ? 'is-active' : ''}`}
          title={driven ? 'Disconnect value input' : 'Get value from another node'}
          onClick={onToggleDrive}
        >
          <Icon name="link" size={12} />
        </button>
      ) : null}
      {onReset ? (
        <button type="button" className="mini-btn" title="Reset to default" onClick={onReset}>
          <Icon name="refresh" size={12} />
        </button>
      ) : null}
    </span>
  );
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

export function SelectField<T extends string = string>({
  label,
  value,
  options,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  hint?: string;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className={`control select-control ${disabled ? 'is-disabled' : ''}`}>
      <label className="control-label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} disabled={disabled} title={hint}>
        {options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}): React.ReactElement {
  return (
    <label className="toggle-control" title={hint}>
      <span className="control-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true">
        <span className="knob" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  label?: string;
}): React.ReactElement {
  return (
    <div className="segmented-wrap">
      {label ? <span className="control-label">{label}</span> : null}
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? 'is-active' : ''}
            onClick={() => onChange(o.value)}
            title={o.hint}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}): React.ReactElement {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const { setPaletteStudioOpen } = useStudio();
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="control color-control" title={hint}>
      <label className="control-label">{label}</label>
      <div className="color-wrap">
        <button
          type="button"
          className="color-swatch"
          style={{ background: value }}
          onClick={() => setOpen((v) => !v)}
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) onChange(normalizeHex(e.target.value.trim())!);
          }}
          onBlur={() => {
            if (/^#?[0-9a-f]{6}$/i.test(text.trim())) onChange(normalizeHex(text.trim())!);
            else setText(value);
          }}
        />
      </div>
      {open ? (
        <div className="color-popover">
          <ColorWheel
            value={value}
            onChange={onChange}
            onCreatePalette={() => setPaletteStudioOpen(true)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="control text-control">
      {label ? <label className="control-label">{label}</label> : null}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        title={hint}
        spellCheck={false}
        className={mono ? 'mono' : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="control text-control">
      {label ? <label className="control-label">{label}</label> : null}
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        title={hint}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  danger,
  disabled,
  size,
}: {
  icon: IconName;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  size?: number;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
    >
      <Icon name={icon} size={size ?? 17} />
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger';
}): React.ReactElement {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }): React.ReactElement {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <strong>{title}</strong>
      {children ? <div className="empty-copy">{children}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}): React.ReactElement | null {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Divider(): React.ReactElement {
  return <div className="divider" />;
}
