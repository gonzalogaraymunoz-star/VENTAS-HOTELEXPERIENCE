import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Boxes, Building2, CheckCircle2, Plus, X } from 'lucide-react';
import { arrivalPriority, createSale, loadLeadPassengers, requestPartner, stayLength } from '../lib/sales';
import { clp, economics, resolveProductPrice } from '../lib/money';
import { confirmReservation, reservationMissing, updateReservationDraft, type ReservationDraftInput } from '../lib/reservationSales';
import type { HotelPartner, Lead, LeadService, PassengerDraft, Product, Profile, SellerProfile, ServiceDraft, Supplier } from '../types';
import { ProductWorkspace } from './SalesWorkspaces';
import './ReservationIntakeForm.css';

const channels = ['Recepción', 'QR Hotel', 'Base de datos hotel', 'Web', 'Campaña', 'Email', 'Vendedor', 'Venta directa', 'Otro'];

function blankPassenger(primary: boolean): PassengerDraft {
  return {
    full_name: '', email: '', phone: '', nationality: '', document_type: 'Pasaporte',
    document_number: '', birth_date: '', dietary_restrictions: '', is_primary: primary,
  };
}

function hiddenHotelPct(service: LeadService) {
  const margin = Number(service.margen_comercial || 0);
  if (margin > 0 && Number(service.comision_hotel || 0) >= 0) return (Number(service.comision_hotel || 0) / margin) * 100;
  return 15;
}

function hiddenSellerPct(service: LeadService) {
  const margin = Number(service.margen_comercial || 0);
  if (margin > 0 && Number(service.comision_vendedor || 0) >= 0) return (Number(service.comision_vendedor || 0) / margin) * 100;
  return 5;
}

function serviceToDraft(service: LeadService): ServiceDraft {
  const pax = Math.max(1, Number(service.numero_pax || 1));
  const total = Number(service.precio_total ?? service.precio_venta ?? 0);
  return {
    product_id: service.product_catalog_id || '',
    product_code: service.tour_id || '',
    product_name: service.producto || '',
    category: service.service_type || 'Servicio',
    date: service.fecha_servicio || '',
    start_time: service.hora_inicio ? String(service.hora_inicio).slice(0, 5) : '',
    pax,
    modality: service.modality || 'manual',
    unit_price: Number(service.precio_unitario ?? (pax ? total / pax : total) ?? 0),
    operator_cost: Number(service.costo_operador_total || 0),
    supplier_id: service.proposed_supplier_id || '',
    supplier_name: '',
    hotel_commission_pct: hiddenHotelPct(service),
    seller_commission_pct: hiddenSellerPct(service),
    notes: service.observacion || '',
  };
}

function taxLabel(product?: Product) {
  if (!product) return 'Ítem manual';
  if (product.tax_treatment === 'exempt') return 'Exento';
  if (product.tax_treatment === 'taxable') return product.tax_rate != null ? `Afecto ${product.tax_rate}%` : 'Afecto';
  return 'Tributación por definir';
}

export default function ReservationIntakeForm({
  profile, hotels, products, suppliers, sellers, leads, services, initialLeadId, initialProductId, onSaved, onConfirmed,
}: {
  profile: Profile;
  hotels: HotelPartner[];
  products: Product[];
  suppliers: Supplier[];
  sellers: SellerProfile[];
  leads: Lead[];
  services: LeadService[];
  initialLeadId?: string;
  initialProductId?: string;
  onSaved: () => Promise<void>;
  onConfirmed: () => Promise<void>;
}) {
  const existingLead = useMemo(() => leads.find(lead => lead.id === initialLeadId) || null, [leads, initialLeadId]);
  const availableSellers = useMemo(
    () => profile.role === 'agent' ? sellers.filter(seller => seller.id === profile.id) : sellers,
    [sellers, profile.id, profile.role],
  );

  const [leadId, setLeadId] = useState(initialLeadId || '');
  const [leadCode, setLeadCode] = useState(existingLead?.codigo || '');
  const [hotelId, setHotelId] = useState(existingLead?.hotel_partner_id || hotels[0]?.id || '');
  const [channel, setChannel] = useState(existingLead?.canal || 'Recepción');
  const [checkin, setCheckin] = useState(existingLead?.checkin || '');
  const [checkout, setCheckout] = useState(existingLead?.checkout || '');
  const [contact, setContact] = useState(existingLead?.contacto || '');
  const [nationality, setNationality] = useState(existingLead?.nationality || '');
  const [stayDays, setStayDays] = useState<number | null>(existingLead?.stay_days ?? stayLength(existingLead?.checkin, existingLead?.checkout));
  const [sellerProfileId, setSellerProfileId] = useState(existingLead?.assigned_to || profile.id);
  const [notes, setNotes] = useState((existingLead as any)?.observaciones_cobros || '');
  const [passengers, setPassengers] = useState<PassengerDraft[]>([blankPassenger(true)]);
  const [draftServices, setDraftServices] = useState<ServiceDraft[]>(
    initialLeadId ? services.filter(service => service.lead_id === initialLeadId && service.booking_status === 'quoted').map(serviceToDraft) : [],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMessage, setPartnerMessage] = useState('');
  const [partnerDraft, setPartnerDraft] = useState({ name: '', partnerType: 'hotel', leadPrefix: '', contactName: '', email: '', phone: '', notes: '' });

  const priority = arrivalPriority(checkin);

  useEffect(() => {
    if (!hotelId && hotels[0]) setHotelId(hotels[0].id);
  }, [hotels, hotelId]);

  useEffect(() => {
    if (!availableSellers.some(seller => seller.id === sellerProfileId) && availableSellers[0]) setSellerProfileId(availableSellers[0].id);
  }, [availableSellers, sellerProfileId]);

  useEffect(() => {
    const calculated = stayLength(checkin, checkout);
    if (calculated != null) setStayDays(calculated);
  }, [checkin, checkout]);

  useEffect(() => {
    if (!initialLeadId) return;
    let alive = true;
    void loadLeadPassengers(initialLeadId).then(rows => {
      if (!alive) return;
      if (!rows.length) return;
      setPassengers(rows.map((row: any, index: number) => ({
        full_name: row.full_name === 'Cliente por completar' ? '' : row.full_name || '',
        email: row.email || '',
        phone: row.phone || '',
        nationality: row.nationality || (index === 0 ? existingLead?.nationality || '' : ''),
        document_type: row.document_type || 'Pasaporte',
        document_number: row.document_number || '',
        birth_date: row.birth_date || '',
        dietary_restrictions: row.dietary_restrictions || '',
        is_primary: index === 0 || Boolean(row.is_primary),
      })));
    }).catch((error: any) => setMessage(error?.message || 'No se pudieron cargar los pasajeros.'));
    return () => { alive = false; };
  }, [initialLeadId]);

  function addProductById(id: string) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    const pax = Math.max(1, passengers.length);
    const known = resolveProductPrice(product, pax);
    setDraftServices(current => [...current, {
      product_id: product.id,
      product_code: product.code,
      product_name: product.name,
      category: product.category,
      date: '',
      start_time: '',
      pax,
      modality: product.price_mode,
      unit_price: known ?? 0,
      operator_cost: 0,
      supplier_id: '',
      supplier_name: '',
      hotel_commission_pct: 15,
      seller_commission_pct: 5,
      notes: '',
    }]);
  }

  useEffect(() => {
    if (initialProductId && !draftServices.some(service => service.product_id === initialProductId)) addProductById(initialProductId);
  }, [initialProductId]);

  function addManualItem() {
    setDraftServices(current => [...current, {
      product_id: '', product_code: 'MANUAL', product_name: '', category: 'Manual', date: '', start_time: '',
      pax: 1, modality: 'manual', unit_price: 0, operator_cost: 0, supplier_id: '', supplier_name: '',
      hotel_commission_pct: 15, seller_commission_pct: 5, notes: '',
    }]);
  }

  function patchPassenger(index: number, patch: Partial<PassengerDraft>) {
    setPassengers(current => current.map((passenger, row) => row === index ? { ...passenger, ...patch } : passenger));
  }

  function patchService(index: number, patch: Partial<ServiceDraft>) {
    setDraftServices(current => current.map((service, row) => row === index ? { ...service, ...patch } : service));
  }

  function currentInput(): ReservationDraftInput {
    return {
      hotelPartnerId: hotelId,
      channel,
      priority,
      checkin,
      checkout,
      contact,
      nationality,
      stayDays,
      sellerProfileId,
      passengers,
      services: draftServices,
      notes,
    };
  }

  const missing = reservationMissing(currentInput());
  const ready = missing.length === 0;
  const total = draftServices.reduce((sum, service) => sum + Number(service.unit_price || 0) * Math.max(1, Number(service.pax || 1)), 0);

  async function persistDraft(silent = false) {
    const input = currentInput();
    if (leadId) {
      const result = await updateReservationDraft(leadId, input);
      setLeadCode(result.lead_code);
      if (!silent) setMessage('Información guardada. La reserva sigue sin confirmar.');
      await onSaved();
      return leadId;
    }

    const result = await createSale({
      hotelPartnerId: input.hotelPartnerId,
      channel: input.channel,
      priority: input.priority,
      checkin: input.checkin,
      checkout: input.checkout,
      contact: input.contact,
      nationality: input.nationality,
      stayDays: input.stayDays,
      sellerProfileId: input.sellerProfileId,
      passengers: input.passengers,
      services: input.services,
      notes: input.notes,
    }, false);
    setLeadId(result.lead_id);
    setLeadCode(result.lead_code);
    if (!silent) setMessage(`Ingreso ${result.lead_code} guardado. La reserva sigue sin confirmar.`);
    await onSaved();
    return result.lead_id;
  }

  async function save() {
    setBusy(true); setMessage('');
    try { await persistDraft(false); }
    catch (error: any) { setMessage(error?.message || 'No fue posible guardar la información.'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!ready) return;
    setBusy(true); setMessage('');
    try {
      const id = await persistDraft(true);
      await confirmReservation(id);
      setMessage('Reserva confirmada. El mismo registro ya quedó disponible en Operaciones.');
      await onConfirmed();
    } catch (error: any) {
      setMessage(error?.message || 'No fue posible confirmar la reserva.');
    } finally { setBusy(false); }
  }

  async function submitPartner() {
    setPartnerBusy(true); setPartnerMessage('');
    try {
      const result = await requestPartner({
        sellerProfileId,
        name: partnerDraft.name,
        partnerType: partnerDraft.partnerType,
        leadPrefix: partnerDraft.leadPrefix,
        contactName: partnerDraft.contactName,
        email: partnerDraft.email,
        phone: partnerDraft.phone,
        notes: partnerDraft.notes,
      });
      setPartnerMessage(`${result.name} quedó enviado a aprobación.`);
      setPartnerDraft({ name: '', partnerType: 'hotel', leadPrefix: '', contactName: '', email: '', phone: '', notes: '' });
    } catch (error: any) {
      setPartnerMessage(error?.message || 'No se pudo enviar la solicitud.');
    } finally { setPartnerBusy(false); }
  }

  return <div className="screen-stack sale-builder reservation-intake">
    <section className="page-heading sticky-title">
      <div>
        <p className="eyebrow">INGRESO DE INFORMACIÓN</p>
        <h1>{leadCode ? `${leadCode} · completar ingreso` : 'Registrar primero. Confirmar reserva al final.'}</h1>
        <p className="muted">Puedes guardar información parcial. Nada pasa a Operaciones hasta que el botón final “Confirmar reserva” quede habilitado y lo presiones.</p>
      </div>
      <button className="button ghost" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar información'}</button>
    </section>

    <section className="builder-section">
      <SectionNumber n="01" title="Origen y estadía" text="La prioridad se calcula automáticamente según los días que faltan para el arribo."/>
      <div className="form-grid four">
        <label>Hotel / negocio<div className="inline-field-action"><select value={hotelId} onChange={event => setHotelId(event.target.value)}><option value="">Seleccionar…</option>{hotels.map(hotel => <option key={hotel.id} value={hotel.id}>{hotel.name} · {hotel.lead_prefix || 'sin prefijo'}</option>)}</select><button type="button" className="button ghost" onClick={() => setPartnerOpen(true)}><Building2 size={15}/> Ingresar</button></div></label>
        <label>Canal<select value={channel} onChange={event => setChannel(event.target.value)}>{channels.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Vendedor responsable<select value={sellerProfileId} onChange={event => setSellerProfileId(event.target.value)}><option value="">Seleccionar…</option>{availableSellers.map(seller => <option key={seller.id} value={seller.id}>{seller.full_name || seller.email}</option>)}</select></label>
        <label>Prioridad automática<input readOnly value={priority}/></label>
      </div>
      <div className="form-grid five">
        <label>Contacto principal<input value={contact} onChange={event => setContact(event.target.value)} placeholder="Teléfono, email o ambos"/></label>
        <label>Arribo / check-in<input type="date" value={checkin} onChange={event => setCheckin(event.target.value)}/></label>
        <label>Salida / check-out<input type="date" value={checkout} onChange={event => setCheckout(event.target.value)}/></label>
        <label>Nacionalidad<input value={nationality} onChange={event => { setNationality(event.target.value); patchPassenger(0, { nationality: event.target.value }); }} placeholder="Ej. Brasil"/></label>
        <label>Días de estadía<input type="number" min="0" value={stayDays ?? ''} onChange={event => setStayDays(event.target.value === '' ? null : Math.max(0, Number(event.target.value)))}/></label>
      </div>
    </section>

    <section className="builder-section">
      <div className="section-title-row"><SectionNumber n="02" title="Cliente y acompañantes" text="El ingreso puede guardarse incompleto. Para confirmar la reserva se necesita el nombre y una vía de contacto del cliente principal."/><button className="button ghost" onClick={() => setPassengers(current => [...current, blankPassenger(false)])}><Plus size={16}/> Acompañante</button></div>
      <div className="passenger-stack">{passengers.map((passenger, index) => <article className="passenger-row" key={index}>
        <div className="passenger-index"><span>{index === 0 ? 'CLIENTE' : 'ACOMPAÑANTE'}</span><strong>P{String(index + 1).padStart(2, '0')}</strong></div>
        <div className="form-grid passenger-fields">
          <label>Nombre completo<input value={passenger.full_name} onChange={event => patchPassenger(index, { full_name: event.target.value })} placeholder={index === 0 ? 'Necesario para confirmar' : 'Puede completarse después'}/></label>
          <label>Email<input type="email" value={passenger.email} onChange={event => patchPassenger(index, { email: event.target.value })}/></label>
          <label>Teléfono<input value={passenger.phone} onChange={event => patchPassenger(index, { phone: event.target.value })}/></label>
          <label>Nacionalidad<input value={passenger.nationality} onChange={event => { patchPassenger(index, { nationality: event.target.value }); if (index === 0) setNationality(event.target.value); }}/></label>
          <label>Documento<input value={passenger.document_number} onChange={event => patchPassenger(index, { document_number: event.target.value })}/></label>
          <label>Nacimiento<input type="date" value={passenger.birth_date} onChange={event => patchPassenger(index, { birth_date: event.target.value })}/></label>
        </div>
        {index > 0 && <button className="icon-button danger" onClick={() => setPassengers(current => current.filter((_, row) => row !== index))}><X size={17}/></button>}
      </article>)}</div>
    </section>

    <section className="builder-section">
      <div className="section-title-row"><SectionNumber n="03" title="Productos e ítems" text="Agrega productos del catálogo o un ítem manual con su precio de venta."/><div className="top-actions"><button className="button ghost" onClick={addManualItem}><Plus size={16}/> Ítem manual</button><button className="button dark" onClick={() => setCatalogOpen(true)}><Boxes size={16}/> Seleccionar productos</button></div></div>
      {!draftServices.length ? <div className="empty-state">Puedes guardar el ingreso sin productos. Para confirmar la reserva necesitarás al menos uno.</div> : <div className="service-stack">{draftServices.map((service, index) => {
        const calc = economics(service.unit_price, service.pax, service.operator_cost, service.hotel_commission_pct, service.seller_commission_pct);
        const product = products.find(item => item.id === service.product_id);
        const manual = !service.product_id;
        return <article className="service-card" key={`${service.product_id || 'manual'}-${index}`}>
          <header><div><span className="product-code">{manual ? 'MANUAL' : service.product_code}</span>{manual ? <input value={service.product_name} onChange={event => patchService(index, { product_name: event.target.value })} placeholder="Nombre del ítem / servicio"/> : <h3>{service.product_name}</h3>}<p>{service.category} · {service.modality} · {taxLabel(product)}</p></div><button className="icon-button danger" onClick={() => setDraftServices(current => current.filter((_, row) => row !== index))}><X size={17}/></button></header>
          <div className="form-grid five">
            <label>Fecha del servicio<input type="date" value={service.date} onChange={event => patchService(index, { date: event.target.value })}/></label>
            <label>Hora<input type="time" value={service.start_time} onChange={event => patchService(index, { start_time: event.target.value })}/></label>
            <label>Pax / cantidad<input type="number" min="1" value={service.pax} onChange={event => patchService(index, { pax: Math.max(1, Number(event.target.value || 1)) })}/></label>
            <label>Precio venta p/u<input type="number" min="0" value={service.unit_price} onChange={event => patchService(index, { unit_price: Number(event.target.value || 0) })}/></label>
            <label>Costo operador total<input type="number" min="0" value={service.operator_cost} onChange={event => patchService(index, { operator_cost: Number(event.target.value || 0) })}/></label>
          </div>
          <div className="form-grid two"><label>Operador propuesto<select value={service.supplier_id} onChange={event => { const supplier = suppliers.find(item => item.id === event.target.value); patchService(index, { supplier_id: event.target.value, supplier_name: supplier?.name || '' }); }}><option value="">Por definir</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Observaciones<input value={service.notes} onChange={event => patchService(index, { notes: event.target.value })} placeholder="Información útil para la reserva"/></label></div>
          <div className="reservation-economics"><div><span>Venta</span><strong>{clp(calc.total)}</strong></div><div><span>Costo operador</span><strong>{clp(calc.cost)}</strong></div><div><span>Margen</span><strong className={calc.margin < 0 ? 'negative' : ''}>{clp(calc.margin)}</strong></div></div>
        </article>;
      })}</div>}
    </section>

    <section className="builder-section reservation-confirm-section">
      <SectionNumber n="04" title="Confirmación de reserva" text="Este es el único punto que envía la reserva a Operaciones. Se usa el mismo cliente, los mismos pasajeros y los mismos productos ya ingresados."/>
      <label>Observaciones generales<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Acuerdos, condiciones o información pendiente…"/></label>
      {message && <div className={message.includes('confirmada') || message.includes('guardad') ? 'success-box' : 'error-box'}>{message}</div>}
      <div className={`reservation-gate ${ready ? 'ready' : ''}`}>
        <div><span>{ready ? 'LISTO PARA CONFIRMAR' : 'RESERVA AÚN NO CONFIRMABLE'}</span><strong>{ready ? 'La información mínima está completa.' : `Falta: ${missing.join(' · ')}`}</strong><small>Guardar información no activa Operaciones.</small></div>
        <div className="reservation-gate-total"><span>Total venta</span><strong>{clp(total)}</strong></div>
      </div>
      <div className="closing-bar">
        <div><span>{passengers.length} persona(s)</span><span>{draftServices.length} producto(s)</span><strong>{leadCode || 'Ingreso nuevo'}</strong></div>
        <div className="top-actions"><button className="button ghost big" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar información'}</button><button className="button dark big" disabled={busy || !ready} onClick={() => void confirm()}>{busy ? 'Procesando…' : 'Confirmar reserva'} <ArrowRight size={17}/></button></div>
      </div>
    </section>

    {catalogOpen && <div className="quote-overlay"><div className="quote-overlay-panel"><header className="quote-overlay-head"><div><p className="eyebrow">SELECCIÓN DE PRODUCTOS</p><strong>{draftServices.length} agregado(s)</strong></div><button className="button dark" onClick={() => setCatalogOpen(false)}>Volver al ingreso <X size={16}/></button></header><div className="quote-overlay-body"><ProductWorkspace products={products} onQuote={addProductById}/></div><footer className="quote-overlay-footer"><span>{draftServices.length} producto(s) seleccionados</span><button className="button dark big" onClick={() => setCatalogOpen(false)}>Continuar <ArrowRight size={16}/></button></footer></div></div>}

    {partnerOpen && <div className="quote-overlay"><div className="partner-request-panel"><header className="quote-overlay-head"><div><p className="eyebrow">NUEVO HOTEL / NEGOCIO</p><strong>Solicitud de incorporación</strong></div><button className="icon-button" onClick={() => setPartnerOpen(false)}><X size={19}/></button></header><div className="partner-request-body"><div className="form-grid two"><label>Nombre<input value={partnerDraft.name} onChange={event => setPartnerDraft(value => ({ ...value, name: event.target.value }))}/></label><label>Tipo<select value={partnerDraft.partnerType} onChange={event => setPartnerDraft(value => ({ ...value, partnerType: event.target.value }))}><option value="hotel">Hotel</option><option value="agency">Agencia</option><option value="business">Negocio</option><option value="other">Otro</option></select></label></div><div className="form-grid two"><label>Prefijo<input maxLength={5} value={partnerDraft.leadPrefix} onChange={event => setPartnerDraft(value => ({ ...value, leadPrefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}/></label><label>Vendedor responsable<select value={sellerProfileId} onChange={event => setSellerProfileId(event.target.value)}>{availableSellers.map(seller => <option key={seller.id} value={seller.id}>{seller.full_name || seller.email}</option>)}</select></label></div><div className="form-grid three"><label>Contacto<input value={partnerDraft.contactName} onChange={event => setPartnerDraft(value => ({ ...value, contactName: event.target.value }))}/></label><label>Email<input value={partnerDraft.email} onChange={event => setPartnerDraft(value => ({ ...value, email: event.target.value }))}/></label><label>Teléfono<input value={partnerDraft.phone} onChange={event => setPartnerDraft(value => ({ ...value, phone: event.target.value }))}/></label></div><label>Observaciones<textarea value={partnerDraft.notes} onChange={event => setPartnerDraft(value => ({ ...value, notes: event.target.value }))}/></label>{partnerMessage && <div className={partnerMessage.includes('aprobación') ? 'success-box' : 'error-box'}>{partnerMessage}</div>}<button className="button dark wide big" disabled={partnerBusy || !partnerDraft.name || partnerDraft.leadPrefix.length < 2 || !sellerProfileId} onClick={() => void submitPartner()}>{partnerBusy ? 'Enviando…' : 'Enviar solicitud'} <ArrowRight size={16}/></button></div></div></div>}
  </div>;
}

function SectionNumber({ n, title, text }: { n: string; title: string; text: string }) {
  return <div className="section-number"><span>{n}</span><div><h2>{title}</h2><p>{text}</p></div></div>;
}
