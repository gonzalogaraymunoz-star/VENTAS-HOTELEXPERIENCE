import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleDollarSign, Clock3, FileText, Search } from 'lucide-react';
import { clp } from '../lib/money';
import { updateLeadStatus } from '../lib/sales';
import type { Lead, LeadService, PaymentMovement } from '../types';
import ClientIntakeEditor from './ClientIntakeEditor';

const stageOptions = ['nuevo', 'contactado', 'interesado', 'cotizando', 'propuesta', 'esperando', 'perdido', 'cancelado', 'dormido'];
const stageColumns = ['nuevo', 'contactado', 'interesado', 'cotizando', 'propuesta', 'esperando', 'confirmado', 'perdido', 'cancelado', 'dormido'];
const valueOf = (service: LeadService) => Number(service.precio_total ?? service.precio_venta ?? 0);

function paidFor(service: LeadService, payments: PaymentMovement[]) {
  const quantified = payments
    .filter(payment => payment.lead_service_id === service.id && (!payment.direction || payment.direction === 'inflow'))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  if (quantified > 0) return quantified;
  return service.estado_pago === 'Pagado' ? valueOf(service) : 0;
}

function priorityRank(value?: string | null) {
  return value === 'Alta' ? 0 : value === 'Media' ? 1 : value === 'Baja' ? 2 : 3;
}

export function ReservationDashboard({
  leads, services, payments, onNew, onEdit, onClients, onPayments, onPipeline,
}: {
  leads: Lead[];
  services: LeadService[];
  payments: PaymentMovement[];
  onNew: () => void;
  onEdit: (leadId: string) => void;
  onClients: () => void;
  onPayments: () => void;
  onPipeline: () => void;
}) {
  const drafts = useMemo(() => leads
    .filter(lead => lead.estado !== 'confirmado')
    .sort((a, b) => priorityRank(a.prioridad) - priorityRank(b.prioridad) || String(a.checkin || '9999').localeCompare(String(b.checkin || '9999'))), [leads]);
  const confirmed = services.filter(service => ['confirmed', 'completed'].includes(String(service.booking_status)));
  const pendingCollection = Array.from(new Set(confirmed.map(service => service.lead_id))).reduce((sum, leadId) => {
    const rows = confirmed.filter(service => service.lead_id === leadId);
    const total = rows.reduce((value, service) => value + valueOf(service), 0);
    const paid = rows.reduce((value, service) => value + paidFor(service, payments), 0);
    return sum + Math.max(0, total - paid);
  }, 0);
  const operationPending = confirmed.filter(service => String(service.estado_operacion || '').toLowerCase() === 'pendiente').length;

  return <div className="screen-stack action-dashboard">
    <section className="work-hero"><div><p className="eyebrow">CENTRO DE TRABAJO</p><h1>Ingreso primero. Reserva después.</h1><p>Los ingresos se completan aquí. Solo la confirmación final del formulario activa Operaciones.</p></div><button className="button dark big" onClick={onNew}>Nuevo ingreso <ArrowRight size={16}/></button></section>
    <section className="work-summary-grid">
      <button onClick={onClients} className="work-summary-card"><span><FileText size={17}/> Ingresos abiertos</span><strong>{drafts.length}</strong><small>información todavía no confirmada</small><ArrowRight size={17}/></button>
      <button onClick={onPayments} className="work-summary-card"><span><CircleDollarSign size={17}/> Por cobrar</span><strong>{clp(pendingCollection)}</strong><small>sobre reservas ya confirmadas</small><ArrowRight size={17}/></button>
      <button onClick={onPipeline} className="work-summary-card"><span><Clock3 size={17}/> En Operaciones</span><strong>{operationPending}</strong><small>servicios confirmados pendientes</small><ArrowRight size={17}/></button>
    </section>
    <section className="work-panel"><header><div><p className="eyebrow">INGRESOS ABIERTOS</p><h2>Completar antes de reservar</h2></div><button onClick={onClients}>Ver todos <ArrowRight size={14}/></button></header><div className="work-list">
      {drafts.slice(0, 8).map(lead => {
        const rows = services.filter(service => service.lead_id === lead.id && service.booking_status === 'quoted');
        return <article key={lead.id}><div className="work-row-main"><span className="work-code">{lead.codigo}</span><strong>{lead.contacto || 'Cliente por completar'}</strong><small>{lead.hotel_partners?.name || lead.canal || 'Sin origen'} · {lead.checkin || 'arribo pendiente'} · {lead.prioridad || 'Sin fecha'}</small></div><div className="work-row-money"><strong>{clp(rows.reduce((sum, row) => sum + valueOf(row), 0))}</strong><span>{rows.length} producto(s)</span></div><button className="button dark compact-action" onClick={() => onEdit(lead.id)}>Continuar</button></article>;
      })}
      {!drafts.length && <div className="work-empty"><CheckCircle2 size={20}/><strong>Sin ingresos abiertos.</strong><span>Las reservas confirmadas ya están en Operaciones.</span></div>}
    </div></section>
  </div>;
}

export function ReservationClientsWorkspace({
  leads, services, onEditDraft, onUpdated,
}: {
  leads: Lead[];
  services: LeadService[];
  onEditDraft: (leadId: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [editingClient, setEditingClient] = useState<Lead | null>(null);
  const rows = useMemo(() => leads.filter(lead => `${lead.codigo} ${lead.reserva} ${lead.servicio} ${lead.contacto} ${lead.nationality || ''} ${lead.hotel_partners?.name || ''}`.toLowerCase().includes(query.toLowerCase())), [leads, query]);
  const servicesFor = (leadId: string) => services.filter(service => service.lead_id === leadId);

  return <div className="screen-stack">
    <section className="page-heading"><div><p className="eyebrow">CLIENTES</p><h1>Ingresos y reservas</h1><p className="muted">Un ingreso abierto se continúa en el formulario. Una reserva confirmada permanece como el mismo registro y ya está en Operaciones.</p></div></section>
    <div className="toolbar"><div className="search-box"><Search size={17}/><input placeholder="Buscar código, cliente, nacionalidad, producto, hotel…" value={query} onChange={event => setQuery(event.target.value)}/></div><span>{rows.length} registros</span></div>
    <div className="table-shell"><table><thead><tr><th>Código</th><th>Origen</th><th>Contacto</th><th>Arribo</th><th>Prioridad</th><th>Productos</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{rows.map(lead => {
      const leadServices = servicesFor(lead.id);
      const confirmed = lead.estado === 'confirmado' || leadServices.some(service => ['confirmed', 'completed'].includes(String(service.booking_status)));
      return <tr key={lead.id}><td><strong>{lead.codigo}</strong><small>{confirmed ? 'Reserva confirmada' : 'Ingreso abierto'}</small></td><td>{lead.hotel_partners?.name || lead.canal || '—'}</td><td>{lead.contacto || 'Por completar'}<small>{lead.nationality || 'Nacionalidad pendiente'}</small></td><td>{lead.checkin || 'Por definir'}<small>{lead.stay_days != null ? `${lead.stay_days} días` : 'Estadía pendiente'}</small></td><td><span className={`status status-${String(lead.prioridad || 'sin-fecha').toLowerCase().replace(/\s/g, '-')}`}>{lead.prioridad || 'Sin fecha'}</span></td><td>{leadServices.length}<small>{lead.servicio || 'Sin detalle'}</small></td><td>{clp(lead.precio_venta)}</td><td><span className={`status status-${String(lead.estado || '').toLowerCase()}`}>{lead.estado}</span></td><td><div className="top-actions">{confirmed ? <button className="button ghost" onClick={() => setEditingClient(lead)}>Datos</button> : <button className="button dark" onClick={() => onEditDraft(lead.id)}>Continuar ingreso</button>}</div></td></tr>;
    })}</tbody></table>{!rows.length && <div className="empty-state">No hay coincidencias.</div>}</div>
    {editingClient && <ClientIntakeEditor lead={editingClient} onClose={() => setEditingClient(null)} onSaved={onUpdated}/>} 
  </div>;
}

export function ReservationPipeline({ leads, onUpdated }: { leads: Lead[]; onUpdated: () => Promise<void> }) {
  const [busy, setBusy] = useState('');
  async function change(leadId: string, status: string) {
    setBusy(leadId);
    try { await updateLeadStatus(leadId, status); await onUpdated(); }
    finally { setBusy(''); }
  }
  return <div className="screen-stack"><section className="page-heading"><div><p className="eyebrow">CONVERSIÓN</p><h1>Pipeline comercial</h1><p className="muted">“Confirmado” no se elige desde el pipeline. Solo aparece después de confirmar la reserva al final del formulario.</p></div></section><div className="kanban-board">{stageColumns.map(stage => <section className="kanban-column" key={stage}><header><strong>{stage}</strong><span>{leads.filter(lead => (lead.estado || 'nuevo').toLowerCase() === stage).length}</span></header><div>{leads.filter(lead => (lead.estado || 'nuevo').toLowerCase() === stage).map(lead => <article className="kanban-card" key={lead.id}><div className="kanban-code">{lead.codigo}</div><strong>{lead.servicio || 'Ingreso sin producto'}</strong><p>{lead.hotel_partners?.name || lead.canal || 'Sin origen'} · {lead.prioridad || 'Sin fecha'}</p><small>{lead.next_best_action || clp(lead.precio_venta)}</small>{stage === 'confirmado' ? <span className="ready-chip">En Operaciones</span> : <select disabled={busy === lead.id} value={(lead.estado || 'nuevo').toLowerCase()} onChange={event => void change(lead.id, event.target.value)}>{stageOptions.map(option => <option key={option}>{option}</option>)}</select>}</article>)}</div></section>)}</div></div>;
}
