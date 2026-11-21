import { useEffect, useMemo, useState } from 'react';
import { Printer, ExternalLink, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './LeadFichaIntegral.css';
import type { Lead, LeadService, SellerProfile } from '../types';

type Row = Record<string, any>;
type Props = { leadId: string; sellers: SellerProfile[]; onClose: () => void };
const text = (value: unknown, fallback = 'Pendiente') => value === null || value === undefined || value === '' ? fallback : String(value);
const pick = (row: Row, ...keys: string[]) => keys.map(key => row?.[key]).find(value => value !== null && value !== undefined && value !== '');
const money = (value: unknown, currency: unknown) => value === null || value === undefined || value === '' ? 'Precio no registrado' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: String(currency || 'CLP') }).format(Number(value));
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('es-CL') : 'Fecha no registrada';
const dateSort = (a: LeadService, b: LeadService) => `${a.fecha_servicio || ''}|${a.hora_inicio || ''}`.localeCompare(`${b.fecha_servicio || ''}|${b.hora_inicio || ''}`);

async function readRows(table: string, configure: (query: any) => any): Promise<Row[]> {
  try {
    const result = await configure(supabase.from(table).select('*'));
    if (result.error) throw result.error;
    return (result.data || []) as Row[];
  } catch (error) {
    console.warn(`Ficha 360: no fue posible leer ${table}`, error);
    return [];
  }
}
function documentLabel(row: Row) { return text(pick(row, 'title', 'file_name', 'document_type'), 'Documento'); }
function documentUrl(row: Row) {
  const direct = pick(row, 'url', 'drive_url', 'external_url');
  if (direct) return String(direct);
  const driveId = pick(row, 'drive_file_id') || (/drive|google/i.test(String(row.source_kind || '')) ? pick(row, 'external_id') : null);
  if (driveId && String(driveId).length > 10) return `https://drive.google.com/open?id=${encodeURIComponent(String(driveId))}`;
  return '';
}
function isRisk(row: Row) { return /risk|riesgo/i.test(`${row.document_type || ''} ${row.title || ''} ${row.file_name || ''}`); }
function operationMode(value: unknown) { const mode = String(value || '').toLowerCase(); return mode === 'direct' ? 'Operación directa' : mode === 'delegated_full' ? 'Operación delegada' : text(value, 'Modo pendiente'); }

export default function LeadFichaIntegral({ leadId, sellers, onClose }: Props) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [passengers, setPassengers] = useState<Row[]>([]);
  const [services, setServices] = useState<LeadService[]>([]);
  const [documents, setDocuments] = useState<Row[]>([]);
  const [versions, setVersions] = useState<Row[]>([]);
  const [operationalDocuments, setOperationalDocuments] = useState<Row[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [servicePeople, setServicePeople] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [servicePassengerLinks, setServicePassengerLinks] = useState<Row[]>([]);
  const [foodSegments, setFoodSegments] = useState<Row[]>([]);
  const [foodPassengers, setFoodPassengers] = useState<Row[]>([]);
  const [activities, setActivities] = useState<Row[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const leadResult = await supabase.from('leads').select('*, hotel_partners(name)').eq('id', leadId).single();
      if (leadResult.error) throw leadResult.error;
      const row = leadResult.data as Lead;
      setLead(row);
      const [pax, serviceRows, docs, versionsRows, activitiesRows] = await Promise.all([
        readRows('passengers', q => q.eq('lead_id', leadId).order('passenger_code')),
        readRows('lead_services', q => q.eq('lead_id', leadId)),
        readRows('reservation_documents', q => q.eq('lead_id', leadId)),
        readRows('reservation_document_versions', q => q.eq('lead_id', leadId).order('created_at', { ascending: false })),
        readRows('crm_activities', q => q.eq('lead_id', leadId).order('created_at', { ascending: false })),
      ]);
      setPassengers(pax); setServices((serviceRows as LeadService[]).slice().sort(dateSort));
      setDocuments(docs); setVersions(versionsRows); setActivities(activitiesRows);
      const passengerIds = pax.map(person => String(person.id)).filter(Boolean);
      const serviceIds = serviceRows.map(service => String(service.id)).filter(Boolean);
      const departureIds = Array.from(new Set(serviceRows.map(service => String(service.departure_id || '')).filter(Boolean)));
      const [assignmentRows, servicePaxRows, foodRows, riskDocs] = await Promise.all([
        serviceIds.length ? readRows('service_assignments', q => q.in('lead_service_id', serviceIds)) : Promise.resolve([]),
        serviceIds.length ? readRows('lead_service_passengers', q => q.in('lead_service_id', serviceIds)) : Promise.resolve([]),
        departureIds.length ? readRows('tour_food_segments', q => q.in('departure_id', departureIds)) : Promise.resolve([]),
        passengerIds.length ? readRows('operational_entity_documents', q => q.in('entity_id', [leadId, ...passengerIds])) : readRows('operational_entity_documents', q => q.eq('entity_id', leadId)),
      ]);
      const segmentIds = foodRows.map(segment => String(segment.id)).filter(Boolean);
      const foodPaxRows = segmentIds.length ? await readRows('tour_food_passengers', q => q.in('segment_id', segmentIds)) : [];
      const supplierIds = Array.from(new Set([...assignmentRows, ...foodRows].map(row => String(row.supplier_id || '')).filter(Boolean)));
      const peopleIds = Array.from(new Set(assignmentRows.flatMap(row => [row.coordinator_person_id, row.guide_person_id, row.driver_person_id, row.cook_person_id]).map(value => String(value || '')).filter(Boolean)));
      const vehicleIds = Array.from(new Set(assignmentRows.map(row => String(row.vehicle_id || '')).filter(Boolean)));
      const [supplierRows, peopleRows, vehicleRows] = await Promise.all([
        supplierIds.length ? readRows('suppliers', q => q.in('id', supplierIds)) : Promise.resolve([]),
        peopleIds.length ? readRows('service_people', q => q.in('id', peopleIds)) : Promise.resolve([]),
        vehicleIds.length ? readRows('vehicles', q => q.in('id', vehicleIds)) : Promise.resolve([]),
      ]);
      setAssignments(assignmentRows); setSuppliers(supplierRows); setServicePeople(peopleRows); setVehicles(vehicleRows); setServicePassengerLinks(servicePaxRows); setFoodSegments(foodRows); setOperationalDocuments(riskDocs); setFoodPassengers(foodPaxRows);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No fue posible abrir esta ficha con los permisos actuales.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [leadId]);

  useEffect(() => {
    let active = true;
    const allDocs = [...documents, ...versions, ...operationalDocuments];
    void Promise.all(allDocs.map(async (doc, index) => {
      const key = String(doc.id || `${doc.document_type || 'doc'}-${index}`);
      if (documentUrl(doc)) return [key, documentUrl(doc)] as const;
      const bucket = pick(doc, 'storage_bucket');
      const path = pick(doc, 'storage_path');
      if (!bucket || !path) return [key, ''] as const;
      const result = await supabase.storage.from(String(bucket)).createSignedUrl(String(path), 300);
      return [key, result.data?.signedUrl || ''] as const;
    })).then(entries => { if (active) setSignedUrls(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [documents, versions, operationalDocuments]);

  const seller = sellers.find(item => item.id === lead?.assigned_to);
  const sortedServices = useMemo(() => services.slice().sort(dateSort), [services]);
  const assignmentsFor = (serviceId: string) => assignments.filter(row => row.lead_service_id === serviceId);
  const passengersForService = (serviceId: string) => servicePassengerLinks.filter(row => row.lead_service_id === serviceId).map(row => passengers.find(person => person.id === row.passenger_id)?.full_name).filter(Boolean);
  const supplierName = (id: unknown) => suppliers.find(row => row.id === id)?.name || 'Proveedor pendiente';
  const vehicleName = (id: unknown, manual?: unknown) => { const row = vehicles.find(item => item.id === id); return text([pick(row || {}, 'label'), [row?.brand, row?.model].filter(Boolean).join(' '), pick(row || {}, 'plate'), manual].filter(Boolean).join(' · '), id ? String(id) : 'Sin vehículo asignado'); };
  const personName = (id: unknown, manual?: unknown) => {
    const row = servicePeople.find(item => item.id === id);
    return text(pick(row || {}, 'full_name', 'name', 'display_name') || manual, 'Sin asignar');
  };
  const allDocs = [...documents, ...versions, ...operationalDocuments];
  const quoteDocs = allDocs.filter(row => /quote|cotiz/i.test(`${row.document_type || ''} ${row.title || ''}`));
  const itineraryDocs = allDocs.filter(row => /itinerary|itinerario/i.test(`${row.document_type || ''} ${row.title || ''}`));
  const riskDocs = allDocs.filter(isRisk);
  const passengerDocs = (id: string) => riskDocs.filter(row => row.passenger_id === id || row.entity_id === id);
  const foodForDeparture = (departureId: unknown) => {
    const segments = foodSegments.filter(row => row.departure_id === departureId);
    const segmentIds = segments.map(row => row.id);
    const links = foodPassengers.filter(row => segmentIds.includes(row.segment_id));
    return { segments, links };
  };
  const print = () => window.print();

  if (loading) return <div className="lead-ficha-integral"><p>Cargando ficha consolidada…</p></div>;
  if (error || !lead) return <div className="lead-ficha-integral"><div className="error-box">{error || 'No se encontró la solicitud.'}</div><button className="button ghost" onClick={onClose}>Volver</button></div>;

  return <main className="lead-ficha-integral">
    <header className="lf-toolbar no-print"><div><p className="eyebrow">CLIENTES · FICHA INTEGRAL</p><h1>{lead.codigo || lead.reservation_reference || 'Solicitud'}</h1><p>{lead.contacto || 'Contacto pendiente'} · {text((lead as any).hotel_partners?.name || lead.canal)} · Ingreso {dateTime(lead.created_at)}</p></div><div className="top-actions"><button className="button ghost" onClick={() => void load()}><RefreshCw size={15}/> Actualizar</button><button className="button dark" onClick={print}><Printer size={15}/> Imprimir ficha</button><button className="button ghost" onClick={onClose}>Volver</button></div></header>
    <section className="lf-section">
      <h2>01 · Adquisición</h2><div className="lf-grid"><div><small>Contacto</small><strong>{text(lead.contacto)}</strong></div><div><small>Hotel / canal</small><strong>{text((lead as any).hotel_partners?.name || lead.canal)}</strong></div><div><small>Vendedor</small><strong>{text(seller?.full_name || seller?.email || sortedServices.find(service => service.seller_name)?.seller_name, lead.assigned_to ? 'Vendedor asignado (identidad no disponible)' : 'Vendedor pendiente')}</strong></div><div><small>Fecha de solicitud</small><strong>{dateTime(lead.created_at)}</strong></div><div><small>Estado comercial</small><strong>{text(lead.estado)}</strong></div></div>
      <h3>Precios pactados por servicio</h3><div className="lf-table-wrap"><table><thead><tr><th>Servicio</th><th>Fecha</th><th>Modalidad</th><th>Pax</th><th>Precio unitario</th><th>Total pactado</th><th>Moneda</th></tr></thead><tbody>{sortedServices.map(service => <tr key={service.id}><td>{service.producto}</td><td>{text(service.fecha_servicio)}</td><td>{text(service.modality)}</td><td>{text(service.numero_pax, '—')}</td><td>{money(service.precio_unitario ?? service.precio_venta, service.moneda)}</td><td>{money(service.precio_total ?? service.precio_venta, service.moneda)}</td><td>{text(service.moneda)}</td></tr>)}</tbody></table>{!sortedServices.length && <p>No hay servicios registrados en este expediente.</p>}</div>
      <p className="lf-note">Los importes se leen directamente de lead_services. No se recalculan desde TV1.2 ni desde los datos de solicitud recibida.</p>
    </section>
    <section className="lf-section"><h2>02 · Pasajeros</h2>{!passengers.some(person => person.is_primary === true) && <p className="lf-note">No hay un titular designado explícitamente en los datos actuales. Se muestran todos los pasajeros sin inferir quién realizó la adquisición.</p>}<div className="lf-passengers">{passengers.map((person, index) => <article key={person.id || index}><h3>{person.is_primary ? 'Titular / pasajero principal' : passengers.some(row => row.is_primary === true) ? `Acompañante ${index + 1}` : `Pasajero ${index + 1}`}</h3><strong>{text(person.full_name)}</strong><dl>{[['Código',person.passenger_code],['Documento', [person.document_type, person.document_number].filter(Boolean).join(' ')],['Nacimiento',person.birth_date],['Nacionalidad',person.nationality],['Alimentación',person.dietary_restrictions],['Necesidades',person.medical_notes],['Accesibilidad',person.disability_type],['Email',person.email],['Teléfono',person.phone]].map(([label,value]) => <div key={String(label)}><dt>{label}</dt><dd>{text(value)}</dd></div>)}</dl><h4>Hoja de riesgo</h4><DocumentLinks rows={passengerDocs(String(person.id))} urls={signedUrls}/></article>)}{!passengers.length && <p>Pasajeros pendientes de registro.</p>}</div></section>
    <section className="lf-section"><h2>03 · Itinerario adquirido</h2>{sortedServices.map(service => <article className="lf-service" key={service.id}><div><strong>{text(service.fecha_servicio)} · {text(service.hora_inicio, 'Hora pendiente')}</strong><h3>{service.producto}</h3><p>{text(service.modality)} · {text(service.numero_pax, '—')} pax · Detalle: {text(service.observacion)}</p><small>Pasajeros: {passengersForService(service.id).join(', ') || 'Vínculo individual no registrado'}</small></div><span>{money(service.precio_total ?? service.precio_venta, service.moneda)}</span></article>)}{!sortedServices.length && <p>Itinerario no registrado.</p>}</section>
    <section className="lf-section"><h2>04 · Documentos de la solicitud</h2><h3>Cotización</h3><DocumentLinks rows={quoteDocs} urls={signedUrls}/><h3>Itinerario del cliente</h3><DocumentLinks rows={itineraryDocs} urls={signedUrls}/><h3>Otros documentos y versiones</h3><DocumentLinks rows={allDocs.filter(row => !quoteDocs.includes(row) && !itineraryDocs.includes(row) && !riskDocs.includes(row))} urls={signedUrls}/><p className="lf-note">Se enlazan documentos originales. La ficha no crea copias ni versiones nuevas.</p></section>
    <section className="lf-section"><h2>05 · Derivaciones y asignaciones</h2>{sortedServices.map(service => { const rows = assignmentsFor(service.id); const food = foodForDeparture(service.departure_id); return <article className="lf-operation" key={service.id}><h3>{service.producto} · {text(service.fecha_servicio)}</h3>{rows.map((row,index) => <div className="lf-assignment" key={row.id || index}><strong>{operationMode(row.operation_mode) || text(row.status, 'Asignación')}</strong><span>Proveedor: {supplierName(row.supplier_id)}</span><span>Coordinador: {personName(row.coordinator_person_id, row.coordinator_name)}</span><span>Guía: {personName(row.guide_person_id, row.guide_name)}</span><span>Conductor: {personName(row.driver_person_id, row.driver_name)}</span><span>Cocinero: {personName(row.cook_person_id, row.cook_name)}</span><span>Vehículo: {vehicleName(row.vehicle_id, row.vehicle_name_manual)}</span><span>Pago al proveedor: {text(row.supplier_payment_status)}</span><span>Recogida: {text(row.pickup_time)} · {text(row.meeting_point, 'Punto pendiente')}</span><span>{text(row.notes, '')}</span></div>)}{!rows.length && <p>Sin asignación registrada.</p>}<h4>Alimentación por salida</h4>{food.segments.map((segment,index) => <div className="lf-food" key={segment.id || index}><strong>{text(segment.food_type)}</strong><span>Proveedor: {supplierName(segment.supplier_id)}</span><span>Estado: {text(segment.fulfillment_status)}</span><span>Pasajeros vinculados: {food.links.filter(link => link.segment_id === segment.id).map(link => passengers.find(p => p.id === link.passenger_id)?.full_name || 'Pasajero').join(', ') || 'Sin vínculos de pasajeros'}</span><span>{text(segment.notes, '')}</span></div>)}</article>; })}</section>
    <section className="lf-section"><h2>06 · Cronología</h2>{activities.map((activity,index) => <article className="lf-activity" key={activity.id || index}><time>{dateTime(activity.created_at)}</time><strong>{text(activity.title || activity.type)}</strong><span>{text(activity.body, '')}</span><small>{text(activity.created_by, 'Autor no registrado')}</small></article>)}{!activities.length && <p>No hay actividades registradas en crm_activities para esta solicitud.</p>}</section>
    <footer className="lf-footer no-print"><button className="button dark" onClick={print}><Printer size={15}/> Imprimir ficha consolidada</button><button className="button ghost" onClick={onClose}>Volver a clientes</button></footer>
  </main>;
}

function DocumentLinks({ rows, urls }: { rows: Row[]; urls: Record<string,string> }) {
  if (!rows.length) return <p className="lf-empty">No se encontró documento asociado en las tablas consultadas.</p>;
  return <ul className="lf-doc-list">{rows.map((row,index) => { const key = String(row.id || `${row.document_type || 'doc'}-${index}`); const url = urls[key] || ''; return <li key={key}><div><strong>{documentLabel(row)}</strong><small>{text(row.status)} · {row.version ? `Versión ${row.version}` : 'Documento registrado'} · {dateTime(row.created_at || row.generated_at)}</small></div>{url ? <a href={url} target="_blank" rel="noreferrer">Abrir original <ExternalLink size={13}/></a> : <span>Enlace no disponible</span>}</li>; })}</ul>;
}
