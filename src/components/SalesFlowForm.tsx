import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Boxes, Building2, Check, CheckCircle2, Copy, Download, FileText, Mail,
  Plus, Send, Users, X,
} from 'lucide-react';
import { arrivalPriority, createSale, loadLeadPassengers, requestPartner, stayLength } from '../lib/sales';
import { clp, economics, resolveProductPrice } from '../lib/money';
import { confirmReservation, updateReservationDraft, type ReservationDraftInput } from '../lib/reservationSales';
import {
  createQuoteSnapshot, itineraryText, loadLatestQuote, markQuoteStatus, sendItineraryEmail,
  sharePaymentLink, updateSalesFlow,
} from '../lib/salesFlow';
import { concisePolicy, downloadCustomerQuote, shareCustomerQuote } from '../lib/customerQuote';
import type {
  HotelPartner, Lead, LeadService, PassengerDraft, Product, Profile, SalesQuoteSnapshot,
  SellerProfile, ServiceDraft, Supplier,
} from '../types';
import { ProductWorkspace } from './SalesWorkspaces';
import './SalesFlowForm.css';

const channels = ['Recepción', 'QR Hotel', 'Base de datos hotel', 'Web', 'Campaña', 'Email', 'Vendedor', 'Venta directa', 'Otro'];
const steps = [
  ['01', 'Cotización e ingreso'],
  ['02', 'Datos y pax'],
  ['03', 'Carta cotización'],
  ['04', 'Aceptación y pago'],
  ['05', 'Itinerario cliente'],
  ['06', 'Completar reserva'],
] as const;

function blankPassenger(primary: boolean): PassengerDraft {
  return {
    full_name: '', email: '', phone: '', nationality: '', document_type: 'Pasaporte',
    document_number: '', birth_date: '', dietary_restrictions: '', medical_notes: '', is_primary: primary,
  };
}

function serviceToDraft(service: LeadService): ServiceDraft {
  const pax = Math.max(1, Number(service.numero_pax || 1));
  const total = Number(service.precio_total ?? service.precio_venta ?? 0);
  const margin = Number(service.margen_comercial || 0);
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
    hotel_commission_pct: margin > 0 ? (Number(service.comision_hotel || 0) / margin) * 100 : 0,
    seller_commission_pct: margin > 0 ? (Number(service.comision_vendedor || 0) / margin) * 100 : 0,
    notes: service.observacion || '',
  };
}

function modeLabel(mode: string) {
  const value = mode.toLowerCase();
  if (value.includes('semi')) return 'Semi privado';
  if (value.includes('private')) return 'Privado';
  if (value.includes('regular')) return 'Regular';
  if (value.includes('fixed')) return 'Servicio dedicado';
  return 'Personalizado';
}

function tierSummary(product: Product | undefined, pax: number, unitPrice: number) {
  if (!product) return `Tarifa manual · ${clp(unitPrice)} por persona`;
  if (product.price_mode.includes('private')) {
    const tiers = Object.entries(product.prices || {})
      .filter(([key, value]) => /^\d+$/.test(key) && Number(value) > 0)
      .sort(([a], [b]) => Number(a) - Number(b));
    const selected = tiers.find(([key]) => Number(key) === pax);
    return selected ? `Tramo ${pax} pax · ${clp(Number(selected[1]))} por persona` : `Tramo ${pax} pax · tarifa manual`;
  }
  if (product.price_mode.includes('regular')) return `Tarifa regular · ${clp(unitPrice)} por persona`;
  if (product.price_mode.includes('fixed')) return `Tarifa por servicio · ${clp(unitPrice)}`;
  return `Tarifa aplicada · ${clp(unitPrice)}`;
}

function stageToStep(stage?: string | null) {
  if (stage === 'completed') return 5;
  if (stage === 'ready_to_complete' || stage === 'itinerary_sent') return 5;
  if (stage === 'accepted_payment' || stage === 'payment_link_sent') return 3;
  if (stage === 'quote_sent' || stage === 'quote_ready') return 2;
  if (stage === 'data_capture') return 1;
  return 0;
}

export default function SalesFlowForm({
  profile, hotels, products, suppliers, sellers, leads, services, initialLeadId, initialProductId,
  operationsUrl, onSaved, onCompleted,
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
  operationsUrl?: string;
  onSaved: () => Promise<void>;
  onCompleted: () => Promise<void>;
}) {
  const existingLead = useMemo(() => leads.find(lead => lead.id === initialLeadId) || null, [leads, initialLeadId]);
  const availableSellers = useMemo(
    () => profile.role === 'agent' ? sellers.filter(seller => seller.id === profile.id) : sellers,
    [sellers, profile.id, profile.role],
  );

  const [activeStep, setActiveStep] = useState(() => stageToStep(existingLead?.sales_stage));
  const [leadId, setLeadId] = useState(initialLeadId || '');
  const [leadCode, setLeadCode] = useState(existingLead?.codigo || '');
  const [reference, setReference] = useState(existingLead?.reservation_reference || '');
  const [paxCount, setPaxCount] = useState(Math.max(1, Number(existingLead?.numero_pax || 1)));
  const [hotelId, setHotelId] = useState(existingLead?.hotel_partner_id || hotels[0]?.id || '');
  const [channel, setChannel] = useState(existingLead?.canal || 'Recepción');
  const [sellerProfileId, setSellerProfileId] = useState(existingLead?.assigned_to || profile.id);
  const [checkin, setCheckin] = useState(existingLead?.checkin || '');
  const [checkout, setCheckout] = useState(existingLead?.checkout || '');
  const [contact, setContact] = useState(existingLead?.contacto || '');
  const [nationality, setNationality] = useState(existingLead?.nationality || '');
  const [stayDays, setStayDays] = useState<number | null>(existingLead?.stay_days ?? stayLength(existingLead?.checkin, existingLead?.checkout));
  const [notes, setNotes] = useState(existingLead?.observaciones_cobros || '');
  const [arrivalFlight, setArrivalFlight] = useState(existingLead?.arrival_flight_number || '');
  const [departureFlight, setDepartureFlight] = useState(existingLead?.departure_flight_number || '');
  const [pickupLocation, setPickupLocation] = useState(existingLead?.pickup_location || '');
  const [hotelRoom, setHotelRoom] = useState(existingLead?.hotel_room || '');
  const [paymentLink, setPaymentLink] = useState(existingLead?.payment_link || '');
  const [passengers, setPassengers] = useState<PassengerDraft[]>(() => Array.from({ length: Math.max(1, Number(existingLead?.numero_pax || 1)) }, (_, index) => blankPassenger(index === 0)));
  const [draftServices, setDraftServices] = useState<ServiceDraft[]>(
    initialLeadId ? services.filter(service => service.lead_id === initialLeadId && service.booking_status === 'quoted').map(serviceToDraft) : [],
  );
  const [quote, setQuote] = useState<SalesQuoteSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMessage, setPartnerMessage] = useState('');
  const [partnerDraft, setPartnerDraft] = useState({ name: '', partnerType: 'hotel', leadPrefix: '', contactName: '', email: '', phone: '', notes: '' });

  const priority = arrivalPriority(checkin);
  const hotel = hotels.find(item => item.id === hotelId);
  const currentLead = leads.find(item => item.id === leadId) || existingLead;
  const quoteAccepted = quote?.status === 'accepted' || Boolean(currentLead?.quote_accepted_at);
  const quoteSent = ['sent', 'accepted'].includes(String(quote?.status || '')) || Boolean(currentLead?.quote_sent_at);
  const paymentSent = Boolean(currentLead?.payment_link_sent_at);
  const itinerarySent = Boolean(currentLead?.itinerary_sent_at);

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
    setPassengers(current => Array.from({ length: paxCount }, (_, index) => ({
      ...(current[index] || blankPassenger(index === 0)),
      is_primary: index === 0,
    })));
  }, [paxCount]);

  useEffect(() => {
    if (!initialLeadId) return;
    let alive = true;
    void Promise.all([loadLeadPassengers(initialLeadId), loadLatestQuote(initialLeadId)]).then(([rows, latest]) => {
      if (!alive) return;
      if (rows.length) {
        setPaxCount(Math.max(1, rows.length));
        setPassengers(rows.map((row: any, index: number) => ({
          full_name: /^Cliente por completar$|^Acompañante \d+$/i.test(String(row.full_name || '')) ? '' : row.full_name || '',
          email: row.email || '', phone: row.phone || '',
          nationality: row.nationality || (index === 0 ? existingLead?.nationality || '' : ''),
          document_type: row.document_type || 'Pasaporte', document_number: row.document_number || '',
          birth_date: row.birth_date || '', dietary_restrictions: row.dietary_restrictions || '',
          medical_notes: row.medical_notes || '', is_primary: index === 0,
        })));
      }
      setQuote(latest);
    }).catch((error: any) => setMessage(error?.message || 'No se pudo cargar el ingreso.'));
    return () => { alive = false; };
  }, [initialLeadId]);

  function addProductById(id: string) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    const known = resolveProductPrice(product, paxCount);
    setDraftServices(current => [...current, {
      product_id: product.id, product_code: product.code, product_name: product.name, category: product.category,
      date: '', start_time: '', pax: paxCount, modality: product.price_mode, unit_price: known ?? 0,
      operator_cost: 0, supplier_id: '', supplier_name: '', hotel_commission_pct: 0, seller_commission_pct: 0, notes: '',
    }]);
    setCatalogOpen(false);
  }

  useEffect(() => {
    if (initialProductId && !draftServices.some(service => service.product_id === initialProductId)) addProductById(initialProductId);
  }, [initialProductId]);

  function addManualItem() {
    setDraftServices(current => [...current, {
      product_id: '', product_code: 'MANUAL', product_name: '', category: 'Manual', date: '', start_time: '',
      pax: paxCount, modality: 'manual', unit_price: 0, operator_cost: 0, supplier_id: '', supplier_name: '',
      hotel_commission_pct: 0, seller_commission_pct: 0, notes: '',
    }]);
  }

  function patchPassenger(index: number, patch: Partial<PassengerDraft>) {
    setPassengers(current => current.map((passenger, row) => row === index ? { ...passenger, ...patch } : passenger));
  }
  function patchService(index: number, patch: Partial<ServiceDraft>) {
    setDraftServices(current => current.map((service, row) => row === index ? { ...service, ...patch } : service));
  }

  function draftInput(): ReservationDraftInput {
    return {
      hotelPartnerId: hotelId, channel, priority, checkin, checkout, contact, nationality, stayDays,
      sellerProfileId, passengers, services: draftServices, notes,
    };
  }

  function metadata(stage?: string) {
    return {
      reservation_reference: reference,
      sales_stage: stage || currentLead?.sales_stage || 'data_capture',
      payment_link: paymentLink,
      arrival_flight_number: arrivalFlight,
      departure_flight_number: departureFlight,
      pickup_location: pickupLocation,
      hotel_room: hotelRoom,
      passengers,
    };
  }

  async function persist(stage = 'data_capture', silent = false) {
    const input = draftInput();
    if (!reference.trim()) throw new Error('Agrega un nombre de referencia para la reserva.');
    if (!(paxCount > 0)) throw new Error('El número de pax debe ser mayor que cero.');
    if (!hotelId) throw new Error('Selecciona el hotel / negocio de origen.');
    if (!sellerProfileId) throw new Error('Selecciona el responsable de la venta.');
    const identity = input.contact.trim() || input.passengers[0]?.full_name?.trim() || input.passengers[0]?.email?.trim() || input.passengers[0]?.phone?.trim();
    if (!identity) throw new Error('Para guardar el ingreso necesitamos al menos nombre, teléfono o email del cliente principal.');

    let id = leadId;
    if (id) {
      await updateReservationDraft(id, input);
    } else {
      const created = await createSale({
        hotelPartnerId: input.hotelPartnerId, channel: input.channel, priority: input.priority,
        checkin: input.checkin, checkout: input.checkout, contact: input.contact, nationality: input.nationality,
        stayDays: input.stayDays, sellerProfileId: input.sellerProfileId, passengers: input.passengers,
        services: input.services, notes: input.notes,
      }, false);
      id = created.lead_id; setLeadId(created.lead_id); setLeadCode(created.lead_code);
      await updateReservationDraft(id, input);
    }
    await updateSalesFlow(id, { ...metadata(stage), sales_stage: stage });
    if (!silent) setMessage(`Ingreso ${leadCode || reference} guardado sin enviar a Operaciones.`);
    await onSaved();
    return id;
  }

  async function saveAndNext() {
    setBusy(true); setMessage('');
    try { await persist(activeStep === 0 ? 'data_capture' : undefined as any); setActiveStep(step => Math.min(5, step + 1)); }
    catch (error: any) { setMessage(error?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }

  async function generateQuote() {
    setBusy(true); setMessage('');
    try {
      const id = await persist('data_capture', true);
      const generated = await createQuoteSnapshot(id);
      setQuote(generated); setActiveStep(2);
      downloadCustomerQuote(generated, { hotelName: hotel?.name, clientName: passengers[0]?.full_name || reference });
      setMessage(`${generated.quote_code} creada desde este mismo ingreso.`);
      await onSaved();
    } catch (error: any) { setMessage(error?.message || 'No se pudo crear la cotización.'); }
    finally { setBusy(false); }
  }

  async function shareQuote() {
    if (!quote) return;
    setBusy(true); setMessage('');
    try {
      const result = await shareCustomerQuote(quote, { hotelName: hotel?.name, clientName: passengers[0]?.full_name || reference });
      if (result === 'shared') {
        await markQuoteStatus(quote.id, 'sent');
        setQuote({ ...quote, status: 'sent' });
        setMessage('Cotización compartida y registrada como enviada.');
        await onSaved();
      } else setMessage('PDF descargado. Aún no se marcó como enviado al cliente.');
    } catch (error: any) {
      if (error?.name !== 'AbortError') setMessage(error?.message || 'No se pudo compartir la cotización.');
    } finally { setBusy(false); }
  }

  async function markSent() {
    if (!quote) return;
    setBusy(true); setMessage('');
    try { await markQuoteStatus(quote.id, 'sent'); setQuote({ ...quote, status: 'sent' }); await onSaved(); setMessage('Cotización registrada como enviada.'); }
    catch (error: any) { setMessage(error?.message || 'No se pudo registrar el envío.'); }
    finally { setBusy(false); }
  }

  async function acceptQuote() {
    if (!quote) return;
    setBusy(true); setMessage('');
    try { await markQuoteStatus(quote.id, 'accepted'); setQuote({ ...quote, status: 'accepted' }); setActiveStep(3); await onSaved(); setMessage('Aceptación registrada. Ahora corresponde pago y datos finales.'); }
    catch (error: any) { setMessage(error?.message || 'No se pudo registrar la aceptación.'); }
    finally { setBusy(false); }
  }

  async function sendPayment() {
    setBusy(true); setMessage('');
    try {
      const id = await persist('accepted_payment', true);
      const result = await sharePaymentLink(reference, paymentLink);
      await updateSalesFlow(id, { ...metadata('payment_link_sent'), mark_payment_link_sent: true });
      setMessage(result === 'shared' ? 'Link de pago compartido y registrado.' : 'Link copiado y registrado como entregado.');
      await onSaved();
    } catch (error: any) {
      if (error?.name !== 'AbortError') setMessage(error?.message || 'No se pudo compartir el link de pago.');
    } finally { setBusy(false); }
  }

  function itineraryBody() {
    const pseudoServices = draftServices.map((service, index) => ({
      id: `draft-${index}`, lead_id: leadId, producto: service.product_name, fecha_servicio: service.date,
      numero_pax: service.pax, observacion: service.notes, modality: service.modality,
      hora_inicio: service.start_time, moneda: 'CLP', estado_pago: 'Pendiente', estado_operacion: 'Pendiente', created_at: '',
    })) as LeadService[];
    return itineraryText({
      reference, leadCode, checkin, checkout, hotelName: hotel?.name, pickupLocation,
      arrivalFlight, departureFlight, passengers, services: pseudoServices,
    });
  }

  async function sendItinerary() {
    const primaryEmail = passengers[0]?.email || '';
    setBusy(true); setMessage('');
    try {
      const id = await persist('payment_link_sent', true);
      await sendItineraryEmail({
        operationsUrl: operationsUrl || '', to: primaryEmail,
        subject: `Itinerario confirmado · ${reference || leadCode}`,
        body: itineraryBody(), reference, leadCode,
      });
      await updateSalesFlow(id, { ...metadata('ready_to_complete'), mark_itinerary_sent: true, itinerary_sent_via: 'email' });
      setActiveStep(5); setMessage('Itinerario enviado al pasajero y registrado.'); await onSaved();
    } catch (error: any) { setMessage(error?.message || 'No se pudo enviar el itinerario.'); }
    finally { setBusy(false); }
  }

  async function markItineraryExternal() {
    if (!leadId) return;
    setBusy(true); setMessage('');
    try {
      await persist('payment_link_sent', true);
      await updateSalesFlow(leadId, { ...metadata('ready_to_complete'), mark_itinerary_sent: true, itinerary_sent_via: 'externo' });
      setActiveStep(5); setMessage('Envío externo del itinerario registrado.'); await onSaved();
    } catch (error: any) { setMessage(error?.message || 'No se pudo registrar el envío.'); }
    finally { setBusy(false); }
  }

  const finalMissing = useMemo(() => {
    const missing: string[] = [];
    if (!quoteAccepted) missing.push('aceptación de cotización');
    if (!paymentSent) missing.push('link de pago enviado');
    if (!itinerarySent) missing.push('itinerario enviado');
    if (!checkin) missing.push('arribo');
    if (!checkout) missing.push('salida');
    if (!passengers[0]?.email && !passengers[0]?.phone && !contact) missing.push('contacto principal');
    passengers.forEach((passenger, index) => { if (!passenger.full_name.trim()) missing.push(`nombre P${String(index + 1).padStart(2, '0')}`); });
    if (!draftServices.length) missing.push('producto');
    draftServices.forEach((service, index) => {
      if (!service.product_name.trim()) missing.push(`nombre ítem ${index + 1}`);
      if (!service.date) missing.push(`fecha ${service.product_name || index + 1}`);
      if (!(service.unit_price > 0)) missing.push(`precio ${service.product_name || index + 1}`);
    });
    return Array.from(new Set(missing));
  }, [quoteAccepted, paymentSent, itinerarySent, checkin, checkout, contact, passengers, draftServices]);

  async function completeReservation() {
    if (finalMissing.length) return;
    setBusy(true); setMessage('');
    try {
      const id = await persist('ready_to_complete', true);
      await confirmReservation(id);
      await updateSalesFlow(id, { ...metadata('completed'), mark_completed: true });
      setMessage('Reserva completada. El mismo registro quedó entregado a HOTEL EXPERIENCE Operaciones.');
      await onCompleted();
    } catch (error: any) { setMessage(error?.message || 'No se pudo completar la reserva.'); }
    finally { setBusy(false); }
  }

  async function submitPartner() {
    setPartnerBusy(true); setPartnerMessage('');
    try {
      const result = await requestPartner({ sellerProfileId, ...partnerDraft });
      setPartnerMessage(`${result.name} quedó enviado a aprobación.`);
    } catch (error: any) { setPartnerMessage(error?.message || 'No se pudo enviar la solicitud.'); }
    finally { setPartnerBusy(false); }
  }

  const total = draftServices.reduce((sum, service) => sum + Number(service.unit_price || 0) * Math.max(1, Number(service.pax || 1)), 0);
  const stageUnlocked = (index: number) => index <= 1 || (index === 2 && Boolean(leadId)) || (index === 3 && quoteAccepted) || (index === 4 && quoteAccepted && paymentSent) || (index === 5 && itinerarySent);

  return <div className="sales-flow">
    <section className="sales-flow-head">
      <div><p className="eyebrow">FLUJO ÚNICO · LINK VENTAS</p><h1>{reference || leadCode || 'Nueva cotización'}</h1><p>Cada paso actualiza el mismo ingreso. Solo “Completar reserva” entrega la información a Operaciones.</p></div>
      <div className="sales-flow-total"><span>Total actual</span><strong>{clp(total)}</strong><small>{paxCount} pax · {draftServices.length} producto(s)</small></div>
    </section>

    <nav className="sales-stepper" aria-label="Proceso comercial">
      {steps.map(([number, label], index) => <button key={number} className={`${activeStep === index ? 'active ' : ''}${stageUnlocked(index) ? '' : 'locked'}`} disabled={!stageUnlocked(index)} onClick={() => setActiveStep(index)}><span>{number}</span><strong>{label}</strong>{index < activeStep || (index === 2 && quoteSent) || (index === 3 && paymentSent) || (index === 4 && itinerarySent) ? <Check size={14}/> : null}</button>)}
    </nav>

    {message && <div className={/no se|falta|error/i.test(message) ? 'error-box' : 'success-box'}>{message}</div>}

    {activeStep === 0 && <section className="flow-card">
      <FlowTitle number="01" title="Cotización e ingreso" text="Origen, arribo y responsable. Aquí nace una sola referencia comercial para todo el proceso."/>
      <div className="form-grid four">
        <label>Nombre de referencia · obligatorio<input value={reference} onChange={event => setReference(event.target.value)} placeholder="Ej. Familia Silva / REIFKE X8"/></label>
        <label>Número de pax · obligatorio<input type="number" min="1" max="60" value={paxCount} onChange={event => setPaxCount(Math.max(1, Math.min(60, Number(event.target.value || 1))))}/></label>
        <label>Hotel / negocio<div className="inline-field-action"><select value={hotelId} onChange={event => setHotelId(event.target.value)}><option value="">Seleccionar…</option>{hotels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="button ghost" type="button" onClick={() => setPartnerOpen(true)}><Building2 size={14}/></button></div></label>
        <label>Vendedor responsable<select value={sellerProfileId} onChange={event => setSellerProfileId(event.target.value)}><option value="">Seleccionar…</option>{availableSellers.map(item => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}</select></label>
      </div>
      <div className="form-grid five">
        <label>Canal<select value={channel} onChange={event => setChannel(event.target.value)}>{channels.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Arribo<input type="date" value={checkin} onChange={event => setCheckin(event.target.value)}/></label>
        <label>Salida<input type="date" value={checkout} onChange={event => setCheckout(event.target.value)}/></label>
        <label>Días estadía<input type="number" min="0" value={stayDays ?? ''} onChange={event => setStayDays(event.target.value === '' ? null : Number(event.target.value))}/></label>
        <label>Prioridad<input readOnly value={priority}/></label>
      </div>
      <div className="form-grid two"><label>Contacto inicial<input value={contact} onChange={event => setContact(event.target.value)} placeholder="Teléfono o email"/></label><label>Nacionalidad<input value={nationality} onChange={event => { setNationality(event.target.value); patchPassenger(0, { nationality: event.target.value }); }}/></label></div>
      <AutoPaxPreview reference={reference} count={paxCount}/>
      <FlowActions busy={busy} onSave={() => void persist('data_capture')} onNext={() => void saveAndNext()} nextLabel="Guardar y comenzar datos"/>
    </section>}

    {activeStep === 1 && <section className="flow-card">
      <FlowTitle number="02" title="Datos y número de pax" text="Los pasajeros ya existen por número. Solo completas sus nombres y datos cuando los tengas; no vuelves a crearlos uno a uno."/>
      <div className="pax-auto-grid">{passengers.map((passenger, index) => <article key={index} className="pax-auto-card"><header><span>{reference || 'RESERVA'} · P{String(index + 1).padStart(2, '0')}</span><strong>{index === 0 ? 'Titular' : 'Acompañante'}</strong></header><div className="form-grid three"><label>Nombre<input value={passenger.full_name} onChange={event => patchPassenger(index, { full_name: event.target.value })} placeholder="Puede completarse después"/></label><label>Email<input type="email" value={passenger.email} onChange={event => patchPassenger(index, { email: event.target.value })}/></label><label>Teléfono<input value={passenger.phone} onChange={event => patchPassenger(index, { phone: event.target.value })}/></label></div></article>)}</div>
      <FlowActions busy={busy} onSave={() => void persist('data_capture')} onNext={async () => { setBusy(true); try { await persist('data_capture', true); setActiveStep(2); } catch (error: any) { setMessage(error?.message || 'No se pudo guardar.'); } finally { setBusy(false); } }} nextLabel="Armar cotización"/>
    </section>}

    {activeStep === 2 && <section className="flow-card">
      <div className="flow-title-row"><FlowTitle number="03" title="Carta de cotización" text="Productos y precios viven dentro del mismo ingreso. La carta toma de aquí fechas, modalidad, tramos y política vigente."/><div className="top-actions"><button className="button ghost" onClick={addManualItem}><Plus size={15}/> Ítem manual</button><button className="button dark" onClick={() => setCatalogOpen(true)}><Boxes size={15}/> Catálogo</button></div></div>
      {!draftServices.length ? <div className="empty-state">Agrega al menos un producto para crear la carta de cotización.</div> : <div className="quote-products">{draftServices.map((service, index) => {
        const product = products.find(item => item.id === service.product_id);
        const calc = economics(service.unit_price, service.pax, service.operator_cost, 0, 0);
        return <article key={`${service.product_id || 'manual'}-${index}`}><header><div><span>{modeLabel(service.modality)}</span>{service.product_id ? <h3>{service.product_name}</h3> : <input value={service.product_name} onChange={event => patchService(index, { product_name: event.target.value })} placeholder="Nombre del servicio"/>}<small>{tierSummary(product, service.pax, service.unit_price)}</small></div><button className="icon-button danger" onClick={() => setDraftServices(current => current.filter((_, row) => row !== index))}><X size={16}/></button></header><div className="form-grid four"><label>Fecha<input type="date" value={service.date} onChange={event => patchService(index, { date: event.target.value })}/></label><label>Modalidad<select value={service.modality} onChange={event => patchService(index, { modality: event.target.value })}><option value="private_per_pax">Privado</option><option value="semi_private">Semi privado</option><option value="regular_per_pax">Regular</option><option value="manual">Personalizado</option></select></label><label>Pax<input type="number" min="1" value={service.pax} onChange={event => patchService(index, { pax: Math.max(1, Number(event.target.value || 1)) })}/></label><label>Precio venta p/u<input type="number" min="0" value={service.unit_price} onChange={event => patchService(index, { unit_price: Number(event.target.value || 0) })}/></label></div><label>Información para el cliente<input value={service.notes} onChange={event => patchService(index, { notes: event.target.value })} placeholder="Horario, punto de encuentro, condiciones particulares…"/></label><div className="quote-product-total"><span>Total servicio</span><strong>{clp(calc.total)}</strong></div></article>;
      })}</div>}
      {quote && <section className="quote-document-status"><div><FileText size={20}/><span><strong>{quote.quote_code}</strong><small>Versión {quote.version} · {quote.status}</small></span></div><div className="quote-policy-mini"><strong>Cancelación — resumen de la política vigente</strong>{concisePolicy(quote.policy_summary).slice(0, 5).map(item => <span key={item}>• {item}</span>)}</div><div className="top-actions"><button className="button ghost" onClick={() => downloadCustomerQuote(quote, { hotelName: hotel?.name, clientName: passengers[0]?.full_name || reference })}><Download size={15}/> PDF</button><button className="button dark" disabled={busy} onClick={() => void shareQuote()}><Send size={15}/> Compartir</button>{!quoteSent && <button className="button ghost" disabled={busy} onClick={() => void markSent()}>Registrar enviada</button>}</div></section>}
      <div className="flow-bottom-actions"><button className="button ghost big" disabled={busy} onClick={() => void persist('data_capture')}>Guardar productos</button><button className="button dark big" disabled={busy || !draftServices.length} onClick={() => void generateQuote()}>{quote ? 'Crear nueva versión' : 'Crear carta cotización'} <FileText size={16}/></button>{quoteSent && !quoteAccepted && <button className="button dark big" disabled={busy} onClick={() => void acceptQuote()}><CheckCircle2 size={16}/> Cliente acepta</button>}</div>
    </section>}

    {activeStep === 3 && <section className="flow-card">
      <FlowTitle number="04" title="Aceptación, pago y datos finales" text="Una vez aceptada la cotización, se envía el link de pago y se completa la información que necesita la reserva."/>
      <section className="payment-link-card"><div><strong>Link de pago</strong><span>Se guarda en el mismo ingreso; compartirlo no crea otra reserva.</span></div><div className="payment-link-row"><input value={paymentLink} onChange={event => setPaymentLink(event.target.value)} placeholder="https://…"/><button className="button dark" disabled={busy || !paymentLink.trim()} onClick={() => void sendPayment()}><Send size={15}/> Compartir link</button><button className="button ghost" disabled={!paymentLink.trim()} onClick={() => navigator.clipboard.writeText(paymentLink)}><Copy size={15}/></button></div></section>
      <div className="form-grid four"><label>Vuelo llegada <span>si aplica</span><input value={arrivalFlight} onChange={event => setArrivalFlight(event.target.value)} placeholder="JA 123"/></label><label>Vuelo salida <span>si aplica</span><input value={departureFlight} onChange={event => setDepartureFlight(event.target.value)} placeholder="LA 456"/></label><label>Punto de recogida<input value={pickupLocation} onChange={event => setPickupLocation(event.target.value)} placeholder="Hotel / aeropuerto / dirección"/></label><label>Habitación <span>si aplica</span><input value={hotelRoom} onChange={event => setHotelRoom(event.target.value)}/></label></div>
      <div className="full-passenger-stack">{passengers.map((passenger, index) => <article key={index}><header><Users size={15}/><strong>{reference || 'RESERVA'} · P{String(index + 1).padStart(2, '0')}</strong></header><div className="form-grid four"><label>Nombre completo<input value={passenger.full_name} onChange={event => patchPassenger(index, { full_name: event.target.value })}/></label><label>Email<input type="email" value={passenger.email} onChange={event => patchPassenger(index, { email: event.target.value })}/></label><label>Teléfono<input value={passenger.phone} onChange={event => patchPassenger(index, { phone: event.target.value })}/></label><label>Nacionalidad<input value={passenger.nationality} onChange={event => patchPassenger(index, { nationality: event.target.value })}/></label></div><div className="form-grid four"><label>Tipo documento<select value={passenger.document_type} onChange={event => patchPassenger(index, { document_type: event.target.value })}><option>Pasaporte</option><option>Cédula</option><option>Otro</option></select></label><label>N° documento<input value={passenger.document_number} onChange={event => patchPassenger(index, { document_number: event.target.value })}/></label><label>Nacimiento<input type="date" value={passenger.birth_date} onChange={event => patchPassenger(index, { birth_date: event.target.value })}/></label><label>Restricciones alimentarias<input value={passenger.dietary_restrictions} onChange={event => patchPassenger(index, { dietary_restrictions: event.target.value })} placeholder="Ninguna / detalle"/></label></div><label>Observaciones médicas o de movilidad<textarea value={passenger.medical_notes || ''} onChange={event => patchPassenger(index, { medical_notes: event.target.value })} placeholder="Solo si corresponde"/></label></article>)}</div>
      <label>Observaciones generales<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Acuerdos y datos relevantes para completar la reserva"/></label>
      <FlowActions busy={busy} onSave={() => void persist(paymentSent ? 'payment_link_sent' : 'accepted_payment')} onNext={async () => { setBusy(true); try { await persist(paymentSent ? 'payment_link_sent' : 'accepted_payment', true); if (!paymentSent) throw new Error('Comparte el link de pago antes de avanzar al itinerario.'); setActiveStep(4); } catch (error: any) { setMessage(error?.message || 'No se pudo avanzar.'); } finally { setBusy(false); } }} nextLabel="Preparar itinerario"/>
    </section>}

    {activeStep === 4 && <section className="flow-card">
      <FlowTitle number="05" title="Confirmación e itinerario al pasajero" text="El itinerario se construye con los mismos productos, fechas, modalidad y datos ya ingresados. No se vuelve a escribir la reserva."/>
      <div className="itinerary-preview"><header><div><Mail size={18}/><span><strong>{reference || leadCode}</strong><small>{passengers[0]?.email || 'Email principal pendiente'}</small></span></div></header><pre>{itineraryBody()}</pre></div>
      <div className="flow-bottom-actions"><button className="button dark big" disabled={busy || !passengers[0]?.email} onClick={() => void sendItinerary()}><Mail size={16}/> Enviar itinerario por email</button><button className="button ghost big" disabled={busy} onClick={() => void markItineraryExternal()}>Registrar envío externo</button></div>
    </section>}

    {activeStep === 5 && <section className="flow-card final-flow-card">
      <FlowTitle number="06" title="Completar reserva" text="Este es el único botón que entrega la reserva a HOTEL EXPERIENCE Operaciones. Se entrega el mismo registro, sin duplicar clientes, pasajeros ni productos."/>
      <div className={`final-gate ${finalMissing.length ? '' : 'ready'}`}><div><span>{finalMissing.length ? 'AÚN NO LISTA' : 'LISTA PARA OPERACIONES'}</span><strong>{finalMissing.length ? `Falta: ${finalMissing.join(' · ')}` : 'Cotización, aceptación, datos e itinerario están vinculados.'}</strong></div><div><span>Referencia</span><strong>{reference || leadCode}</strong><small>{paxCount} pax · {draftServices.length} producto(s)</small></div></div>
      <button className="button dark huge wide" disabled={busy || finalMissing.length > 0} onClick={() => void completeReservation()}>{busy ? 'Procesando…' : 'Completar reserva y enviar a Operaciones'} <ArrowRight size={18}/></button>
    </section>}

    {catalogOpen && <div className="quote-overlay"><div className="quote-overlay-panel"><header className="quote-overlay-head"><div><p className="eyebrow">CATÁLOGO RELACIONADO AL INGRESO</p><strong>Selecciona un producto y vuelve al mismo flujo</strong></div><button className="button dark" onClick={() => setCatalogOpen(false)}>Cerrar <X size={15}/></button></header><div className="quote-overlay-body"><ProductWorkspace products={products} onQuote={addProductById}/></div></div></div>}

    {partnerOpen && <div className="quote-overlay"><div className="partner-request-panel"><header className="quote-overlay-head"><div><p className="eyebrow">NUEVO HOTEL / NEGOCIO</p><strong>Solicitud de incorporación</strong></div><button className="icon-button" onClick={() => setPartnerOpen(false)}><X size={18}/></button></header><div className="partner-request-body"><div className="form-grid two"><label>Nombre<input value={partnerDraft.name} onChange={event => setPartnerDraft(value => ({ ...value, name: event.target.value }))}/></label><label>Tipo<select value={partnerDraft.partnerType} onChange={event => setPartnerDraft(value => ({ ...value, partnerType: event.target.value }))}><option value="hotel">Hotel</option><option value="agency">Agencia</option><option value="business">Negocio</option><option value="other">Otro</option></select></label></div><div className="form-grid two"><label>Prefijo<input maxLength={5} value={partnerDraft.leadPrefix} onChange={event => setPartnerDraft(value => ({ ...value, leadPrefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}/></label><label>Contacto<input value={partnerDraft.contactName} onChange={event => setPartnerDraft(value => ({ ...value, contactName: event.target.value }))}/></label></div><div className="form-grid two"><label>Email<input value={partnerDraft.email} onChange={event => setPartnerDraft(value => ({ ...value, email: event.target.value }))}/></label><label>Teléfono<input value={partnerDraft.phone} onChange={event => setPartnerDraft(value => ({ ...value, phone: event.target.value }))}/></label></div><label>Notas<textarea value={partnerDraft.notes} onChange={event => setPartnerDraft(value => ({ ...value, notes: event.target.value }))}/></label>{partnerMessage && <div className={partnerMessage.includes('aprobación') ? 'success-box' : 'error-box'}>{partnerMessage}</div>}<button className="button dark wide" disabled={partnerBusy || !partnerDraft.name || partnerDraft.leadPrefix.length < 2} onClick={() => void submitPartner()}>{partnerBusy ? 'Enviando…' : 'Enviar a aprobación'}</button></div></div></div>}
  </div>;
}

function FlowTitle({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="flow-title"><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></div>;
}
function FlowActions({ busy, onSave, onNext, nextLabel }: { busy: boolean; onSave: () => void; onNext: () => void | Promise<void>; nextLabel: string }) {
  return <div className="flow-bottom-actions"><button className="button ghost big" disabled={busy} onClick={onSave}>{busy ? 'Guardando…' : 'Guardar'}</button><button className="button dark big" disabled={busy} onClick={() => void onNext()}>{nextLabel} <ArrowRight size={16}/></button></div>;
}
function AutoPaxPreview({ reference, count }: { reference: string; count: number }) {
  return <div className="auto-pax-preview"><div><Users size={17}/><span><strong>Pasajeros preparados automáticamente</strong><small>El número de pax crea los códigos; los nombres reales se completan después.</small></span></div><div>{Array.from({ length: Math.min(count, 12) }, (_, index) => <span key={index}>{reference || 'RESERVA'} · P{String(index + 1).padStart(2, '0')}</span>)}{count > 12 && <span>+{count - 12} pax</span>}</div></div>;
}
