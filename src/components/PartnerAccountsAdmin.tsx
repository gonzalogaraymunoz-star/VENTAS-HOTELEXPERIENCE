import React,{useEffect,useState} from 'react';
import {Building2,Copy,KeyRound,Plus,RefreshCw,RotateCcw,ShieldCheck,UserRound,Store,UserPlus} from 'lucide-react';
const isDemoPreviewHost=window.location.hostname.endsWith('.link-ventas-hotel.pages.dev')&&window.location.hostname!=='link-ventas-hotel.pages.dev';
import './PartnerPortal.css';

type Hotel={id:string;name:string;slug:string;lead_prefix:string};
type Account={id:string;name:string;scope_value:string;lead_prefix:string;access_code:string;active:boolean;last_login_at?:string|null};
type Seller={id:string;full_name:string|null;email:string|null;is_active:boolean};
type Assignment={seller_profile_id:string;hotel_partner_id:string};
type Credentials={kind:string;name:string;username:string;password:string};

export default function PartnerAccountsAdmin(){
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [sellers,setSellers]=useState<Seller[]>([]);
  const [hotels,setHotels]=useState<Hotel[]>([]);
  const [assignments,setAssignments]=useState<Assignment[]>([]);
  const [loading,setLoading]=useState(true);
  const [previewSafe,setPreviewSafe]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [credential,setCredential]=useState<Credentials|null>(null);
  const [posForm,setPosForm]=useState({hotelId:'',name:'',notes:''});
  const [sellerForm,setSellerForm]=useState({name:'',email:'',hotelIds:[] as string[]});

  const request=async(method:string,body?:any)=>{
    if(isDemoPreviewHost&&method!=='GET')throw new Error('La administración DEMO es de solo lectura.');
    const headers:Record<string,string>={};
    if(!isDemoPreviewHost){
      const {data:{session}}=await import('../lib/supabase').then(module=>module.supabase.auth.getSession());
      if(!session?.access_token)throw new Error('La sesión administrativa expiró.');
      headers.Authorization='Bearer '+session.access_token;
    }
    if(body)headers['Content-Type']='application/json';
    const response=await fetch('/api/partner-admin',{
      method,
      headers,
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'No se pudo administrar los accesos.');
    return result;
  };

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const result=await request('GET');
      setPreviewSafe(Boolean(result.preview_safe));
      setAccounts(result.accounts||[]);
      setSellers(result.sellers||[]);
      setHotels(result.hotels||[]);
      setAssignments(result.assignments||[]);
      setPosForm(current=>({...current,hotelId:current.hotelId||result.hotels?.[0]?.id||''}));
    }catch(e:any){setError(e.message||'No se pudo cargar la administración.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);

  const createPos=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const result=await request('POST',{action:'create_pos',hotel_partner_id:posForm.hotelId,name:posForm.name,notes:posForm.notes});
      setCredential({kind:'Punto de venta',name:result.account.name,username:result.account.access_code,password:result.temporary_password});
      setPosForm(current=>({...current,name:'',notes:''}));
      await load();
    }catch(e:any){setError(e.message||'No se pudo crear el acceso.');}
    finally{setBusy(false);}
  };

  const createSeller=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const result=await request('POST',{action:'create_seller',name:sellerForm.name,email:sellerForm.email,hotel_partner_ids:sellerForm.hotelIds});
      setCredential({kind:'Vendedor',name:result.seller.full_name,username:result.seller.email,password:result.temporary_password});
      setSellerForm({name:'',email:'',hotelIds:[]});
      await load();
    }catch(e:any){setError(e.message||'No se pudo crear el vendedor.');}
    finally{setBusy(false);}
  };

  const toggleHotel=(hotelId:string)=>{
    setSellerForm(current=>({...current,hotelIds:current.hotelIds.includes(hotelId)?current.hotelIds.filter(id=>id!==hotelId):[...current.hotelIds,hotelId]}));
  };

  const assign=async(sellerId:string,hotelId:string,enabled:boolean)=>{
    setBusy(true);setError('');
    try{await request('POST',{action:'assign_seller',seller_profile_id:sellerId,hotel_partner_id:hotelId,enabled});await load();}
    catch(e:any){setError(e.message||'No se pudo actualizar la asignación.');}
    finally{setBusy(false);}
  };

  const reset=async(kind:'pos'|'seller',item:any)=>{
    if(!window.confirm('¿Generar una nueva contraseña para '+(item.name||item.full_name||item.email)+'?'))return;
    setBusy(true);setError('');
    try{
      const result=await request('POST',{action:kind==='pos'?'reset_pos_password':'reset_seller_password',id:item.id});
      setCredential({
        kind:kind==='pos'?'Punto de venta':'Vendedor',
        name:item.name||item.full_name||item.email,
        username:kind==='pos'?item.access_code:item.email,
        password:result.temporary_password
      });
    }catch(e:any){setError(e.message||'No se pudo renovar la contraseña.');}
    finally{setBusy(false);}
  };

  const toggle=async(kind:'pos'|'seller',item:any)=>{
    setBusy(true);setError('');
    try{
      await request('POST',{action:kind==='pos'?'toggle_pos':'toggle_seller',id:item.id,active:!item.active&&!item.is_active});
      await load();
    }catch(e:any){setError(e.message||'No se pudo cambiar el estado.');}
    finally{setBusy(false);}
  };

  const copy=(value:string)=>navigator.clipboard?.writeText(value);

  return <main className="partner-shell partner-admin-page">
    <header className="partner-admin-head">
      <div><span className="partner-eyebrow">LINK VENTAS · CONTROL DE ACCESOS</span><h1>Vendedores y puntos de venta</h1><p>Cada persona o punto de venta tiene credenciales propias y trabaja solo con los hoteles autorizados.</p></div>
      <div><a href="#/">Volver a LINK Ventas</a><button className="dark" onClick={()=>void load()} disabled={busy}><RefreshCw size={14}/> Actualizar</button></div>
    </header>

    {credential&&<section className="partner-credential">
      <div><ShieldCheck size={18}/><span><small>CREDENCIALES · MOSTRAR Y COPIAR AHORA</small><strong>{credential.kind} · {credential.name}</strong></span></div>
      <div className="partner-credential-value"><small>{credential.kind==='Vendedor'?'Correo':'Código de acceso'}</small><strong>{credential.username}</strong><button type="button" onClick={()=>copy(credential.username)}><Copy size={14}/></button></div>
      <div className="partner-credential-value"><small>Contraseña temporal</small><strong>{credential.password}</strong><button type="button" onClick={()=>copy(credential.password)}><Copy size={14}/></button></div>
      <button onClick={()=>setCredential(null)}>Listo</button>
    </section>}

    {previewSafe&&<div className="partner-security partner-preview-banner"><ShieldCheck size={18}/><span><strong>VISTA PREVIA SEGURA · SOLO LECTURA</strong> Puedes revisar el panel y los hoteles de alcance, pero crear, activar, asignar o renovar accesos está bloqueado en este entorno.</span></div>}
    {error&&<div className="partner-error partner-page-error">{error}</div>}

    <section className="partner-admin-grid">
      <form className="partner-panel partner-create-account" onSubmit={createPos}>
        <div className="partner-panel-head"><div><span className="partner-eyebrow">ACCESO DE PUNTO DE VENTA</span><h2>Crear login de recepción</h2></div><Store size={18}/></div>
        <div className="partner-form-grid">
          <Field label="Hotel autorizado *"><select value={posForm.hotelId} onChange={e=>setPosForm(x=>({...x,hotelId:e.target.value}))}><option value="">Seleccionar hotel</option>{hotels.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
          <Field label="Nombre del punto de venta *"><input value={posForm.name} onChange={e=>setPosForm(x=>({...x,name:e.target.value}))} placeholder="Ej. Recepción principal · turno mañana" required/></Field>
          <Field label="Notas internas" wide><textarea rows={3} value={posForm.notes} onChange={e=>setPosForm(x=>({...x,notes:e.target.value}))} placeholder="Identificación del puesto o responsable."/></Field>
        </div>
        <div className="partner-admin-note"><KeyRound size={15}/><span>Cada login queda vinculado a un solo hotel. Puedes crear varios puntos de venta para el mismo hotel; el código y la contraseña se generan una sola vez.</span></div>
        <button className="partner-primary" disabled={previewSafe||busy||!posForm.hotelId||!posForm.name.trim()}>{busy?'Creando…':'Crear acceso de punto de venta'}</button>
      </form>

      <form className="partner-panel partner-create-account" onSubmit={createSeller}>
        <div className="partner-panel-head"><div><span className="partner-eyebrow">ACCESO INDIVIDUAL</span><h2>Crear login de vendedor</h2></div><UserPlus size={18}/></div>
        <div className="partner-form-grid">
          <Field label="Nombre completo *"><input value={sellerForm.name} onChange={e=>setSellerForm(x=>({...x,name:e.target.value}))} required placeholder="Nombre del vendedor"/></Field>
          <Field label="Correo individual *"><input type="email" value={sellerForm.email} onChange={e=>setSellerForm(x=>({...x,email:e.target.value}))} required placeholder="vendedor@empresa.com"/></Field>
        </div>
        <div className="partner-access-hotels"><span className="partner-eyebrow">HOTELES ASIGNADOS *</span><div>{hotels.map(h=><label key={h.id}><input type="checkbox" checked={sellerForm.hotelIds.includes(h.id)} onChange={()=>toggleHotel(h.id)}/><span>{h.name}</span></label>)}</div></div>
        <div className="partner-admin-note"><KeyRound size={15}/><span>Se crea un usuario individual de Supabase Auth, sin enviar correo automático. La contraseña temporal se muestra una vez y el vendedor puede ingresar con correo y contraseña.</span></div>
        <button className="partner-primary" disabled={previewSafe||busy||!sellerForm.name.trim()||!sellerForm.email.trim()||!sellerForm.hotelIds.length}>{busy?'Creando…':'Crear vendedor y asignar hoteles'}</button>
      </form>
    </section>

    <section className="partner-panel">
      <div className="partner-panel-head"><div><span className="partner-eyebrow">PUNTOS DE VENTA</span><h2>Accesos de recepción</h2></div><Building2 size={18}/></div>
      {loading?<div className="partner-empty">Cargando accesos…</div>:<div className="partner-account-list">
        {accounts.map(account=><article key={account.id}>
          <div className="partner-account-icon"><Store size={17}/></div>
          <div className="partner-account-copy"><strong>{account.name}</strong><span>{account.access_code} · {account.lead_prefix}</span><small>{account.scope_value}{account.last_login_at?' · último acceso '+new Date(account.last_login_at).toLocaleString('es-CL'):' · nunca ha ingresado'}</small></div>
          <span className={account.active?'partner-account-state active':'partner-account-state'}>{account.active?'Activo':'Desactivado'}</span>
          <button type="button" onClick={()=>void reset('pos',account)} disabled={previewSafe||busy} title="Renovar contraseña"><RotateCcw size={14}/></button>
          <button type="button" onClick={()=>void toggle('pos',account)} disabled={previewSafe||busy}>{account.active?'Desactivar':'Activar'}</button>
        </article>)}
        {!accounts.length&&<div className="partner-empty">Todavía no hay puntos de venta con login propio.</div>}
      </div>}
    </section>

    <section className="partner-panel partner-seller-admin">
      <div className="partner-panel-head"><div><span className="partner-eyebrow">VENDEDORES</span><h2>Usuarios y hoteles asignados</h2></div><UserRound size={18}/></div>
      <p className="partner-admin-note">Un vendedor puede trabajar con más de un hotel. Solo verá solicitudes y podrá crear solicitudes para los hoteles que estén asignados aquí.</p>
      {loading?<div className="partner-empty">Cargando vendedores…</div>:sellers.length?<div className="partner-seller-list">
        {sellers.map(seller=><article className="partner-seller-row" key={seller.id}>
          <div><strong>{seller.full_name||seller.email||'Vendedor'}</strong><small>{seller.email||'Sin correo'} · {seller.is_active?'Activo':'Desactivado'}</small></div>
          {hotels.map(hotel=>{
            const checked=assignments.some(a=>a.seller_profile_id===seller.id&&a.hotel_partner_id===hotel.id);
            return <label key={hotel.id}><input type="checkbox" checked={checked} disabled={previewSafe||busy||!seller.is_active} onChange={()=>void assign(seller.id,hotel.id,!checked)}/><span>{hotel.name}</span></label>;
          })}
          <button type="button" onClick={()=>void reset('seller',seller)} disabled={previewSafe||busy||!seller.is_active} title="Renovar contraseña"><RotateCcw size={14}/></button>
          <button type="button" onClick={()=>void toggle('seller',seller)} disabled={previewSafe||busy}>{seller.is_active?'Desactivar':'Activar'}</button>
        </article>)}
      </div>:<div className="partner-empty">Todavía no hay vendedores con login individual.</div>}
    </section>
  </main>;
}

function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}){
  return <label className={wide?'partner-field wide':'partner-field'}><span>{label}</span>{children}</label>;
}
