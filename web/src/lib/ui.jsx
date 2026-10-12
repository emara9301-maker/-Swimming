import React, { useCallback, useEffect, useState } from 'react';

export function useData(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return loader()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState({ data: null, error: error.message, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

// Runs an async action, tracking busy state and showing its error or success message.
export function useAction() {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  // Resolves with the result, or undefined when the action failed (the error is shown).
  const run = async (fn, okText = 'Saved') => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await fn();
      setMsg({ type: 'ok', text: okText });
      return result ?? {};
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, msg, busy, setMsg };
}

export function Notice({ msg }) {
  if (!msg) return null;
  return <div className={`notice ${msg.type}`} role="status">{msg.text}</div>;
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value ?? '—'}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function Loading({ error }) {
  if (error) return <div className="notice error">{error}</div>;
  return <p className="muted">Loading…</p>;
}

// Column spec: [{ key, label, render? }]. Works as cards on phones via CSS.
export function Table({ columns, rows, empty = 'No data yet' }) {
  if (!rows || rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Simple form: fields = [{ name, label, type?, options?, required?, min?, max? }].
export function Form({ fields, submitLabel = 'Save', onSubmit, busy, initial = {} }) {
  const [values, setValues] = useState(initial);
  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }));
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSubmit(values);
        if (ok) setValues(initial);
      }}
    >
      {fields.map((f) => (
        <Field key={f.name} label={f.label}>
          {f.options ? (
            <select value={values[f.name] ?? ''} onChange={set(f.name)} required={f.required}>
              <option value="">— Select —</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              type={f.type || 'text'}
              value={values[f.name] ?? ''}
              onChange={set(f.name)}
              required={f.required}
              min={f.min}
              max={f.max}
            />
          )}
        </Field>
      ))}
      <div className="form-submit">
        <button className="btn primary" disabled={busy} type="submit">{busy ? '…' : submitLabel}</button>
      </div>
    </form>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          className={value === t.value ? 'tab active' : 'tab'}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export const fmtDate = (v) => (v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP' });
export const fmtMoney = (cents) => money.format((cents || 0) / 100);
export const toLocalInput = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—');
