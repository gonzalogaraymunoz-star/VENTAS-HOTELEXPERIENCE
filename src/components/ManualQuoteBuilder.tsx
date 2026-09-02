import { useMemo, useState } from 'react';
import { Download, Plus, Share2, Trash2 } from 'lucide-react';
import { clp } from '../lib/money';
import { downloadManualQuote, shareManualQuote, type ManualQuoteLine } from '../lib/manualQuote';
import './ManualQuoteBuilder.css';

type DraftLine = ManualQuoteLine & { id: string };

function blankLine(): DraftLine {
  return { id: crypto.randomUUID(), name: '', quantity: 1, unitPrice: 0 };
}

export default function ManualQuoteBuilder({ compact = false }: { compact?: boolean }) {
  const [clientName, setClientName] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0),
    [lines],
  );

  function patchLine(id: string, patch: Partial<DraftLine>) {
    setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line));
  }

  function removeLine(id: string) {
    setLines(current => current.length === 1 ? [blankLine()] : current.filter(line => line.id !== id));
  }

  function payload() {
    return {
      clientName,
      contact,
      notes,
      lines: lines
        .filter(line => line.name.trim())
        .map(({ name, quantity, unitPrice }) => ({ name: name.trim(), quantity: Math.max(1, Number(quantity || 1)), unitPrice: Number(unitPrice || 0) })),
    };
  }

  function canExport() {
    return payload().lines.length > 0;
  }

  async function download() {
    if (!canExport()) { setMessage('Agrega al menos un ítem con nombre.'); return; }
    setBusy(true); setMessage('');
    try {
      downloadManualQuote(payload());
      setMessage('Cotización PDF generada.');
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo generar el PDF.');
    } finally { setBusy(false); }
  }

  async function share() {
    if (!canExport()) { setMessage('Agrega al menos un ítem con nombre.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await shareManualQuote(payload());
      setMessage(result === 'shared' ? 'Cotización enviada al selector de compartir.' : 'Cotización PDF descargada.');
    } catch (error: any) {
      if (error?.name === 'AbortError') setMessage('Compartir cancelado.');
      else setMessage(error?.message || 'No se pudo compartir la cotización.');
    } finally { setBusy(false); }
  }

  return <section className={`manual-quote ${compact ? 'compact' : ''}`}>
    <header className="manual-quote-head">
      <div><p className="eyebrow">COTIZADOR MANUAL</p><h2>Ítems y precios, sin depender del catálogo.</h2><p>Arma una propuesta rápida y expórtala como PDF igual que en Cobros.</p></div>
      <div className="manual-quote-total"><span>Total</span><strong>{clp(total)}</strong></div>
    </header>

    <div className="manual-quote-meta">
      <label>Cliente <span>opcional</span><input value={clientName} onChange={event => setClientName(event.target.value)} placeholder="Nombre del cliente"/></label>
      <label>Contacto <span>opcional</span><input value={contact} onChange={event => setContact(event.target.value)} placeholder="Teléfono o email"/></label>
    </div>

    <div className="manual-quote-lines">
      {lines.map((line, index) => <article key={line.id} className="manual-quote-line">
        <label className="item-name">Ítem {index + 1}<input value={line.name} onChange={event => patchLine(line.id, { name: event.target.value })} placeholder="Ej. Tour privado, traslado, cena…"/></label>
        <label>Cantidad<input type="number" min="1" value={line.quantity} onChange={event => patchLine(line.id, { quantity: Math.max(1, Number(event.target.value || 1)) })}/></label>
        <label>Precio venta<input type="number" min="0" value={line.unitPrice} onChange={event => patchLine(line.id, { unitPrice: Number(event.target.value || 0) })}/></label>
        <div className="manual-line-total"><span>Subtotal</span><strong>{clp(line.quantity * line.unitPrice)}</strong></div>
        <button className="icon-button danger" type="button" onClick={() => removeLine(line.id)} aria-label="Eliminar ítem"><Trash2 size={16}/></button>
      </article>)}
    </div>

    {!compact && <label className="manual-quote-notes">Observaciones <span>opcional</span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Condiciones, vigencia, notas comerciales…"/></label>}

    {message && <div className={message.includes('generada') || message.includes('selector') || message.includes('descargada') ? 'success-box' : 'error-box'}>{message}</div>}

    <footer className="manual-quote-actions">
      <button className="button ghost" type="button" onClick={() => setLines(current => [...current, blankLine()])}><Plus size={16}/> Agregar ítem</button>
      <div>
        <button className="button ghost" disabled={busy} type="button" onClick={() => void download()}><Download size={15}/> Descargar PDF</button>
        <button className="button dark" disabled={busy} type="button" onClick={() => void share()}><Share2 size={15}/> Enviar / compartir</button>
      </div>
    </footer>
  </section>;
}
