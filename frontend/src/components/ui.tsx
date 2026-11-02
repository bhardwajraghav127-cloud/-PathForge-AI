// Shared UI kit (U1): toasts, confirm dialog, metrics, chips, tabs,
// searchable select, empty states. Presentation only — no engine logic.
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';

export interface Toast { id: number; message: string; kind: 'info' | 'error' }
interface ToastState {
  toasts: Toast[];
  seq: number;
  push: (message: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}
export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  seq: 1,
  push: (message, kind = 'info') =>
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id: s.seq, message, kind }], seq: s.seq + 1 })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => {
      const first = toasts[0];
      if (first) dismiss(first.id);
    }, 4500);
    return () => clearTimeout(t);
  }, [toasts, dismiss]);
  return (
    <div className="pf-toasts" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`pf-toast${t.kind === 'error' ? ' error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification">×</button>
        </div>
      ))}
    </div>
  );
}

export function Confirm({
  open, title, body, confirmLabel, onConfirm, onCancel, testid,
}: {
  open: boolean; title: string; body: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; testid: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open ]);
  if (!open) return null;
  return (
    <div className="pf-dialog-back" data-testid={`${testid}-dialog`}>
      <div className="pf-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="pf-row">
          <button ref={ref} className="pf-btn danger" onClick={onConfirm} data-testid={`${testid}-confirm`}>
            {confirmLabel}
          </button>
          <button className="pf-btn" onClick={onCancel} data-testid={`${testid}-cancel`}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function Metric({ value, label, testid }: { value: string; label: string; testid: string }) {
  return (
    <div className="pf-metric" data-testid={testid}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export function Chip({ tone, children, testid }: { tone?: 'ok' | 'bad' | 'info' | 'warn'; children: React.ReactNode; testid?: string }) {
  return <span className={`pf-chip${tone ? ` ${tone}` : ''}`} data-testid={testid}>{children}</span>;
}

export function EmptyState({ title, hint, testid }: { title: string; hint: string; testid?: string }) {
  return (
    <div className="pf-empty" data-testid={testid}>
      <p><strong>{title}</strong></p>
      <p className="pf-meta">{hint}</p>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, testid }: {
  tabs: { id: string; label: string }[]; value: string;
  onChange: (id: string) => void; testid: string;
}) {
  return (
    <div className="pf-tabs" role="tablist" data-testid={testid}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className="pf-tab"
          onClick={() => onChange(t.id)} data-testid={`${testid}-${t.id}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SearchSelect({ id, label, options, value, onPick, placeholder, testid }: {
  id: string; label: string; options: { id: string; label: string }[];
  value: string; onPick: (id: string) => void; placeholder?: string; testid: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return options.slice(0, 8);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [text, options]);
  const current = options.find((o) => o.id === value);
  return (
    <div className="pf-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} role="combobox" aria-expanded={open && text.length > 0}
        aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
        placeholder={placeholder ?? current?.label ?? ''} value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && matches.length > 0) { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
          else if (e.key === 'ArrowUp' && matches.length > 0) { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
          else if (e.key === 'Enter') {
            const m = matches[active];
            if (open && text.length > 0 && m) { e.preventDefault(); onPick(m.id); setText(''); setOpen(false); }
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && text.length > 0 && matches.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="pf-suggest">
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active} data-testid={`${testid}-option-${m.id}`}
              onMouseDown={(e) => { e.preventDefault(); onPick(m.id); setText(''); setOpen(false); }}
              onMouseEnter={() => setActive(i)}>
              {m.label}
            </li>
          ))}
        </ul>
      )}
      <div className="pf-meta" data-testid={`${testid}-current`}>Selected: {current?.label ?? value}</div>
    </div>
  );
}
