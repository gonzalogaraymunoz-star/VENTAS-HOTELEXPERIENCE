import React,{useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,ClipboardList,Hotel,KeyRound,LogOut,Plus,RefreshCw,ShieldCheck,Trash2,UserRound} from 'lucide-react';
import {supabase} from '../lib/supabase';
import ProductCatalogView,{type PortalCatalogSelection} from './ProductCatalogView';
import type {CatalogProduct} from '../lib/portalPricing';
import './PartnerPortal.css';

type HotelOption={id:string;name:string;slug:string};
type Identity={
  mode:'hotel'|'seller'|'admin';
  name:string;
  email?:string;
  access_code?:string;
  partner_type?:string;
  can_create_requests:boolean;
  hotel_partner_id?:string;
};
type PartnerService={
  id:string;
  producto:string;
  fecha_servicio?:string|null;
  numero_pax:number;
  estado:string;
  idioma?:string|null;
  hotel_partner_id?:string;
};
type PartnerLead={
  id:string;codigo:string;reserva:string;numero_pax:number;contacto:string;
  empresa_ejecuta:string;estado:string;estado_raw:string;created_at:string;
  hotel_partner_id:string;
  services:PartnerService[];
};
type PortalData={
  identity:Identity;
  hotels:HotelOption[];
  catalogExtras:CatalogProduct[];
  summary:{total:number;confirmed:number;pending:number;quoted:number};
  leads:PartnerLead[];
  preview_safe?:boolean;
  preview_notice?:string;
};
type SelectedService=PortalCatalogSelection&{key:string;date:string;notes:string};
const PREVIEW_REQUESTS_KEY='link-ventas-seller-desk-preview-requests-v1';
const isPagesPreviewHost=window.location.hostname.endsWith('.link-ventas-hotel.pages.dev')&&window.location.hostname!=='link-ventas-hotel.pages.dev';
function readPreviewLeads():PartnerLead[]{
  try{
    const value=JSON.parse(localStorage.getItem(PREVIEW_REQUESTS_KEY)||'[]');
    return Array.isArray(value)?value:[];
  }catch{return [];}
}

export default function PartnerPortal(){
  const [identity,setIdentity]=useState<Identity|null>(null);
  const [data,setData]=useState<PortalData|null>(null);
  const [checking,setChecking]=useState(true);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [accessCode,setAccessCode]=useState('');
  const [partnerPassword,setPartnerPassword]=useState('');
  const [sellerEmail,setSellerEmail]=useState('');
  const [sellerPassword,setSellerPassword]=useState('');
  const [loginMode,setLoginMode]=useState<'hotel'|'seller'>('hotel');
  const [sellerToken,setSellerToken]=useState('');
  const [tab,setTab]=useState<'reservations'|'catalog'|'new'>('catalog');
  const [selectedHotelId,setSelectedHotelId]=useState('');
  const [selectedServices,setSelectedServices]=useState<SelectedService[]>([]);
  const [notice,setNotice]=useState('');

  async function loadData(token?:string){
    setLoading(true);setError('');
    try{
      const headers:Record<string,string>={};
      if(token&&!isPagesPreviewHost)headers.Authorization='Bearer '+token;
      const response=await fetch('/api/partner-data',{headers});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||'No se pudo cargar el portal.');
      const next:PortalData=body.preview_safe?(()=>{
        const leads=readPreviewLeads();
        return {...body,leads,summary:{total:leads.length,confirmed:0,pending:leads.length,quoted:0}};
      })():body;
      setData(next);setIdentity(next.identity);
      if(token&&!isPagesPreviewHost)setSellerToken(token);
      return body as PortalData;
    }catch(e:any){
      setError(e.message||'No se pudo cargar el portal.');
      throw e;
    }finally{setLoading(false)}
  }

  useEffect(()=>{
    const previousTitle=document.title;
    document.title='LINK Ventas · Escritorio';
    let robots=document.querySelector('meta[name="robots"]') as HTMLMetaElement|null;
    const created=!robots;
    if(!robots){robots=document.createElement('meta');robots.name='robots';document.head.appendChild(robots)}
    const previous=robots.content;
    robots.content='noindex,nofollow,noarchive,nosnippet';
    void (async()=>{
      try{
        if(isPagesPreviewHost){
          // Synthetic preview identity: never inspect, request or receive a real session.
          await loadData();
        }else{
          const {data:{session}}=await supabase.auth.getSession();
          if(session)await loadData(session.access_token);
          else{
            const response=await fetch('/api/partner-data?area=auth');
            if(response.ok){
              const body=await response.json();
              if(body.authenticated)await loadData();
            }
          }
        }
      }catch(_error){setError('No se pudo preparar el entorno de prueba.');}
      finally{setChecking(false)}
    })();
    return()=>{
      document.title=previousTitle;
      if(created)robots?.remove();else if(robots)robots.content=previous;
    };
  },[]);

  useEffect(()=>{
    if(!data?.hotels?.length)return;
    setSelectedHotelId(current=>data.hotels.some(hotel=>hotel.id===current)?current:data.hotels[0].id);
  },[data?.hotels]);

  async function login(event:React.FormEvent){
    event.preventDefault();setLoading(true);setError('');
    try{
      if(isPagesPreviewHost){await loadData();return;}
      if(loginMode==='seller'){
        const {data:authData,error:authError}=await supabase.auth.signInWithPassword({email:sellerEmail.trim(),password:sellerPassword});
        if(authError)throw authError;
        if(!authData.session)throw new Error('No se pudo iniciar la sesión de vendedor.');
        await loadData(authData.session.access_token);
      }else{
        const response=await fetch('/api/partner-data?area=auth',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'login',accessCode,password:partnerPassword})
        });
        const body=await response.json();
        if(!response.ok)throw new Error(body.error||'No se pudo ingresar.');
        await loadData();
        setPartnerPassword('');
      }
      setTab('catalog');
    }catch(e:any){setError(e.message||'No se pudo ingresar.')}
    finally{setLoading(false)}
  }

  async function logout(){
    if(isPagesPreviewHost){
      localStorage.removeItem(PREVIEW_REQUESTS_KEY);
      setSelectedServices([]);setNotice('');setTab('catalog');
      await loadData();
      return;
    }
    if(identity?.mode==='admin'){
      if(isPagesPreviewHost)window.location.href=PREVIEW_PRODUCTION_ORIGIN;
      else window.location.hash='';
      return;
    }
    if(identity?.mode==='seller'){
      await supabase.auth.signOut();
    }else{
      await fetch('/api/partner-data?area=auth',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'logout'})
      });
    }
    setIdentity(null);setData(null);setSellerToken('');setSelectedHotelId('');
    setSelectedServices([]);setNotice('');setTab('catalog');
    setSellerPassword('');setPartnerPassword('');
  }

  function addService(selection:PortalCatalogSelection){
    const item:SelectedService={...selection,key:String(Date.now())+'-'+String(Math.random()).slice(2),date:'',notes:''};
    setSelectedServices(current=>[...current,item]);
    setNotice('');
  }

  function updateService(key:string,patch:Partial<SelectedService>){
    setSelectedServices(current=>current.map(item=>item.key===key?{...item,...patch}:item));
  }

  function removeService(key:string){
    setSelectedServices(current=>current.filter(item=>item.key!==key));
  }

  async function requestCreated(code:string){
    setSelectedServices([]);
    setNotice(data?.preview_safe?'Solicitud DEMO '+code+' guardada localmente; no se envió a LINK Ventas ni a Supabase.':'Solicitud '+code+' recibida. Quedó pendiente de confirmación.');
    setTab('reservations');
    try{await loadData(sellerToken||undefined)}catch(_error){setError('La solicitud quedó registrada; actualiza para consultar su estado.');}
  }

  if(checking)return <main className="partner-shell"><div className="partner-loading">Preparando Hotel Experience…</div></main>;

  if(!identity||!data){
    if(isPagesPreviewHost)return <main className="partner-shell partner-login-page"><section className="partner-login"><div className="partner-login-copy"><span className="partner-eyebrow">LINK VENTAS · DEMO AISLADA</span><h1>Identidad de demostración</h1><p>La vista previa no ha podido cargar sus datos sintéticos. No se ha utilizado ninguna sesión real ni se ha consultado información privada.</p></div><div className="partner-login-card"><div className="partner-login-icon"><ShieldCheck size={20}/></div><h2>Entorno DEMO</h2>{error&&<div className="partner-error">{error}</div>}<button type="button" onClick={()=>void loadData()} disabled={loading}>{loading?'Preparando…':'Reintentar demo'}</button><a className="partner-back-link" href="https://link-ventas-hotel.pages.dev">Volver a LINK Ventas</a></div></section></main>;
    return <main className="partner-shell partner-login-page">
      <section className="partner-login">
        <div className="partner-login-copy">
          <span className="partner-eyebrow">LINK VENTAS · BY HOTEL EXPERIENCE</span>
          <h1>Un solo espacio para cotizar y registrar solicitudes.</h1>
          <p>Consulta productos, compara tramos TV1.2 y registra solicitudes para los hoteles autorizados. Cada punto de venta queda limitado a su hotel; cada vendedor, a sus hoteles asignados.</p>
          <div className="partner-security"><ShieldCheck size={18}/><span>Las solicitudes no confirman reservas ni generan cobros o mensajes. Los precios internos y comisiones no se muestran.</span></div>
        </div>
        <form className="partner-login-card" onSubmit={login}>
          <div className="partner-login-icon"><KeyRound size={20}/></div>
          <span className="partner-eyebrow">ACCESO COMPARTIDO</span>
          <h2>Ingresa a tu espacio</h2>
          <div className="partner-login-modes">
            <button type="button" className={loginMode==='hotel'?'active':''} onClick={()=>{setLoginMode('hotel');setError('')}}><Hotel size={14}/> Recepción</button>
            <button type="button" className={loginMode==='seller'?'active':''} onClick={()=>{setLoginMode('seller');setError('')}}><UserRound size={14}/> Vendedor</button>
          </div>
          {loginMode==='hotel'?<>
            <label><span>Código de hotel</span><input value={accessCode} onChange={e=>setAccessCode(e.target.value.toUpperCase())} placeholder="Código asignado" autoComplete="username"/></label>
            <label><span>Contraseña</span><input type="password" value={partnerPassword} onChange={e=>setPartnerPassword(e.target.value)} placeholder="Contraseña asignada" autoComplete="current-password"/></label>
          </>:<>
            <label><span>Correo de vendedor</span><input type="email" value={sellerEmail} onChange={e=>setSellerEmail(e.target.value)} placeholder="correo@ejemplo.com" autoComplete="username"/></label>
            <label><span>Contraseña</span><input type="password" value={sellerPassword} onChange={e=>setSellerPassword(e.target.value)} placeholder="Contraseña de LINK" autoComplete="current-password"/></label>
          </>}
          {error&&<div className="partner-error">{error}</div>}
          <button disabled={loading||(loginMode==='hotel'?(!accessCode.trim()||!partnerPassword):(!sellerEmail.trim()||!sellerPassword))}>{loading?'Validando…':<>Ingresar <ArrowRight size={16}/></>}</button>
          <small>Vendedores: correo y contraseña individuales. Puntos de venta: código y contraseña propios, limitados a un hotel.</small><a className="partner-back-link" href="#/">Volver a LINK Ventas</a>
        </form>
      </section>
    </main>;
  }

  const selectedHotel=data.hotels.find(hotel=>hotel.id===selectedHotelId)||data.hotels[0];
  const visibleLeads=data.leads.filter(lead=>lead.hotel_partner_id===selectedHotelId);

  return <main className="partner-shell partner-dashboard">
    <header className="partner-topbar">
      <div>
        <span className="partner-eyebrow">LINK VENTAS · ESCRITORIO COMERCIAL</span>
        <h1>{identity.mode==='seller'?'Escritorio del vendedor':identity.mode==='admin'?'Escritorio de administración':identity.name}</h1>
        <p>{data.preview_safe?'ADMIN DEMO · identidad ficticia, sin acceso a cuentas reales':identity.mode==='seller'?'Vendedor · hoteles asignados':identity.mode==='admin'?'Administrador · sesión actual de LINK Ventas':('Punto de venta · '+(selectedHotel?.name||identity.name))}</p>
      </div>
      <div className="partner-top-actions">
        {data.preview_safe&&<button onClick={()=>{localStorage.removeItem(PREVIEW_REQUESTS_KEY);void loadData(sellerToken||undefined)}} disabled={loading}>Limpiar pruebas</button>}
        <button onClick={()=>void loadData(isPagesPreviewHost?undefined:sellerToken||undefined)} disabled={loading}><RefreshCw size={15}/> Actualizar</button>
        <button onClick={()=>{if(isPagesPreviewHost)window.location.href='https://link-ventas-hotel.pages.dev';else window.location.hash='';}}>Volver a LINK Ventas</button><button onClick={()=>void logout()}><LogOut size={15}/> {data.preview_safe?'Reiniciar demo':'Salir'}</button>
      </div>
    </header>

    {data.preview_safe&&<div className="partner-security partner-preview-banner"><ShieldCheck size={18}/><span><strong>VISTA PREVIA SEGURA · DEMO</strong> {data.preview_notice} Las solicitudes de prueba solo se guardan en este navegador, sin pasajeros ni contactos personales y sin escribir en Supabase.</span></div>}
    <section className="partner-toolbar">
      <label className="partner-hotel-select">
        <span>HOTEL DE TRABAJO</span>
        <select value={selectedHotelId} onChange={e=>setSelectedHotelId(e.target.value)} disabled={data.hotels.length===1}>
          {data.hotels.map(hotel=><option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}
        </select>
      </label>
      <div className="partner-toolbar-note"><ShieldCheck size={15}/><span>{identity.mode==='seller'?'Solo hoteles asignados a tu perfil.':identity.mode==='admin'?'Alcance de prueba: Hotel Fauna y Hotel Casa Solcor.':'Acceso limitado a este hotel.'}</span></div>
    </section>

    <section className="partner-tabs">
      <button className={tab==='catalog'?'active':''} onClick={()=>setTab('catalog')}><Hotel size={15}/> Catálogo</button>
      <button className={tab==='new'?'active':''} onClick={()=>setTab('new')}><Plus size={15}/> Nueva solicitud{selectedServices.length?' ('+selectedServices.length+')':''}</button>
      <button className={tab==='reservations'?'active':''} onClick={()=>setTab('reservations')}><ClipboardList size={15}/> Solicitudes</button>
    </section>

    {error&&<div className="partner-error partner-page-error">{error}</div>}
    {notice&&<div className="partner-success partner-page-success"><CheckCircle2 size={16}/>{notice}</div>}

    {tab==='catalog'&&<section className="partner-catalog-workspace">
      <ProductCatalogView role="viewer" publicMode extraProducts={data.catalogExtras||[]} onSelect={addService}/>
      {selectedServices.length>0&&<div className="partner-catalog-footer">
        <span>{selectedServices.length} servicio(s) seleccionados</span>
        <button className="partner-primary" onClick={()=>setTab('new')}>Continuar solicitud <ArrowRight size={15}/></button>
      </div>}
    </section>}

    {tab==='new'&&<NewRequest
      hotel={selectedHotel}
      services={selectedServices}
      onUpdate={updateService}
      onRemove={removeService}
      onBackToCatalog={()=>setTab('catalog')}
      onCreated={requestCreated}
      sellerToken={sellerToken}
      previewSafe={Boolean(data.preview_safe)}
    />}

    {tab==='reservations'&&<Reservations
      leads={visibleLeads}
      hotel={selectedHotel}
      onNew={()=>setTab('catalog')}
    />}
  </main>;
}

function NewRequest({hotel,services,onUpdate,onRemove,onBackToCatalog,onCreated,sellerToken,previewSafe}:{
  hotel:HotelOption|undefined;
  services:SelectedService[];
  onUpdate:(key:string,patch:Partial<SelectedService>)=>void;
  onRemove:(key:string)=>void;
  onBackToCatalog:()=>void;
  onCreated:(code:string)=>Promise<void>;
  sellerToken:string;
  previewSafe:boolean;
}){
  const [receptionist,setReceptionist]=useState({name:'',email:'',phone:''});
  const [passengerNames,setPassengerNames]=useState('');
  const [language,setLanguage]=useState('Español');
  const [pickup,setPickup]=useState('');
  const [specialNeeds,setSpecialNeeds]=useState('');
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');

  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();setError('');setSuccess('');
    const names=passengerNames.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    if(!hotel?.id||!receptionist.name.trim()||(!receptionist.email.trim()&&!receptionist.phone.trim())||!names.length||!language||!services.length){
      setError('Completa recepcionista, contacto, pasajeros, idioma y al menos un servicio.');
      return;
    }
    setSending(true);
    try{
      if(previewSafe){
        const code='DEMO-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
        const lead:PartnerLead={
          id:'demo-'+code,codigo:code,
          reserva:services.map(item=>item.product_name).join(' + '),
          numero_pax:Math.max(names.length,...services.map(item=>item.pax)),
          contacto:'Datos personales omitidos en modo demo',
          empresa_ejecuta:hotel.name,
          estado:'Solicitud DEMO · no enviada',
          estado_raw:'nuevo',
          created_at:new Date().toISOString(),
          hotel_partner_id:hotel.id,
          services:services.map((item,index)=>({
            id:'demo-service-'+index,producto:item.product_name,fecha_servicio:item.date||null,
            numero_pax:item.pax,estado:'Pendiente · DEMO',idioma:language,hotel_partner_id:hotel.id
          }))
        };
        const current=readPreviewLeads();
        localStorage.setItem(PREVIEW_REQUESTS_KEY,JSON.stringify([lead,...current].slice(0,50)));
        setSuccess('Solicitud DEMO '+code+' guardada solo en este navegador. No se envió a LINK Ventas ni a Supabase.');
        await onCreated(code);
        return;
      }
      const headers:Record<string,string>={'Content-Type':'application/json'};
      if(sellerToken)headers.Authorization='Bearer '+sellerToken;
      const response=await fetch('/api/partner-data',{
        method:'POST',headers,
        body:JSON.stringify({
          hotel_partner_id:hotel.id,
          receptionist,
          passenger_names:names,
          language,
          pickup_location:pickup,
          special_needs:specialNeeds,
          services:services.map(item=>({
            kind:item.kind,product_id:item.product_id,product_name:item.product_name,
            tour_id:item.tour_id,family_id:item.family_id,modality:item.modality,pax:item.pax,date:item.date,
            notes:item.notes,language
          }))
        })
      });
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||'No se pudo registrar la solicitud.');
      setSuccess('Solicitud '+body.codigo+' recibida y pendiente de confirmación.');
      await onCreated(body.codigo);
    }catch(e:any){setError(e.message||'No se pudo registrar la solicitud.')}
    finally{setSending(false)}
  };

  return <div className="partner-content">
    <section className="partner-panel">
      <div className="partner-panel-head">
        <div><span className="partner-eyebrow">SOLICITUD NUEVA</span><h2>{hotel?.name||'Hotel'}</h2></div>
        <small>{services.length} servicio(s)</small>
      </div>
      <form className="partner-request-form" onSubmit={submit}>
        <div className="partner-section-label">01 · RECEPCIÓN Y CONTACTO</div>
        <div className="partner-form-grid">
          <Field label="Recepcionista *"><input value={receptionist.name} onChange={e=>setReceptionist(x=>({...x,name:e.target.value}))} placeholder="Nombre de quien solicita"/></Field>
          <Field label="Correo de contacto"><input type="email" value={receptionist.email} onChange={e=>setReceptionist(x=>({...x,email:e.target.value}))} placeholder="recepcion@hotel.com"/></Field>
          <Field label="Teléfono / WhatsApp"><input value={receptionist.phone} onChange={e=>setReceptionist(x=>({...x,phone:e.target.value}))} placeholder="+56…"/></Field>
          <Field label="Hotel"><input value={hotel?.name||''} readOnly/></Field>
        </div>

        <div className="partner-section-label">02 · PASAJEROS</div>
        <Field label="Nombre de pasajeros · uno por línea *" wide><textarea rows={3} value={passengerNames} onChange={e=>setPassengerNames(e.target.value)} placeholder={'Nombre y apellido\nNombre y apellido'}/></Field>
        <div className="partner-form-grid">
          <Field label="Idioma de atención *"><select value={language} onChange={e=>setLanguage(e.target.value)}><option>Español</option><option>Português</option><option>English</option><option>Otro / por definir</option></select></Field>
          <Field label="Punto de recogida"><input value={pickup} onChange={e=>setPickup(e.target.value)} placeholder="Hotel, dirección o referencia"/></Field>
        </div>

        <div className="partner-products-head">
          <div><span className="partner-eyebrow">03 · SERVICIOS</span><h3>Experiencias seleccionadas</h3></div>
          <button type="button" onClick={onBackToCatalog}><Plus size={14}/> Agregar servicios</button>
        </div>
        <div className="partner-selected-services">
          {services.map((item,index)=><article key={item.key}>
            <div className="partner-product-number">{String(index+1).padStart(2,'0')}</div>
            <div className="partner-selected-service-copy">
              <strong>{item.product_name}</strong>
              <small>{item.kind==='tour'?(item.modality||'').replace('low','Compartido').replace('semiprivado','Semiprivado').replace('privado','Privado')+' · ':''}{item.pax} pax</small>
              <span>{priceSummary(item)}</span>
            </div>
            <div className="partner-form-grid">
              <Field label="Fecha solicitada"><input type="date" value={item.date} onChange={e=>onUpdate(item.key,{date:e.target.value})}/></Field>
              <Field label="Pasajeros"><input value={String(item.pax)} readOnly/></Field>
              <Field label="Necesidad del servicio" wide><input value={item.notes} onChange={e=>onUpdate(item.key,{notes:e.target.value})} placeholder="Horario preferido, observaciones…"/></Field>
            </div>
            <button type="button" className="partner-remove-product" onClick={()=>onRemove(item.key)}><Trash2 size={14}/> Quitar servicio</button>
          </article>)}
          {!services.length&&<div className="partner-empty">Todavía no agregas servicios. Abre el catálogo para seleccionar experiencias o traslados.</div>}
        </div>

        <div className="partner-section-label">04 · NECESIDADES ESPECIALES</div>
        <Field label="Observaciones relevantes" wide><textarea rows={4} value={specialNeeds} onChange={e=>setSpecialNeeds(e.target.value)} placeholder="Movilidad, alimentación, accesibilidad u otras necesidades que LINK deba revisar."/></Field>
        <p className="partner-request-disclaimer">Los precios se calculan con el catálogo y los tramos TV1.2. Guardar registra una solicitud pendiente: no confirma disponibilidad ni reserva, no cobra y no envía mensajes.</p>
        {error&&<div className="partner-error">{error}</div>}
        {success&&<div className="partner-success"><CheckCircle2 size={16}/>{success}</div>}
        <div className="partner-submit-row"><button disabled={sending||!services.length}>{sending?'Registrando…':'Enviar solicitud'} <ArrowRight size={15}/></button></div>
      </form>
    </section>
  </div>;
}

function Reservations({leads,hotel,onNew}:{leads:PartnerLead[];hotel:HotelOption|undefined;onNew:()=>void}){
  return <div className="partner-content">
    <section className="partner-kpis">
      <Kpi label="Solicitudes del hotel" value={leads.length}/>
      <Kpi label="Pendientes de revisión" value={leads.filter(item=>['nuevo','contactado'].includes(item.estado_raw)).length}/>
      <Kpi label="Cotizadas" value={leads.filter(item=>item.estado_raw==='cotizado').length}/>
      <Kpi label="Confirmadas" value={leads.filter(item=>item.estado_raw==='confirmado').length}/>
    </section>
    <section className="partner-panel">
      <div className="partner-panel-head">
        <div><span className="partner-eyebrow">SEGUIMIENTO</span><h2>Solicitudes · {hotel?.name||'Hotel'}</h2></div>
        <button className="partner-refresh" onClick={onNew}><Plus size={14}/> Nueva solicitud</button>
      </div>
      <div className="partner-reservations">
        {leads.map(lead=><article key={lead.id} className="partner-reservation">
          <div className="partner-reservation-head">
            <div><span>{lead.codigo}</span><h3>{lead.reserva}</h3><p>{lead.services.length} servicio(s) · {lead.numero_pax} pasajeros</p></div>
            <strong className={'partner-stage '+stageClass(lead.estado_raw)}>{lead.estado}</strong>
          </div>
          <div className="partner-service-list">
            {lead.services.map(service=><div key={service.id}>
              <span><b>{service.producto}</b><small>{dateFmt(service.fecha_servicio)} · {service.numero_pax} pax · {service.idioma||'Idioma por definir'}</small></span>
              <span><em>{service.estado}</em></span>
            </div>)}
            {!lead.services.length&&<p className="partner-muted">Aún no hay servicios asociados.</p>}
          </div>
        </article>)}
        {!leads.length&&<div className="partner-empty">Todavía no hay solicitudes para este hotel.</div>}
      </div>
    </section>
  </div>;
}

function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}){
  return <label className={wide?'partner-field wide':'partner-field'}><span>{label}</span>{children}</label>;
}
function Kpi({label,value}:{label:string;value:number}){
  return <div><small>{label}</small><strong>{value}</strong></div>;
}
function priceSummary(item:SelectedService){
  if(item.pricing_status!=='quoted'||item.unit_price_clp==null)return 'Precio por confirmar';
  if(item.kind==='tour'||item.price_unit==='por persona'){
    return money(item.unit_price_clp)+' por persona · total '+money(item.total_price_clp);
  }
  return money(item.unit_price_clp)+' '+item.price_unit;
}
function money(value:number|null|undefined){
  if(value==null)return'Precio por confirmar';
  return new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value);
}
function dateFmt(value?:string|null){
  return value?new Date(value+'T12:00:00').toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'}):'Fecha por definir';
}
function stageClass(value:string){
  return value==='confirmado'?'confirmed':value==='cotizado'?'quoted':value==='perdido'?'closed':'pending';
}
