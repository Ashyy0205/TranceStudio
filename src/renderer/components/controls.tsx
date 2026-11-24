import { type ReactNode, useEffect, useId, useState } from 'react';
import type { Colour } from '../../shared/types';
import { useStudio } from '../store';
import { formatTime, parseTime } from '../util';
import { Icon } from './Icon';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Slider(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  label: string;
  hint?: string;
  defaultValue?: number;
}) {
  const { value, min, max, step = 1, onChange, format, label, hint, defaultValue } = props;
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        <span className="field-value">{format ? format(value) : value}</span>
      </label>
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        title={defaultValue !== undefined ? 'Double-click to reset' : undefined}
      />
      {hint && <div className="field-hint below">{hint}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
export const colourToHex = (c: Colour) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
export const colourToCss = (c: Colour, alpha = c.a) =>
  `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;

export function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Colour;
  onChange: (c: Colour) => void;
}) {
  return (
    <div className="colour-field">
      <label className="colour-swatch" style={{ background: colourToCss(value, 1) }} title="Pick colour">
        <input
          type="color"
          value={colourToHex(value)}
          onChange={(e) => {
            const h = e.target.value;
            onChange({
              r: parseInt(h.slice(1, 3), 16) / 255,
              g: parseInt(h.slice(3, 5), 16) / 255,
              b: parseInt(h.slice(5, 7), 16) / 255,
              a: value.a,
            });
          }}
        />
      </label>
      <div className="colour-body">
        <div className="field-label">
          {label}
          <span className="field-value">{Math.round(value.a * 100)}%</span>
        </div>
        <input
          type="range"
          className="slider"
          min={0}
          max={255}
          value={Math.round(value.a * 255)}
          style={{ '--pct': `${value.a * 100}%` } as React.CSSProperties}
          onChange={(e) => onChange({ ...value, a: Number(e.target.value) / 255 })}
          aria-label={`${label} opacity`}
        />
      </div>
    </div>
  );
}

export function TimeInput({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  const commit = () => {
    const t = parseTime(text);
    if (t === null) setText(formatTime(value));
    else onChange(Math.max(min, Math.round(t)));
  };
  return (
    <input
      className="input time-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(formatTime(value));
      }}
      placeholder="m:ss"
    />
  );
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease">
        -
      </button>
      <span className="stepper-value">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase">
        +
      </button>
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Small "?" button that opens the manual at `topic` ("page" or "page#heading").
export function HelpButton({ topic, label }: { topic: string; label?: string }) {
  return (
    <button
      className="icon-btn small help-btn"
      onClick={() => useStudio.getState().openHelp(topic)}
      title={label ? `About ${label}\nOpens the manual` : 'Open the manual for this'}
    >
      <Icon name="help" size={14} />
    </button>
  );
}

// Remembers which inspector sections are collapsed for the rest of the session.
const sectionOpen = new Map<string, boolean>();

export function Section({
  title,
  children,
  actions,
  help,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  // Manual topic explaining this section.
  help?: string;
  defaultOpen?: boolean;
}) {
  // "Images (12)" and "Images (13)" share one open/closed state.
  const key = title.replace(/\s*\(\d+\)$/, '');
  const [open, setOpen] = useState(() => sectionOpen.get(key) ?? defaultOpen);
  const toggle = () => {
    sectionOpen.set(key, !open);
    setOpen(!open);
  };
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <div className="section-head">
        <button className="section-toggle" onClick={toggle} aria-expanded={open}>
          <Icon name="caret" size={12} />
          <h3>{title}</h3>
        </button>
        {actions}
        {help && <HelpButton topic={help} label={key.toLowerCase()} />}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
