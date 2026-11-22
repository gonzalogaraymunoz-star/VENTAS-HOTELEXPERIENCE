import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { emptyIntakePassenger, emptyRequest, intakeMissing, intakePayload, optionalAmount } from '../lib/clientIntake360';
import type { IntakePassenger, IntakeRequest } from '../lib/clientIntake360';
import type { Lead, LeadService, HotelPartner, SellerProfile } from '../types';
import './ClientFicha360.css';

type IntakeLead = Lead & { intake_request?: Partial<IntakeRequest> | null };
const printableValue = (value: unknown) => value === null || value === undefined || String(value).trim() === '' ? 'Pendiente' : String(value);
export default function ClientFicha360({ leadId, canEdit, hotels, sellers, onClose, onSaved }: { leadId?: string; canEdit: boolean; hotels: HotelPartner[]; sellers: SellerProfile[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [requestId] = useState(() => {
    const key = 'link-ficha360-pending-request';
    const existing = sessionStorage.getItem(key);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id;
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [lead, setLead] = useState<IntakeLead | null>(null);
  const [people, setPeople] = useState<IntakePassenger[]>([]);
  const [linkedServices, setLinkedServices] = useState<LeadService[]>([]);
  const [request, setRequest] = useState<IntakeRequest>(emptyRequest);
  const [contact, setContact] = useState('');
  const [hotelId, setHotelId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [loading, setLoading] = useState(Boolean(leadId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(!leadId);
  const intakeFieldsRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const fields = intakeFieldsRef.current?.querySelectorAll<HTMLTextAreaElement>('.ficha360-long-field textarea');
    fields?.forEach(element => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    });
  }, [loaded, request.product, request.sourceNote]);
  useEffect(() => {
    let active = true;
    if (!leadId) return;
    setLoading(true); setLoaded(false); setError('');
    void Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('passengers').select('*').eq('lead_id', leadId).order('passenger_code'),
      supabase.from('lead_services').select('*').eq('lead_id', leadId),
    ]).then(([leadResult, passengerResult, serviceResult]) => {
      if (!active) return;
      if (leadResult.error) throw leadResult.error;
      if (passengerResult.error) throw passengerResult.error;
      if (serviceResult.error) throw serviceResult.error;
      setLinkedServices((serviceResult.data || []) as LeadService[]);
      const row = leadResult.data as IntakeLead;
      setLead(row); setContact(row.contacto || ''); setHotelId(row.hotel_partner_id || ''); setSellerId(row.assigned_to || '');
      setRequest({ ...emptyRequest(), ...Object.fromEntries(Object.entries(row.intake_request ?? {}).map(([key, value]) => [key, value ?? (key === 'pax' || key === 'agreedPrice' ? null : '')])) });
      setPeople((passengerResult.data || []).map(row => ({ ...emptyIntakePassenger(), ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? ''])) })) as IntakePassenger[]);
      setLoaded(true);
    }).catch((problem: unknown) => { if (active) setError(problem instanceof Error ? problem.message : 'No se pudo leer la ficha. Comprueba tu acceso.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [leadId, reloadToken]);
  const missing = intakeMissing({ hotel_partner_id: hotelId || null, assigned_to: sellerId || null, contacto: contact }, people, request);
  const confirmed = lead?.estado === 'confirmado' || linkedServices.some(service => ['confirmed','completed'].includes(String(service.booking_status)));
  const locked = confirmed || !canEdit || !loaded || busy || loading;
  function patchPerson(index: number, key: keyof IntakePassenger, value: string | boolean) { setPeople(current => current.map((person, row) => row === index ? { ...person, [key]: value } : person)); }
  async function save() {
    if (locked) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = intakePayload(lead, people, request, contact);
      const result = await supabase.rpc('save_link_client_intake360', { p_payload: { ...payload, request_id: requestId, hotel_partner_id: hotelId || null, seller_profile_id: sellerId || null } });
      if (result.error) throw result.error;
      const savedId = String(result.data?.lead_id || '');
      if (!savedId) throw new Error('El servidor no devolvió la ficha guardada. No repitas el guardado sin revisar.');
      // The canonical URL contains only the existing lead UUID, never customer data.
      sessionStorage.removeItem('link-ficha360-pending-request');
      window.location.hash = `ficha360/${encodeURIComponent(savedId)}`;
      await onSaved();
      setReloadToken(current => current + 1);
      setNotice('Guardado parcial. La reserva no fue confirmada.');
    } catch (problem: unknown) { setError(problem instanceof Error ? problem.message : 'No se pudo guardar. Revisa el estado antes de volver a intentarlo.'); }
    finally { setBusy(false); }
  }
  function field(title: string, key: keyof IntakeRequest, type = 'text') {
    const value = request[key];
    const onChange = (raw: string) => {
      if (key === 'agreedPrice' && raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) return;
      setRequest(current => ({ ...current, [key]: key === 'agreedPrice' ? optionalAmount(raw) : key === 'pax' ? (raw === '' ? null : Number(raw)) : raw }));
    };
    const longText = key === 'product' || key === 'sourceNote';
    return <label key={key} className={longText ? 'ficha360-long-field' : undefined}>{title}{longText
      ? <><textarea rows={1} value={value ?? ''} disabled={locked} placeholder="Pendiente" onChange={event => onChange(event.target.value)} onInput={event => {
          const element = event.currentTarget;
          element.style.height = 'auto';
          element.style.height = `${element.scrollHeight}px`;
        }}/><span className="ficha360-print-value">{printableValue(value)}</span></>
      : <><input type={type} value={value ?? ''} disabled={locked} placeholder="Pendiente" min={type === 'number' ? 0 : undefined} onChange={event => onChange(event.target.value)}/><span className="ficha360-print-value">{printableValue(value)}</span></>}</label>;
  }
  return <div className="ficha360 screen-stack">
    <header className="page-heading"><div><p className="eyebrow">CLIENTES · FICHA 360</p><h1>{lead ? (lead.codigo && lead.codigo.length <= 14 ? lead.codigo : (people.map(person => person.full_name?.trim()).filter(Boolean).join(' \u00b7 ') || contact.trim() || 'Ficha nueva')) : (leadId ? 'Cargando ficha' : 'Nueva ficha parcial')}</h1>{lead?.codigo && lead.codigo.length > 14 ? <p className="ficha360-ref">Referencia {lead.codigo}</p> : null}<p>Datos de cliente y pasajeros. Guardar no confirma servicios ni entrega una reserva a Operaciones.</p></div><div className="ficha360-heading-actions"><button className="button ghost" disabled={!loaded || loading} onClick={() => window.print()}>Imprimir / PDF</button><button className="button ghost" onClick={onClose}>Volver a Clientes</button></div></header>
    <div className="ficha360-access">Acceso interno del CRM: roles autorizados y agentes con acceso al expediente. Este enlace no permite acceso anónimo. No se envían mensajes, pagos, cupos ni carpetas de Drive.</div>
    {loading && <p role="status">Cargando datos privados…</p>}
    {error && <div className="error-box" role="alert">{error}</div>}
    {notice && <div role="status">{notice}</div>}
    {confirmed && <p>Reserva confirmada. Esta vista de ingreso es de lectura; usa el flujo existente para cambios posteriores.</p>}
    <details className="work-panel"><summary>Cómo completamos esta ficha</summary><p>Recuperamos información de la conversación de origen, revisamos a qué expediente corresponde y completamos datos disponibles. Los desconocidos quedan pendientes. La recuperación desde LAMA es asistida, no una sincronización automática continua.</p><p>Guardar conserva el mismo expediente y sus pasajeros. No confirma servicios, envía mensajes, cobra, aparta cupos ni crea carpetas. Antes del primer guardado personal revisamos los datos que quedarán registrados.</p><p>Si otra persona cambió la ficha, recarga antes de guardar. Si un guardado no se confirma, revisa el expediente antes de repetirlo.</p></details>
    {loaded && <>
      <section className="ficha360-pending"><h2>{missing.length} datos pendientes</h2><p>Se puede guardar una ficha incompleta. Pendiente no equivale a cero, Pasaporte o ausencia de necesidades.</p><ul>{missing.map(item => <li key={item}>{item}</li>)}</ul></section>
      <section className="work-panel"><h2>Expediente</h2><div className="ficha360-grid"><label>Contacto del cliente<input value={contact} onChange={event => setContact(event.target.value)} disabled={locked} placeholder="Pendiente, no usar el remitente como contacto"/><span className="ficha360-print-value">{printableValue(contact)}</span></label><label>Hotel / origen<select value={hotelId} disabled={locked} onChange={event => setHotelId(event.target.value)}><option value="">Pendiente</option>{hotels.map(hotel => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select><span className="ficha360-print-value">{printableValue(hotels.find(hotel => hotel.id === hotelId)?.name)}</span></label><label>Vendedor responsable<select value={sellerId} disabled={locked} onChange={event => setSellerId(event.target.value)}><option value="">Pendiente</option>{sellers.map(seller => <option key={seller.id} value={seller.id}>{seller.full_name || seller.email}</option>)}</select><span className="ficha360-print-value">{printableValue(sellers.find(seller => seller.id === sellerId)?.full_name || sellers.find(seller => seller.id === sellerId)?.email)}</span></label></div><p>Puedes completar origen y responsable aquí y guardar el mismo expediente. No se eligen automáticamente.</p></section>
      {linkedServices.length > 0 && <section className="work-panel"><h2>Servicios del mismo expediente</h2><p>Se conservan los servicios y sus UUID. Guardar esta ficha no los reconstruye ni cambia su estado.</p>{linkedServices.map(service => <article className="ficha360-person" key={service.id}><h3>{service.producto}</h3><p>{service.fecha_servicio || 'Fecha pendiente'} · {service.booking_status || 'Estado pendiente'} · {service.numero_pax ?? 'Cantidad pendiente'} pax</p></article>)}</section>}
      <section className="work-panel"><h2>Solicitud recibida, todavía no confirmada</h2><div className="ficha360-grid" ref={intakeFieldsRef}>{field('Servicio', 'product')}{field('Modalidad', 'modality')}{field('Cantidad de pasajeros', 'pax', 'number')}{field('Fecha del servicio', 'date', 'date')}{field('Hora', 'time', 'time')}{field('Recogida', 'pickup')}{field('Idioma', 'language')}{field('Tarifa acordada', 'agreedPrice', 'number')}{field('Moneda informada', 'currency')}{field('Fuente y relación con la solicitud', 'sourceNote')}</div><p>Estos datos describen lo recibido. No crean servicios confirmados, cotizaciones ni cargos.</p></section>
      <section className="work-panel"><h2>Pasajeros</h2><p>No se escoge pasajero principal por el orden de ingreso. Escribe las declaraciones de alimentación y necesidades tal como fueron recibidas, o déjalas pendientes.</p>{people.map((person, index) => <article className="ficha360-person" key={person.id || index}><h3>Pasajero {index + 1}</h3><div className="ficha360-grid">{([
        ['full_name', 'Nombre completo', 'text'], ['email', 'Email', 'email'], ['phone', 'Teléfono', 'tel'], ['nationality', 'Nacionalidad', 'text'], ['document_type', 'Tipo de documento', 'text'], ['document_number', 'Número de documento', 'text'], ['birth_date', 'Fecha de nacimiento', 'date'], ['dietary_restrictions', 'Declaración de alimentación', 'text'], ['medical_notes', 'Declaración de necesidades especiales', 'text'], ['disability_type', 'Apoyos de accesibilidad', 'text'],
      ] as const).map(([key, title, type]) => <label key={key}>{title}<input type={type} value={person[key] || ''} placeholder="Pendiente" disabled={locked} onChange={event => patchPerson(index, key, event.target.value)}/><span className="ficha360-print-value">{printableValue(person[key])}</span></label>)}<label>Pasajero principal<select value={person.is_primary ? 'yes' : 'no'} disabled={locked} onChange={event => { if (event.target.value === 'yes') setPeople(current => current.map((row, rowIndex) => ({ ...row, is_primary: rowIndex === index }))); else patchPerson(index, 'is_primary', false); }}><option value="no">Sin registro de designación</option><option value="yes">Registrado como principal</option></select><span className="ficha360-print-value">{person.is_primary ? 'Registrado como principal' : 'Sin registro de designación'}</span></label></div></article>)}<button className="button ghost" disabled={locked} onClick={() => setPeople(current => [...current, emptyIntakePassenger()])}>Agregar pasajero</button></section>
      <footer className="ficha360-actions"><p>Sin confirmación de reserva. Los datos faltantes seguirán visibles.</p><button className="button dark" disabled={locked} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar ficha parcial'}</button></footer>
    </>}
  </div>;
}

