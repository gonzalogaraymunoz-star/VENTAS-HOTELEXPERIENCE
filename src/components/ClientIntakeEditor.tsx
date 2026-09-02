import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, X } from 'lucide-react';
import { arrivalPriority, loadLeadPassengers, stayLength, updateLeadIntake } from '../lib/sales';
import type { Lead, PassengerDraft } from '../types';
import './ClientIntakeEditor.css';

type PassengerEdit = PassengerDraft & { passenger_code?: string };

function blankPassenger(primary = false): PassengerEdit {
  return {
    full_name: '', email: '', phone: '', nationality: '', document_type: 'Pasaporte',
    document_number: '', birth_date: '', dietary_restrictions: '', is_primary: primary,
  };
}

export default function ClientIntakeEditor({
  lead, onClose, onSaved,
}: {
  lead: Lead;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [contact, setContact] = useState(lead.contacto || '');
  const [checkin, setCheckin] = useState(lead.checkin || '');
  const [checkout, setCheckout] = useState(lead.checkout || '');
  const [nationality, setNationality] = useState(lead.nationality || '');
  const [stayDays, setStayDays] = useState<number | null>(lead.stay_days ?? stayLength(lead.checkin, lead.checkout));
  const [passengers, setPassengers] = useState<PassengerEdit[]>([blankPassenger(true)]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void loadLeadPassengers(lead.id).then(rows => {
      if (!active) return;
      if (rows.length) {
        setPassengers(rows.map((row: any, index: number) => ({
          passenger_code: row.passenger_code || undefined,
          full_name: row.full_name || '',
          email: row.email || '',
          phone: row.phone || '',
          nationality: row.nationality || (index === 0 ? lead.nationality || '' : ''),
          document_type: row.document_type || 'Pasaporte',
          document_number: row.document_number || '',
          birth_date: row.birth_date || '',
          dietary_restrictions: row.dietary_restrictions || '',
          is_primary: index === 0 || Boolean(row.is_primary),
        })));
      }
      setLoading(false);
    }).catch((error: any) => {
      if (!active) return;
      setMessage(error?.message || 'No se pudieron cargar los pasajeros.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [lead.id]);

  useEffect(() => {
    const calculated = stayLength(checkin, checkout);
    if (calculated != null) setStayDays(calculated);
  }, [checkin, checkout]);

  const priority = arrivalPriority(checkin);
  const completeness = useMemo(() => {
    const primary = passengers[0];
    const fields = [
      primary?.full_name, primary?.email || primary?.phone || contact, nationality || primary?.nationality,
      checkin, checkout,
    ];
    return fields.filter(Boolean).length;
  }, [passengers, contact, nationality, checkin, checkout]);

  function patchPassenger(index: number, patch: Partial<PassengerEdit>) {
    setPassengers(current => current.map((passenger, row) => row === index ? { ...passenger, ...patch } : passenger));
  }

  async function save() {
    setBusy(true); setMessage('');
    try {
      await updateLeadIntake({
        leadId: lead.id,
        contact,
        checkin,
        checkout,
        nationality: nationality || passengers[0]?.nationality || '',
        stayDays,
        priority,
        passengers,
      });
      setMessage('Datos actualizados.');
      await onSaved();
    } catch (error: any) {
      setMessage(error?.message || 'No se pudieron guardar los datos.');
    } finally { setBusy(false); }
  }

  return <div className="client-editor-backdrop" role="dialog" aria-modal="true">
    <section className="client-editor-panel">
      <header className="client-editor-head">
        <div><p className="eyebrow">COMPLETAR CLIENTE</p><h2>{lead.codigo}</h2><p>El ingreso ya existe. Completa los datos a medida que los obtengas, sin detener la venta.</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={19}/></button>
      </header>

      <div className="client-editor-summary">
        <div><span>Prioridad por arribo</span><strong>{priority}</strong></div>
        <div><span>Datos clave informados</span><strong>{completeness}/5</strong></div>
        <div><span>Personas</span><strong>{passengers.length}</strong></div>
      </div>

      {loading ? <div className="loading-panel">Cargando datos del cliente…</div> : <>
        <section className="client-editor-section">
          <h3>Estadía y contacto</h3>
          <div className="form-grid five">
            <label>Contacto principal<input value={contact} onChange={event => setContact(event.target.value)} placeholder="Teléfono o email"/></label>
            <label>Arribo<input type="date" value={checkin} onChange={event => setCheckin(event.target.value)}/></label>
            <label>Salida<input type="date" value={checkout} onChange={event => setCheckout(event.target.value)}/></label>
            <label>Nacionalidad<input value={nationality} onChange={event => { setNationality(event.target.value); patchPassenger(0, { nationality: event.target.value }); }}/></label>
            <label>Días de estadía<input type="number" min="0" value={stayDays ?? ''} onChange={event => setStayDays(event.target.value === '' ? null : Math.max(0, Number(event.target.value)))}/></label>
          </div>
        </section>

        <section className="client-editor-section">
          <div className="client-editor-section-title"><div><h3>Cliente y acompañantes</h3><p>Documento, nacimiento y datos secundarios pueden seguir pendientes.</p></div><button className="button ghost" type="button" onClick={() => setPassengers(current => [...current, blankPassenger(false)])}><Plus size={15}/> Acompañante</button></div>
          <div className="client-editor-passengers">
            {passengers.map((passenger, index) => <article key={passenger.passenger_code || index}>
              <div className="client-editor-person"><span>{index === 0 ? 'CLIENTE' : 'ACOMPAÑANTE'}</span><strong>P{String(index + 1).padStart(2, '0')}</strong></div>
              <div className="form-grid passenger-fields">
                <label>Nombre completo<input value={passenger.full_name} onChange={event => patchPassenger(index, { full_name: event.target.value })}/></label>
                <label>Email<input type="email" value={passenger.email} onChange={event => patchPassenger(index, { email: event.target.value })}/></label>
                <label>Teléfono<input value={passenger.phone} onChange={event => patchPassenger(index, { phone: event.target.value })}/></label>
                <label>Nacionalidad<input value={passenger.nationality} onChange={event => { patchPassenger(index, { nationality: event.target.value }); if (index === 0) setNationality(event.target.value); }}/></label>
                <label>Documento<input value={passenger.document_number} onChange={event => patchPassenger(index, { document_number: event.target.value })}/></label>
                <label>Nacimiento<input type="date" value={passenger.birth_date} onChange={event => patchPassenger(index, { birth_date: event.target.value })}/></label>
              </div>
            </article>)}
          </div>
        </section>
      </>}

      {message && <div className={message === 'Datos actualizados.' ? 'success-box' : 'error-box'}>{message}</div>}
      <footer className="client-editor-actions"><button className="button ghost" type="button" onClick={onClose}>Cerrar</button><button className="button dark big" disabled={busy || loading} type="button" onClick={() => void save()}>{busy ? 'Guardando…' : <><CheckCircle2 size={16}/> Guardar datos</>}</button></footer>
    </section>
  </div>;
}
