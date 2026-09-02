import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Banknote, BookOpen, Boxes, Building2, ExternalLink, LayoutDashboard, LogOut, Menu, Plus,
  RefreshCw, Search, ShoppingBag, Users, X, Kanban, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  arrivalPriority, confirmSale, createSale, loadLeads, loadPayments, loadReferenceData, loadServices,
  requestPartner, stayLength, updateLeadStatus,
} from '../lib/sales';
import { clp, economics, resolveProductPrice } from '../lib/money';
import type { HotelPartner, Lead, LeadService, PassengerDraft, PaymentMovement, Product, Profile, SellerProfile, ServiceDraft, Supplier } from '../types';
import { ActionDashboard, ProductWorkspace } from './SalesWorkspaces';
import { AccountWorkspace } from './ClientPaymentsWorkspace';
import VisualCatalog from './VisualCatalog';
import ManualQuoteBuilder from './ManualQuoteBuilder';

type Screen = 'dashboard' | 'new-sale' | 'leads' | 'pipeline' | 'catalog' | 'products' | 'payments';

type AppData = {
  hotels: HotelPartner[];
  products: Product[];
  suppliers: Supplier[];
  sellers: SellerProfile[];
  leads: Lead[];
  services: LeadService[];
  payments: PaymentMovement[];
};

const emptyData: AppData = { hotels: [], products: [], suppliers: [], sellers: [], leads: [], services: [], payments: [] };
const channels = ['Recepción', 'QR Hotel', 'Base de datos hotel', 'Web', 'Campaña', 'Email', 'Vendedor', 'Venta directa', 'Otro'];
const pipelineStages = ['nuevo', 'contactado', 'interesado', 'cotizando', 'propuesta', 'esperando', 'confirmado', 'perdido', 'cancelado', 'dormido'];

export default function SalesApp({ profile }: { profile: Profile }) {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quoteProductId, setQuoteProductId] = useState('');
  const [paymentLeadId, setPaymentLeadId] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [ref, leads, services, payments] = await Promise.all([
        loadReferenceData(), loadLeads(), loadServices(), loadPayments(),
      ]);
      setData({ ...ref, leads, services, payments });
    } catch (e: any) {
      setError(e?.message || 'No fue posible cargar los datos.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const nav: { id: Screen; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
    { id: 'new-sale', label: 'Ingreso / venta', icon: ShoppingBag },
    { id: 'catalog', label: 'Catálogo', icon: BookOpen },
    { id: 'leads', label: 'Clientes', icon: Users },
    { id: 'pipeline', label: 'Pipeline', icon: Kanban },
    { id: 'products', label: 'Productos', icon: Boxes },
    { id: 'payments', label: 'Cobros', icon: Banknote },
  ];

  function go(next: Screen) { setScreen(next); setMobileOpen(false); }
  function startQuote(productId = '') { setQuoteProductId(productId); go('new-sale'); }
  function openPayments(leadId = '') { setPaymentLeadId(leadId); go('payments'); }
  const operationsUrl = import.meta.env.VITE_OPERATIONS_URL as string | undefined;
  const confirmedServices = data.services.filter(service => ['confirmed','completed'].includes(String(service.booking_status)));

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-head">
        <div className="brand-mark inverse">LINK</div>
        <button className="icon-button sidebar-close" onClick={()=>setMobileOpen(false)}><X size={19}/></button>
      </div>
      <div className="product-name"><strong>Ventas</strong><span>HOTEL EXPERIENCE</span></div>
      <nav>
        {nav.map(item => <button key={item.id} className={`nav-item ${screen===item.id?'active':''}`} onClick={()=>item.id==='new-sale'?startQuote():go(item.id)}>
          <item.icon size={18}/><span>{item.label}</span>
        </button>)}
      </nav>
      <div className="sidebar-spacer" />
      {operationsUrl && <a className="nav-item" href={operationsUrl} target="_blank" rel="noreferrer"><ExternalLink size={18}/><span>Ir a Operaciones</span></a>}
      <button className="nav-item" onClick={()=>supabase.auth.signOut()}><LogOut size={18}/><span>Cerrar sesión</span></button>
      <div className="profile-mini"><div className="avatar">{(profile.full_name || profile.email || 'U').slice(0,1).toUpperCase()}</div><div><strong>{profile.full_name || 'Usuario'}</strong><span>{profile.role}</span></div></div>
    </aside>

    {mobileOpen && <button className="backdrop" onClick={()=>setMobileOpen(false)} aria-label="Cerrar menú"/>}

    <main className="workspace">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button>
        <div><p className="eyebrow">LINK VENTAS</p><strong>{titleFor(screen)}</strong></div>
        <div className="top-actions">
          <button className="button ghost" onClick={()=>void refresh()}><RefreshCw size={16} className={loading?'spin':''}/><span>Actualizar</span></button>
          <button className="button dark" onClick={()=>startQuote()}><Plus size={16}/> Ingreso / venta</button>
        </div>
      </header>

      <section className="content-area">
        {error && <div className="error-box page-error">{error}</div>}
        {loading && data.leads.length===0 ? <div className="loading-panel">Cargando información comercial…</div> : <>
          {screen==='dashboard' && <div className="screen-stack">
            <ManualQuoteBuilder compact/>
            <ActionDashboard
              leads={data.leads}
              services={data.services}
              payments={data.payments}
              onQuote={()=>startQuote()}
              onClients={()=>go('leads')}
              onPipeline={()=>go('pipeline')}
              onOpenPayments={openPayments}
              onConfirm={async leadId=>{await confirmSale(leadId);await refresh();}}
              operationsUrl={operationsUrl}
            />
          </div>}
          {screen==='new-sale' && <NewSale data={data} profile={profile} initialProductId={quoteProductId} onCreated={async()=>{await refresh();go('leads')}}/>}
          {screen==='catalog' && <VisualCatalog products={data.products} onQuote={productId=>startQuote(productId)}/>} 
          {screen==='leads' && <LeadTable leads={data.leads} services={data.services} onConfirm={async(id)=>{await confirmSale(id);await refresh();}}/>}
          {screen==='pipeline' && <Pipeline leads={data.leads} onChange={async(id,status)=>{await updateLeadStatus(id,status);await refresh();}}/>}
          {screen==='products' && <div className="screen-stack"><ManualQuoteBuilder/><ProductWorkspace products={data.products} onQuote={productId=>startQuote(productId)}/></div>} 
          {screen==='payments' && <AccountWorkspace leads={data.leads} payments={data.payments} services={confirmedServices} initialLeadId={paymentLeadId} onAdded={refresh}/>} 
        </>}
      </section>
    </main>
  </div>;
}

function titleFor(screen: Screen) {
  return ({ dashboard:'Centro de trabajo', 'new-sale':'Ingreso / venta', catalog:'Catálogo visual', leads:'Clientes y ventas', pipeline:'Pipeline comercial', products:'Productos y tarifas', payments:'Cobros y documentos' } as Record<Screen,string>)[screen];
}

function Empty({text}:{text:string}) { return <div className="empty-state">{text}</div>; }
function Status({value}:{value:string}) { const key=(value||'').toLowerCase(); return <span className={`status status-${key}`}>{value || 'Pendiente'}</span>; }
function taxLabel(product: Product){if(product.tax_treatment==='exempt')return 'Exento';if(product.tax_treatment==='taxable')return product.tax_rate!=null?`Afecto ${product.tax_rate}%`:'Afecto · tasa por definir';return 'Tributación por definir'}

function LeadTable({ leads, services, onConfirm }: { leads: Lead[]; services: LeadService[]; onConfirm:(leadId:string)=>Promise<void> }) {
  const [query,setQuery]=useState(''); const [busy,setBusy]=useState(''); const [message,setMessage]=useState('');
  const rows=useMemo(()=>leads.filter(l=>`${l.codigo} ${l.reserva} ${l.servicio} ${l.contacto} ${l.nationality||''} ${l.hotel_partners?.name}`.toLowerCase().includes(query.toLowerCase())),[leads,query]);
  const servicesFor=(leadId:string)=>services.filter(s=>s.lead_id===leadId);
  const canConfirm=(leadId:string)=>servicesFor(leadId).some(s=>s.booking_status==='quoted');
  async function confirm(id:string){setBusy(id);setMessage('');try{await onConfirm(id);setMessage('Venta confirmada y entregada a Operaciones.')}catch(e:any){setMessage(e?.message||'No se pudo confirmar la venta.')}finally{setBusy('')}}
  return <div className="screen-stack">
    <section className="page-heading"><div><p className="eyebrow">CRM COMERCIAL</p><h1>Clientes</h1><p className="muted">El mismo código conecta ingreso/venta, pasajeros, productos, pagos y operación.</p></div></section>
    {message&&<div className={message.startsWith('Venta confirmada')?'success-box':'error-box'}>{message}</div>}
    <div className="toolbar"><div className="search-box"><Search size={17}/><input placeholder="Buscar código, cliente, nacionalidad, producto, hotel…" value={query} onChange={e=>setQuery(e.target.value)}/></div><span>{rows.length} registros</span></div>
    <div className="table-shell"><table><thead><tr><th>Código</th><th>Origen</th><th>Contacto</th><th>Arribo</th><th>Prioridad</th><th>Productos</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{rows.map(l=><tr key={l.id}><td><strong>{l.codigo}</strong><small>{l.reserva}</small></td><td>{l.hotel_partners?.name || l.canal || '—'}</td><td>{l.contacto || 'Por completar'}<small>{l.nationality || 'Nacionalidad pendiente'}</small></td><td>{l.checkin || 'Por definir'}<small>{l.stay_days!=null?`${l.stay_days} días`:'Estadía pendiente'}</small></td><td><Status value={l.prioridad || 'Sin fecha'}/></td><td>{servicesFor(l.id).length}<small>{l.servicio || 'Sin detalle'}</small></td><td>{clp(l.precio_venta)}</td><td><Status value={l.estado}/></td><td>{canConfirm(l.id)?<button className="button dark" disabled={busy===l.id} onClick={()=>void confirm(l.id)}>{busy===l.id?'Confirmando…':'Confirmar venta'}</button>:<span className="muted">{l.estado==='confirmado'?'En Operaciones':'Completar ingreso'}</span>}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No hay coincidencias."/>}</div>
  </div>;
}

function Pipeline({ leads, onChange }: { leads: Lead[]; onChange:(id:string,status:string)=>Promise<void> }) {
  const [busy,setBusy]=useState('');
  return <div className="screen-stack"><section className="page-heading"><div><p className="eyebrow">CONVERSIÓN</p><h1>Pipeline</h1><p className="muted">Cada estado responde qué está pendiente. La prioridad se recalcula según los días que faltan para el arribo.</p></div></section><div className="kanban-board">{pipelineStages.map(stage=><section className="kanban-column" key={stage}><header><strong>{stage}</strong><span>{leads.filter(l=>(l.estado||'nuevo').toLowerCase()===stage).length}</span></header><div>{leads.filter(l=>(l.estado||'nuevo').toLowerCase()===stage).map(l=><article className="kanban-card" key={l.id}><div className="kanban-code">{l.codigo}</div><strong>{l.servicio || 'Ingreso sin producto'}</strong><p>{l.hotel_partners?.name || l.canal || 'Sin origen'} · {l.prioridad || 'Sin fecha'}</p><small>{l.next_best_action || clp(l.precio_venta)}</small><select disabled={busy===l.id} value={(l.estado||'nuevo').toLowerCase()} onChange={async e=>{setBusy(l.id);try{await onChange(l.id,e.target.value)}finally{setBusy('')}}}>{pipelineStages.map(s=><option key={s}>{s}</option>)}</select></article>)}</div></section>)}</div></div>;
}

function NewSale({ data, profile, initialProductId, onCreated }:{data:AppData;profile:Profile;initialProductId?:string;onCreated:()=>Promise<void>}) {
  const availableSellers=useMemo(()=>profile.role==='agent'?data.sellers.filter(s=>s.id===profile.id):data.sellers,[data.sellers,profile.id,profile.role]);
  const [hotelId,setHotelId]=useState(data.hotels[0]?.id||'');
  const [channel,setChannel]=useState('Recepción');
  const [checkin,setCheckin]=useState('');
  const [checkout,setCheckout]=useState('');
  const [contact,setContact]=useState('');
  const [nationality,setNationality]=useState('');
  const [stayDays,setStayDays]=useState<number | null>(null);
  const [sellerProfileId,setSellerProfileId]=useState(profile.id);
  const [notes,setNotes]=useState('');
  const [passengers,setPassengers]=useState<PassengerDraft[]>([blankPassenger(true)]);
  const [services,setServices]=useState<ServiceDraft[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [createdCode,setCreatedCode]=useState('');
  const [createdLeadId,setCreatedLeadId]=useState('');
  const [createdStatus,setCreatedStatus]=useState<'quoted'|'confirmed'|''>('');
  const [catalogOpen,setCatalogOpen]=useState(false);
  const [partnerOpen,setPartnerOpen]=useState(false);
  const [partnerBusy,setPartnerBusy]=useState(false);
  const [partnerMessage,setPartnerMessage]=useState('');
  const [partnerDraft,setPartnerDraft]=useState({name:'',partnerType:'hotel',leadPrefix:'',contactName:'',email:'',phone:'',notes:''});
  const priority=arrivalPriority(checkin);

  useEffect(()=>{if(!hotelId&&data.hotels[0])setHotelId(data.hotels[0].id)},[data.hotels,hotelId]);
  useEffect(()=>{if(!availableSellers.some(s=>s.id===sellerProfileId)&&availableSellers[0])setSellerProfileId(availableSellers[0].id)},[availableSellers,sellerProfileId]);
  useEffect(()=>{const calculated=stayLength(checkin,checkout);if(calculated!=null)setStayDays(calculated)},[checkin,checkout]);

  function addProductById(id:string){
    const p=data.products.find(x=>x.id===id); if(!p)return;
    const pax=Math.max(1,passengers.length); const known=resolveProductPrice(p,pax);
    setServices(prev=>[...prev,{product_id:p.id,product_code:p.code,product_name:p.name,category:p.category,date:'',start_time:'',pax,modality:p.price_mode,unit_price:known??0,operator_cost:0,supplier_id:'',supplier_name:'',hotel_commission_pct:15,seller_commission_pct:5,notes:''}]);
  }
  function addManualItem(){
    setServices(prev=>[...prev,{product_id:'',product_code:'MANUAL',product_name:'',category:'Manual',date:'',start_time:'',pax:1,modality:'manual',unit_price:0,operator_cost:0,supplier_id:'',supplier_name:'',hotel_commission_pct:15,seller_commission_pct:5,notes:''}]);
  }
  useEffect(()=>{if(initialProductId&&!services.some(s=>s.product_id===initialProductId))addProductById(initialProductId)},[initialProductId]);
  function patchPassenger(i:number,patch:Partial<PassengerDraft>){setPassengers(prev=>prev.map((p,idx)=>idx===i?{...p,...patch}:p))}
  function addPassenger(){setPassengers(prev=>[...prev,blankPassenger(false)])}
  function removePassenger(i:number){if(i===0)return;setPassengers(prev=>prev.filter((_,idx)=>idx!==i))}
  function patchService(i:number,patch:Partial<ServiceDraft>){setServices(prev=>prev.map((s,idx)=>idx===i?{...s,...patch}:s))}
  async function submit(confirmNow:boolean){
    setBusy(true);setMessage('');
    try{
      const result=await createSale({hotelPartnerId:hotelId,channel,priority,checkin,checkout,contact,nationality,stayDays,sellerProfileId,passengers,services,notes},confirmNow);
      setCreatedLeadId(result.lead_id);setCreatedCode(result.lead_code);setCreatedStatus(result.status);
      setMessage(result.status==='confirmed'?'Venta confirmada y entregada a Operaciones.':'Ingreso guardado. Puedes completar datos, pasajeros y productos antes de confirmar la venta.');
    }catch(e:any){setMessage(e?.message||'No fue posible guardar.')}finally{setBusy(false)}
  }
  async function confirmCreated(){if(!createdLeadId)return;setBusy(true);setMessage('');try{await confirmSale(createdLeadId);setCreatedStatus('confirmed');setMessage('Venta confirmada y entregada a Operaciones.')}catch(e:any){setMessage(e?.message||'No se pudo confirmar.')}finally{setBusy(false)}}
  async function submitPartner(){setPartnerBusy(true);setPartnerMessage('');try{const result=await requestPartner({sellerProfileId,name:partnerDraft.name,partnerType:partnerDraft.partnerType,leadPrefix:partnerDraft.leadPrefix,contactName:partnerDraft.contactName,email:partnerDraft.email,phone:partnerDraft.phone,notes:partnerDraft.notes});setPartnerMessage(`${result.name} quedó enviado a aprobación de Operaciones.`);setPartnerDraft({name:'',partnerType:'hotel',leadPrefix:'',contactName:'',email:'',phone:'',notes:''});}catch(e:any){setPartnerMessage(e?.message||'No se pudo enviar la solicitud.')}finally{setPartnerBusy(false)}}

  const topActions=createdCode ? <div className="top-actions">{createdStatus==='quoted'&&<button className="button ghost" disabled={busy} onClick={()=>void confirmCreated()}>{busy?'Confirmando…':'Confirmar venta'}</button>}<button className="button dark" onClick={()=>void onCreated()}><CheckCircle2 size={17}/>{createdCode} · Ver clientes</button></div> : <div className="top-actions"><button className="button ghost" disabled={busy} onClick={()=>void submit(false)}>{busy?'Guardando…':'Guardar ingreso'}</button><button className="button dark" disabled={busy} onClick={()=>void submit(true)}>Confirmar venta <ArrowRight size={17}/></button></div>;

  return <div className="screen-stack sale-builder"><section className="page-heading sticky-title"><div><p className="eyebrow">INGRESO / VENTA</p><h1>Primero capturamos lo importante. El resto se completa después.</h1><p className="muted">Para crear el ingreso basta con origen, responsable y al menos una forma de identificar o contactar al cliente. Confirmar venta sí exige producto y precio.</p></div>{topActions}</section>

    <section className="builder-section"><SectionNumber n="01" title="Origen, arribo y responsable" text="La prioridad ya no se elige a mano: se calcula por los días que faltan para el arribo."/><div className="form-grid four"><label>Hotel / negocio · obligatorio<div className="inline-field-action"><select value={hotelId} onChange={e=>setHotelId(e.target.value)}><option value="">Seleccionar…</option>{data.hotels.map(h=><option key={h.id} value={h.id}>{h.name} · {h.lead_prefix||'sin prefijo'}</option>)}</select><button type="button" className="button ghost" onClick={()=>setPartnerOpen(true)}><Building2 size={15}/> Ingresar</button></div></label><label>Canal<select value={channel} onChange={e=>setChannel(e.target.value)}>{channels.map(c=><option key={c}>{c}</option>)}</select></label><label>Vendedor · obligatorio<select value={sellerProfileId} onChange={e=>setSellerProfileId(e.target.value)}><option value="">Seleccionar persona…</option>{availableSellers.map(s=><option key={s.id} value={s.id}>{s.full_name||s.email} · {s.role}</option>)}</select></label><label>Prioridad automática<input readOnly value={priority} title="Alta: 0–3 días · Media: 4–14 días · Baja: más de 14 días"/></label></div><div className="form-grid five"><label>Contacto principal<input value={contact} onChange={e=>setContact(e.target.value)} placeholder="Teléfono, email o ambos"/></label><label>Arribo / check-in<input type="date" value={checkin} onChange={e=>setCheckin(e.target.value)}/></label><label>Salida / check-out<input type="date" value={checkout} onChange={e=>setCheckout(e.target.value)}/></label><label>Nacionalidad<input value={nationality} onChange={e=>{setNationality(e.target.value);patchPassenger(0,{nationality:e.target.value})}} placeholder="Ej. Brasil"/></label><label>Días de estadía<input type="number" min="0" value={stayDays??''} onChange={e=>setStayDays(e.target.value===''?null:Math.max(0,Number(e.target.value)))}/></label></div></section>

    <section className="builder-section"><div className="section-title-row"><SectionNumber n="02" title="Cliente y acompañantes" text="Nombre completo, documentos, nacimiento y acompañantes pueden quedar pendientes. Para crear el ingreso basta con nombre, teléfono o email."/><button className="button ghost" onClick={addPassenger}><Plus size={16}/> Acompañante</button></div><div className="passenger-stack">{passengers.map((p,i)=><article className="passenger-row" key={i}><div className="passenger-index"><span>{i===0?'CLIENTE':'ACOMPAÑANTE'}</span><strong>P{String(i+1).padStart(2,'0')}</strong></div><div className="form-grid passenger-fields"><label>Nombre completo<input value={p.full_name} onChange={e=>patchPassenger(i,{full_name:e.target.value})} placeholder="Puede completarse después"/></label><label>Email<input type="email" value={p.email} onChange={e=>patchPassenger(i,{email:e.target.value})}/></label><label>Teléfono<input value={p.phone} onChange={e=>patchPassenger(i,{phone:e.target.value})}/></label><label>Nacionalidad<input value={p.nationality} onChange={e=>{patchPassenger(i,{nationality:e.target.value});if(i===0)setNationality(e.target.value)}}/></label><label>Documento<input value={p.document_number} onChange={e=>patchPassenger(i,{document_number:e.target.value})}/></label><label>Nacimiento<input type="date" value={p.birth_date} onChange={e=>patchPassenger(i,{birth_date:e.target.value})}/></label></div>{i>0&&<button className="icon-button danger" onClick={()=>removePassenger(i)}><X size={17}/></button>}</article>)}</div></section>

    <section className="builder-section"><div className="section-title-row"><SectionNumber n="03" title="Productos e ítems de venta" text="Puedes usar el catálogo real o escribir un ítem manual con el precio de venta que necesites."/><div className="top-actions"><button className="button ghost" onClick={addManualItem}><Plus size={16}/> Ítem manual</button><button className="button dark" onClick={()=>setCatalogOpen(true)}><Boxes size={16}/> Seleccionar productos</button></div></div>{!services.length?<Empty text="Puedes guardar el ingreso sin producto y completarlo antes de confirmar la venta."/>:<div className="service-stack">{services.map((s,i)=>{const calc=economics(s.unit_price,s.pax,s.operator_cost,s.hotel_commission_pct,s.seller_commission_pct);const p=data.products.find(x=>x.id===s.product_id);const manual=!s.product_id;return <article className="service-card" key={`${s.product_id||'manual'}-${i}`}><header><div><span className="product-code">{manual?'MANUAL':s.product_code}</span>{manual?<input value={s.product_name} onChange={e=>patchService(i,{product_name:e.target.value})} placeholder="Nombre del ítem / servicio"/>:<h3>{s.product_name}</h3>}<p>{s.category} · {s.modality} · {p?taxLabel(p):'Tributación por definir'}</p></div><button className="icon-button danger" onClick={()=>setServices(prev=>prev.filter((_,idx)=>idx!==i))}><X size={17}/></button></header><div className="form-grid five"><label>Fecha<input type="date" value={s.date} onChange={e=>patchService(i,{date:e.target.value})}/></label><label>Hora<input type="time" value={s.start_time} onChange={e=>patchService(i,{start_time:e.target.value})}/></label><label>Pax / cantidad<input type="number" min="1" value={s.pax} onChange={e=>patchService(i,{pax:Number(e.target.value)})}/></label><label>Precio venta p/u<input type="number" min="0" value={s.unit_price} onChange={e=>patchService(i,{unit_price:Number(e.target.value)})}/></label><label>Costo operador total<input type="number" min="0" value={s.operator_cost} onChange={e=>patchService(i,{operator_cost:Number(e.target.value)})}/></label></div><div className="form-grid three"><label>Operador propuesto<select value={s.supplier_id} onChange={e=>{const supplier=data.suppliers.find(x=>x.id===e.target.value);patchService(i,{supplier_id:e.target.value,supplier_name:supplier?.name||''})}}><option value="">Por definir</option>{data.suppliers.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label>Comisión hotel % margen<input type="number" min="0" max="100" value={s.hotel_commission_pct} onChange={e=>patchService(i,{hotel_commission_pct:Number(e.target.value)})}/></label><label>Comisión vendedor % margen<input type="number" min="0" max="100" value={s.seller_commission_pct} onChange={e=>patchService(i,{seller_commission_pct:Number(e.target.value)})}/></label></div><div className="economics-strip"><div><span>Venta</span><strong>{clp(calc.total)}</strong></div><div><span>Costo operador</span><strong>{clp(calc.cost)}</strong></div><div><span>Margen comercial</span><strong className={calc.margin<0?'negative':''}>{clp(calc.margin)}</strong></div><div><span>Hotel</span><strong>{clp(calc.hotel)}</strong></div><div><span>Vendedor</span><strong>{clp(calc.seller)}</strong></div><div><span>LINK / HE</span><strong>{clp(calc.platform)}</strong></div></div><label>Observaciones del producto<textarea value={s.notes} onChange={e=>patchService(i,{notes:e.target.value})} placeholder="Información comercial que debe acompañar este servicio."/></label></article>})}</div>}</section>

    <section className="builder-section"><SectionNumber n="04" title="Cierre" text="Guardar ingreso mantiene la oportunidad en Ventas aunque falten datos o productos. Confirmar venta activa Operaciones, pagos y comisiones."/><label>Observaciones generales<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Condiciones, acuerdos, información pendiente…"/></label>{message&&<div className={createdCode?'success-box':'error-box'}>{message}</div>}<div className="closing-bar"><div><span>{passengers.length} persona(s)</span><span>{services.length} producto(s)</span><strong>{clp(services.reduce((sum,s)=>sum+economics(s.unit_price,s.pax,s.operator_cost,s.hotel_commission_pct,s.seller_commission_pct).total,0))}</strong></div>{!createdCode&&<div className="top-actions"><button className="button ghost big" disabled={busy} onClick={()=>void submit(false)}>{busy?'Guardando…':'Guardar ingreso'}</button><button className="button dark big" disabled={busy} onClick={()=>void submit(true)}>{busy?'Procesando…':'Confirmar venta y enviar a Operaciones'} <ArrowRight size={17}/></button></div>}</div></section>

    {catalogOpen&&<div className="quote-overlay"><div className="quote-overlay-panel"><header className="quote-overlay-head"><div><p className="eyebrow">SELECCIÓN DE PRODUCTOS</p><strong>{services.length} agregado(s) al ingreso</strong></div><button className="button dark" onClick={()=>setCatalogOpen(false)}>Volver al ingreso <X size={16}/></button></header><div className="quote-overlay-body"><ProductWorkspace products={data.products} onQuote={addProductById}/></div><footer className="quote-overlay-footer"><span>{services.length} producto(s) seleccionados</span><button className="button dark big" onClick={()=>setCatalogOpen(false)}>Continuar con el ingreso <ArrowRight size={16}/></button></footer></div></div>}

    {partnerOpen&&<div className="quote-overlay"><div className="partner-request-panel"><header className="quote-overlay-head"><div><p className="eyebrow">NUEVO HOTEL / NEGOCIO</p><strong>Solicitud para aprobación de Operaciones</strong></div><button className="icon-button" onClick={()=>setPartnerOpen(false)}><X size={19}/></button></header><div className="partner-request-body"><p className="muted">El negocio no se agrega al catálogo de hoteles hasta que Operaciones/Admin lo apruebe. Quedará vinculado al vendedor seleccionado.</p><div className="form-grid two"><label>Nombre<input value={partnerDraft.name} onChange={e=>setPartnerDraft(v=>({...v,name:e.target.value}))} placeholder="Hotel o negocio"/></label><label>Tipo<select value={partnerDraft.partnerType} onChange={e=>setPartnerDraft(v=>({...v,partnerType:e.target.value}))}><option value="hotel">Hotel</option><option value="agency">Agencia</option><option value="business">Negocio</option><option value="other">Otro</option></select></label></div><div className="form-grid two"><label>Prefijo de código<input maxLength={5} value={partnerDraft.leadPrefix} onChange={e=>setPartnerDraft(v=>({...v,leadPrefix:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')}))} placeholder="Ej. FAU"/></label><label>Vendedor responsable<select value={sellerProfileId} onChange={e=>setSellerProfileId(e.target.value)}>{availableSellers.map(s=><option key={s.id} value={s.id}>{s.full_name||s.email}</option>)}</select></label></div><div className="form-grid three"><label>Contacto<input value={partnerDraft.contactName} onChange={e=>setPartnerDraft(v=>({...v,contactName:e.target.value}))}/></label><label>Email<input type="email" value={partnerDraft.email} onChange={e=>setPartnerDraft(v=>({...v,email:e.target.value}))}/></label><label>Teléfono<input value={partnerDraft.phone} onChange={e=>setPartnerDraft(v=>({...v,phone:e.target.value}))}/></label></div><label>Observaciones<textarea value={partnerDraft.notes} onChange={e=>setPartnerDraft(v=>({...v,notes:e.target.value}))}/></label>{partnerMessage&&<div className={partnerMessage.includes('aprobación')?'success-box':'error-box'}>{partnerMessage}</div>}<button className="button dark wide big" disabled={partnerBusy||!partnerDraft.name||partnerDraft.leadPrefix.length<2||!sellerProfileId} onClick={()=>void submitPartner()}>{partnerBusy?'Enviando…':'Enviar a aprobación de Operaciones'} <ArrowRight size={16}/></button></div></div></div>}
  </div>;
}

function blankPassenger(primary:boolean):PassengerDraft{return{full_name:'',email:'',phone:'',nationality:'',document_type:'Pasaporte',document_number:'',birth_date:'',dietary_restrictions:'',is_primary:primary}}
function SectionNumber({n,title,text}:{n:string;title:string;text:string}){return <div className="section-number"><span>{n}</span><div><h2>{title}</h2><p>{text}</p></div></div>}
