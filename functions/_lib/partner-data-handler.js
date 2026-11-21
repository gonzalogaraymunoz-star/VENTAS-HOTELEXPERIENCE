import {
  crmUserFrom,destroyPartnerSession,getPartnerSession,issuePartnerSession,noStore,
  isPreviewSafe,previewAdminFrom,previewHotels,publicAccount,setupAdmin,verifyPassword
} from './partner-portal.js';
import { resolveCatalogService,resolveTv12Service } from './tv12-pricing.js';

function normalized(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

async function resolveIdentity(req,admin){
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(token){
    const {user,profile}=await crmUserFrom(req,admin);
    if(profile.role==='admin'){
      const {data:hotels,error:hotelError}=await admin.from('hotel_partners')
        .select('id,name,slug,active').eq('active',true).in('slug',['hotel-fauna','hotel-casa-solcor']).order('name');
      if(hotelError)throw hotelError;
      if(!hotels?.length)throw Object.assign(new Error('No hay hoteles autorizados activos para el escritorio.'),{status:403});
      return {
        mode:'admin',user,profile,account:null,hotels,hotelIds:hotels.map(h=>h.id),
        identity:{mode:'admin',name:profile.full_name||user.email||'Administración',email:user.email||'',role:'admin',can_create_requests:true}
      };
    }
    if(profile.role!=='agent')throw Object.assign(new Error('Este acceso requiere un perfil vendedor activo.'),{status:403});
    const {data:assignments,error}=await admin.from('seller_partner_assignments')
      .select('hotel_partner_id').eq('seller_profile_id',user.id);
    if(error)throw error;
    const ids=[...new Set((assignments||[]).map(row=>row.hotel_partner_id).filter(Boolean))];
    if(!ids.length)throw Object.assign(new Error('Tu perfil todavía no tiene hoteles asignados.'),{status:403});
    const {data:hotels,error:hotelError}=await admin.from('hotel_partners')
      .select('id,name,slug,active').in('id',ids).eq('active',true).order('name');
    if(hotelError)throw hotelError;
    if(!hotels?.length)throw Object.assign(new Error('No hay hoteles activos asignados a este perfil.'),{status:403});
    return {
      mode:'seller',user,profile,account:null,hotels,
      hotelIds:hotels.map(h=>h.id),
      identity:{mode:'seller',name:profile.full_name||user.email||'Vendedor',email:user.email||'',role:profile.role,can_create_requests:true}
    };
  }

  const current=await getPartnerSession(req,admin);
  if(!current)throw Object.assign(new Error('Tu sesión B2B expiró. Vuelve a ingresar.'),{status:401});
  const account=current.account;
  if(account.partner_type!=='hotel')throw Object.assign(new Error('Este portal admite cuentas de hotel.'),{status:403});
  const {data:allHotels,error}=await admin.from('hotel_partners')
    .select('id,name,slug,active').eq('active',true);
  if(error)throw error;
  const target=normalized(account.scope_value);
  const hotel=(allHotels||[]).find(item=>normalized(item.name)===target||normalized(item.slug)===target);
  if(!hotel)throw Object.assign(new Error('La cuenta no está vinculada a un hotel activo.'),{status:403});
  return {
    mode:'hotel',user:null,profile:null,account,hotels:[hotel],hotelIds:[hotel.id],
    identity:{mode:'hotel',...publicAccount(account),hotel_partner_id:hotel.id}
  };
}

function leadLabel(value){
  const map={
    nuevo:'Solicitud recibida · pendiente de confirmación',
    contactado:'En revisión',
    cotizado:'Cotizada',
    confirmado:'Confirmada',
    perdido:'Cerrada'
  };
  return map[String(value||'').toLowerCase()]||'En revisión';
}
function serviceLabel(value){
  if(value==='confirmed')return 'Confirmado';
  if(value==='completed')return 'Realizado';
  if(value==='cancelled')return 'Cancelado';
  if(value==='expired')return 'Vencido';
  return 'Pendiente de confirmación';
}

async function loadPublicExtras(admin){
  const categories=['Transporte','Salud','Procedimientos','SPA / Terapias'];
  const {data,error}=await admin.from('product_catalog')
    .select('id,code,name,category,description,price_mode,prices,active')
    .eq('active',true).in('category',categories).order('category').order('name');
  if(error)throw error;
  return (data||[]).map(product=>{
    const source=product.prices||{};
    const mode=String(product.price_mode||'');
    const prices={};
    let publicMode=mode;
    let publicUnit='por servicio';
    if(mode==='private_per_pax'||mode==='regular_per_pax'){
      publicUnit='por persona';
      for(let pax=1;pax<=20;pax++){
        const value=Number(source[String(pax)]||0);
        if(value>0)prices[String(pax)]=value;
      }
    }else if(mode==='regular_commission'){
      publicMode='regular_per_pax';
      publicUnit='por persona';
      const value=Number(source.sale||0);
      if(value>0)for(let pax=1;pax<=20;pax++)prices[String(pax)]=value;
    }else if(mode==='hotel_fixed'||mode==='lowcost_transport'){
      publicMode='hotel_fixed';
      publicUnit=product.category==='Transporte'&&mode==='lowcost_transport'?'por traslado':'por servicio';
      const value=Number(source.hotel_sale||0);
      if(value>0)prices.hotel_sale=value;
    }
    return {
      id:product.id,code:product.code,name:product.name,category:product.category,
      description:product.description||'',price_mode:publicMode,public_unit:publicUnit,
      prices,active:true
    };
  });
}

async function loadPartnerLeads(admin,identity){
  const fields='id,codigo,reserva,numero_pax,contacto,empresa_ejecuta,estado,checkin,checkout,created_at,hotel_partner_id';
  const {data:leads,error}=await admin.from('leads')
    .select(fields).in('hotel_partner_id',identity.hotelIds)
    .order('created_at',{ascending:false}).limit(250);
  if(error)throw error;
  const ids=(leads||[]).map(item=>item.id);
  let services=[];
  if(ids.length){
    const {data,error:serviceError}=await admin.from('lead_services')
      .select('id,lead_id,producto,fecha_servicio,numero_pax,booking_status,idioma')
      .in('lead_id',ids).order('fecha_servicio',{ascending:true}).limit(1500);
    if(serviceError)throw serviceError;
    services=data||[];
  }
  const safeLeads=(leads||[]).map(lead=>({
    id:lead.id,codigo:lead.codigo,reserva:lead.reserva,numero_pax:lead.numero_pax,
    contacto:lead.contacto,empresa_ejecuta:lead.empresa_ejecuta,hotel_partner_id:lead.hotel_partner_id,
    estado:leadLabel(lead.estado),estado_raw:lead.estado,
    checkin:lead.checkin,checkout:lead.checkout,created_at:lead.created_at,
    services:services.filter(service=>service.lead_id===lead.id).map(service=>({
      id:service.id,producto:service.producto,fecha_servicio:service.fecha_servicio,
      numero_pax:service.numero_pax,estado:serviceLabel(service.booking_status),idioma:service.idioma
    }))
  }));
  return safeLeads;
}

function cleanText(value,max=500){
  return String(value||'').trim().slice(0,max);
}

async function resolveRequestedServices(admin,input){
  const rows=Array.isArray(input)?input:[];
  if(!rows.length||rows.length>30)throw new Error('Agrega entre 1 y 30 servicios por solicitud.');
  const output=[];
  for(const item of rows){
    const pax=Math.max(1,Math.min(99,Number(item?.pax||1)));
    const date=cleanText(item?.date,10);
    const notes=cleanText(item?.notes,600);
    if(item?.kind==='tour'){
      const quote=resolveTv12Service({tour_id:item.tour_id,modality:item.modality,pax});
      output.push({...quote,date,notes,idioma:cleanText(item?.language,40)});
      continue;
    }
    if(item?.kind==='extra'){
      const productId=cleanText(item?.product_id,80);
      if(!productId)throw new Error('Falta identificar un servicio complementario.');
      const {data:product,error}=await admin.from('product_catalog')
        .select('id,code,name,category,description,price_mode,prices,active')
        .eq('id',productId).eq('active',true).maybeSingle();
      if(error)throw error;
      if(!product||!['Transporte','Salud','Procedimientos','SPA / Terapias'].includes(product.category)){
        throw new Error('El servicio complementario ya no está disponible.');
      }
      output.push({...resolveCatalogService(product,{pax}),date,notes,idioma:cleanText(item?.language,40)});
      continue;
    }
    throw new Error('Uno de los servicios seleccionados no tiene un tipo válido.');
  }
  return output;
}

export default async function handler(req,res,env){
  noStore(res);
  try{
    const area=String(req.query?.area||'').toLowerCase();
    if(isPreviewSafe(env)){
      if(area==='auth'&&req.method==='GET')return res.status(401).json({authenticated:false,preview_safe:true});
      if(area==='auth')return res.status(403).json({error:'La vista previa segura no permite iniciar cuentas de recepción ni modificar sesiones.'});
      const {user,profile}=await previewAdminFrom(req,env);
      return res.status(200).json({
        identity:{mode:'admin',name:profile.full_name||user.email||'Administración',email:user.email||'',role:'admin',can_create_requests:true},
        hotels:previewHotels(),catalogExtras:[],
        summary:{total:0,confirmed:0,pending:0,quoted:0},leads:[],
        preview_safe:true,
        preview_notice:'Entorno de prueba aislado. Los datos y solicitudes son demostrativos y no se conectan a registros comerciales.'
      });
    }
    const admin=setupAdmin(env);

    if(area==='auth'){
      if(req.method==='GET'){
        try{
          const identity=await resolveIdentity(req,admin);
          return res.status(200).json({authenticated:true,identity:identity.identity,hotels:identity.hotels});
        }catch(error){
          if(error.status===401)return res.status(401).json({authenticated:false});
          throw error;
        }
      }
      if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
      const action=String(req.body?.action||'login');
      if(action==='logout'){
        await destroyPartnerSession(req,res,admin);
        return res.status(200).json({ok:true});
      }
      if(action!=='login')return res.status(400).json({error:'Acción inválida.'});
      const accessCode=cleanText(req.body?.accessCode,100).toUpperCase();
      const password=String(req.body?.password||'').slice(0,200);
      const generic='Credenciales incorrectas o acceso desactivado.';
      if(!accessCode||!password)return res.status(401).json({error:generic});
      const {data:account,error}=await admin.from('partner_portal_accounts')
        .select('*').eq('access_code',accessCode).maybeSingle();
      if(error)throw error;
      if(!account?.active||account.partner_type!=='hotel'||!(await verifyPassword(password,account.password_hash))){
        await new Promise(resolve=>setTimeout(resolve,300));
        return res.status(401).json({error:generic});
      }
      await admin.from('partner_portal_sessions').delete().lt('expires_at',new Date().toISOString());
      await admin.from('partner_portal_accounts')
        .update({last_login_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        .eq('id',account.id);
      await issuePartnerSession(res,admin,account.id);
      return res.status(200).json({authenticated:true,identity:{mode:'hotel',...publicAccount(account)}});
    }

    const identity=await resolveIdentity(req,admin);

    if(req.method==='GET'){
      const [leads,catalogExtras]=await Promise.all([loadPartnerLeads(admin,identity),loadPublicExtras(admin)]);
      return res.status(200).json({
        identity:identity.identity,hotels:identity.hotels,catalogExtras,
        summary:{
          total:leads.length,
          confirmed:leads.filter(item=>item.estado_raw==='confirmado').length,
          pending:leads.filter(item=>['nuevo','contactado'].includes(String(item.estado_raw))).length,
          quoted:leads.filter(item=>item.estado_raw==='cotizado').length
        },
        leads
      });
    }

    if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
    if(identity.mode==='hotel'&&!identity.account.can_create_requests){
      return res.status(403).json({error:'Este acceso está configurado solo para consulta.'});
    }

    const hotelId=cleanText(req.body?.hotel_partner_id,80);
    const hotel=identity.hotels.find(item=>item.id===hotelId);
    if(!hotel)return res.status(403).json({error:'El hotel seleccionado no pertenece a tu acceso.'});

    const receptionist={
      name:cleanText(req.body?.receptionist?.name,160),
      email:cleanText(req.body?.receptionist?.email,180),
      phone:cleanText(req.body?.receptionist?.phone,100)
    };
    const passengerNames=(Array.isArray(req.body?.passenger_names)?req.body.passenger_names:[])
      .map(name=>cleanText(name,180)).filter(Boolean).slice(0,30);
    const language=cleanText(req.body?.language,40);
    const pickup=cleanText(req.body?.pickup_location,240);
    const specialNeeds=cleanText(req.body?.special_needs,1200);

    if(!receptionist.name||(!receptionist.email&&!receptionist.phone)||!passengerNames.length||!language){
      return res.status(400).json({error:'Completa recepcionista, un medio de contacto, pasajeros e idioma.'});
    }

    const services=await resolveRequestedServices(admin,req.body?.services);
    const maxPax=Math.max(passengerNames.length,1,...services.map(item=>item.pax));
    const firstDate=services.find(item=>item.date)?.date||null;
    const assignedTo=identity.mode==='seller'?identity.user.id:await (async()=>{
      const {data,error}=await admin.from('seller_partner_assignments')
        .select('seller_profile_id').eq('hotel_partner_id',hotel.id).limit(2);
      if(error)throw error;
      return data?.length===1?data[0].seller_profile_id:null;
    })();

    const intakeRequest={
      source:'link_ventas_seller_desk',
      version:'tv1.2',
      receptionist,
      hotel:{id:hotel.id,name:hotel.name},
      passenger_names:passengerNames,
      language,pickup_location:pickup,special_needs:specialNeeds,
      services:services.map(item=>({
        kind:item.kind,product_name:item.product_name,product_id:item.product_id||null,
        product_code:item.product_code||null,tour_id:item.tour_id||null,family_id:item.family_id||null,modality:item.modality||null,
        date:item.date||null,pax:item.pax,pricing_status:item.pricing_status,
        price_pp_clp:item.price_pp_clp,unit_price_clp:item.unit_price_clp,
        total_price_clp:item.total_price_clp,price_unit:item.price_unit,
        pricing_source:item.pricing_source,availability_declared:item.availability_declared??null,
        tariff_found:item.tariff_found??null,notes:item.notes||''
      }))
    };

    const leadRow={
      codigo:'PENDIENTE',
      reserva:passengerNames[0],
      numero_pax:maxPax,
      servicio:services.map(item=>item.product_name).join(' + '),
      precio_venta:0,
      moneda:'CLP',
      checkin:firstDate,
      contacto:['Recepcionista: '+receptionist.name,receptionist.email,receptionist.phone].filter(Boolean).join(' | '),
      propuesta_enviada:'Pendiente',
      empresa_ejecuta:hotel.name,
      prioridad:'Media',
      estado:'nuevo',
      canal:'LINK Ventas · Escritorio vendedor',
      created_by:identity.user?.id||null,
      assigned_to:assignedTo,
      assigned_at:assignedTo?new Date().toISOString():null,
      hotel_partner_id:hotel.id,
      partner_account_id:identity.account?.id||null,
      lifecycle_stage:'commercial',
      sales_stage:'quote_intake',
      pickup_location:pickup||null,
      intake_request:intakeRequest
    };

    const {data:lead,error:leadError}=await admin.from('leads').insert(leadRow).select('id,codigo').single();
    if(leadError)throw leadError;

    try{
      const passengerRows=passengerNames.map((full_name,index)=>({
        lead_id:lead.id,
        passenger_code:lead.codigo+'-P'+String(index+1).padStart(2,'0'),
        full_name,
        is_primary:index===0,
        created_by:identity.user?.id||null
      }));
      const {error:passengerError}=await admin.from('passengers').insert(passengerRows);
      if(passengerError)throw passengerError;

      const serviceRows=services.map(item=>({
        lead_id:lead.id,
        product_catalog_id:item.product_id||null,
        producto:item.product_name,
        fecha_servicio:item.date||null,
        numero_pax:item.pax,
        observacion:item.notes||'',
        precio_venta:0,
        moneda:'CLP',
        estado_pago:'Pendiente',
        estado_operacion:'Pendiente',
        tour_id:item.tour_id||null,
        modality:item.modality||null,
        pricing_status:item.pricing_status,
        price_pp_clp:item.price_pp_clp,
        pricing_source:item.pricing_source,
        service_type:item.category||null,
        sales_channel:'LINK Ventas · Escritorio vendedor',
        idioma:language||null,
        horario_confirmado:false,
        requiere_confirmacion:true,
        booking_status:'quoted'
      }));
      const {error:serviceError}=await admin.from('lead_services').insert(serviceRows);
      if(serviceError)throw serviceError;
    }catch(error){
      await admin.from('passengers').delete().eq('lead_id',lead.id);
      await admin.from('lead_services').delete().eq('lead_id',lead.id);
      await admin.from('leads').delete().eq('id',lead.id);
      throw error;
    }

    const {error:activityError}=await admin.from('crm_activities').insert({
      lead_id:lead.id,
      type:'partner_request_created',
      title:'Solicitud recibida desde LINK Ventas',
      body:receptionist.name+' · '+hotel.name+' · '+services.length+' servicio(s). Pendiente de confirmación.',
      created_by:identity.user?.id||'LINK Ventas · Escritorio vendedor'
    });
    if(activityError)console.error('partner_request_activity',activityError);

    return res.status(201).json({
      codigo:lead.codigo,lead_id:lead.id,count:services.length,
      status:'solicitud_recibida',booking_status:'quoted'
    });
  }catch(error){
    console.error('partner-data',error);
    return res.status(error.status||400).json({error:error.message||'No se pudo procesar la solicitud.'});
  }
}
