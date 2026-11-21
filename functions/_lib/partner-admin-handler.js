import {
  crmUserFrom,hashPassword,makeAccessCode,noStore,normalizePrefix,
  isPreviewSafe,previewHotels,publicAccount,randomPassword,setupAdmin
} from './partner-portal.js';

const APPROVED_HOTELS = ['hotel-fauna','hotel-casa-solcor'];

async function approvedHotels(admin) {
  const {data,error}=await admin.from('hotel_partners')
    .select('id,name,slug,lead_prefix,active')
    .eq('active',true).in('slug',APPROVED_HOTELS).order('name');
  if(error)throw error;
  return data||[];
}

export default async function handler(req,res,env){
  noStore(res);
  try{
    if(isPreviewSafe(env)){
      if(req.method==='GET')return res.status(200).json({
        accounts:[],sellers:[],assignments:[],hotels:previewHotels(),preview_safe:true,
        notice:'Administración DEMO: datos ficticios, sin consultar cuentas, perfiles ni asignaciones reales.'
      });
      return res.status(403).json({error:'La administración DEMO es de solo lectura. No se permiten escrituras ni cambios de accesos.'});
    }
    const admin=setupAdmin(env);
    const {user,profile}=await crmUserFrom(req,admin);
    if(profile.role!=='admin')return res.status(403).json({error:'Solo administración principal puede gestionar accesos.'});
    const hotels=await approvedHotels(admin);

    if(req.method==='GET'){
      const [accountResult,sellerResult,assignmentResult]=await Promise.all([
        admin.from('partner_portal_accounts').select('*').eq('partner_type','hotel').order('created_at',{ascending:false}),
        admin.from('profiles').select('id,full_name,email,role,is_active').eq('role','agent').order('full_name'),
        admin.from('seller_partner_assignments').select('seller_profile_id,hotel_partner_id')
      ]);
      for(const result of [accountResult,sellerResult,assignmentResult])if(result.error)throw result.error;
      return res.status(200).json({
        accounts:(accountResult.data||[]).map(publicAccount),
        sellers:sellerResult.data||[],
        hotels,
        assignments:assignmentResult.data||[]
      });
    }

    if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
    const action=String(req.body?.action||'');

    if(action==='create_pos'){
      const hotel=hotels.find(item=>item.id===String(req.body?.hotel_partner_id||''));
      const name=String(req.body?.name||'').trim().slice(0,160);
      if(!hotel||!name) return res.status(400).json({error:'Selecciona un hotel autorizado y asigna un nombre al punto de venta.'});
      const temporary_password=randomPassword();
      const row={
        name,
        partner_type:'hotel',
        scope_value:hotel.name,
        lead_prefix:normalizePrefix(hotel.lead_prefix,hotel.name),
        access_code:makeAccessCode('hotel',name),
        password_hash:await hashPassword(temporary_password),
        active:true,
        can_create_requests:true,
        notes:String(req.body?.notes||'').trim().slice(0,600)||null,
        created_by:user.id
      };
      const {data,error}=await admin.from('partner_portal_accounts').insert(row).select('*').single();
      if(error)throw error;
      return res.status(201).json({account:publicAccount(data),temporary_password});
    }

    if(action==='create_seller'){
      const name=String(req.body?.name||'').trim().slice(0,160);
      const email=String(req.body?.email||'').trim().toLowerCase().slice(0,180);
      const hotelIds=[...new Set((Array.isArray(req.body?.hotel_partner_ids)?req.body.hotel_partner_ids:[]).map(String))];
      const validIds=hotelIds.filter(id=>hotels.some(hotel=>hotel.id===id));
      if(!name||!email||!validIds.length)return res.status(400).json({error:'Completa nombre, correo y al menos un hotel autorizado.'});
      const temporary_password=randomPassword();
      const {data:authData,error:authError}=await admin.auth.admin.createUser({
        email,password:temporary_password,email_confirm:true,user_metadata:{full_name:name}
      });
      if(authError)throw authError;
      const sellerId=authData.user.id;
      const {error:profileError}=await admin.from('profiles').upsert({
        id:sellerId,full_name:name,email,role:'agent',is_active:true
      },{onConflict:'id'});
      if(profileError){
        await admin.auth.admin.deleteUser(sellerId);
        throw profileError;
      }
      const assignmentRows=validIds.map(hotel_partner_id=>({
        seller_profile_id:sellerId,hotel_partner_id,created_by:user.id
      }));
      const {error:assignmentError}=await admin.from('seller_partner_assignments').upsert(
        assignmentRows,{onConflict:'seller_profile_id,hotel_partner_id'}
      );
      if(assignmentError){
        await admin.auth.admin.deleteUser(sellerId);
        throw assignmentError;
      }
      return res.status(201).json({
        seller:{id:sellerId,full_name:name,email,role:'agent',is_active:true},
        temporary_password
      });
    }

    if(action==='assign_seller'){
      const sellerId=String(req.body?.seller_profile_id||'');
      const hotelId=String(req.body?.hotel_partner_id||'');
      const enabled=Boolean(req.body?.enabled);
      const hotel=hotels.find(item=>item.id===hotelId);
      const {data:seller,error:sellerError}=await admin.from('profiles')
        .select('id,role,is_active').eq('id',sellerId).maybeSingle();
      if(sellerError)throw sellerError;
      if(!hotel||seller?.role!=='agent'||(enabled&&!seller.is_active)){
        return res.status(400).json({error:'El vendedor o el hotel no está habilitado para esta asignación.'});
      }
      if(enabled){
        const {error}=await admin.from('seller_partner_assignments').upsert({
          seller_profile_id:sellerId,hotel_partner_id:hotelId,created_by:user.id
        },{onConflict:'seller_profile_id,hotel_partner_id'});
        if(error)throw error;
      }else{
        const {error}=await admin.from('seller_partner_assignments').delete()
          .eq('seller_profile_id',sellerId).eq('hotel_partner_id',hotelId);
        if(error)throw error;
      }
      return res.status(200).json({ok:true});
    }

    if(action==='reset_pos_password'){
      const id=String(req.body?.id||'');
      const temporary_password=randomPassword();
      const {data:account,error}=await admin.from('partner_portal_accounts')
        .select('id').eq('id',id).eq('partner_type','hotel').maybeSingle();
      if(error)throw error;
      if(!account)return res.status(404).json({error:'Acceso de punto de venta no encontrado.'});
      const {error:updateError}=await admin.from('partner_portal_accounts')
        .update({password_hash:await hashPassword(temporary_password),updated_at:new Date().toISOString()}).eq('id',id);
      if(updateError)throw updateError;
      await admin.from('partner_portal_sessions').delete().eq('account_id',id);
      return res.status(200).json({temporary_password});
    }

    if(action==='toggle_pos'){
      const id=String(req.body?.id||'');
      const active=Boolean(req.body?.active);
      const {data:account,error}=await admin.from('partner_portal_accounts')
        .update({active,updated_at:new Date().toISOString()}).eq('id',id).eq('partner_type','hotel').select('id').maybeSingle();
      if(error)throw error;
      if(!account)return res.status(404).json({error:'Acceso de punto de venta no encontrado.'});
      if(!active)await admin.from('partner_portal_sessions').delete().eq('account_id',id);
      return res.status(200).json({ok:true});
    }

    if(action==='reset_seller_password'){
      const id=String(req.body?.id||'');
      const {data:seller,error}=await admin.from('profiles').select('id,role').eq('id',id).maybeSingle();
      if(error)throw error;
      if(seller?.role!=='agent')return res.status(404).json({error:'Vendedor no encontrado.'});
      const temporary_password=randomPassword();
      const {error:updateError}=await admin.auth.admin.updateUserById(id,{password:temporary_password});
      if(updateError)throw updateError;
      return res.status(200).json({temporary_password});
    }

    if(action==='toggle_seller'){
      const id=String(req.body?.id||'');
      const active=Boolean(req.body?.active);
      const {data:seller,error}=await admin.from('profiles')
        .update({is_active:active,updated_at:new Date().toISOString()})
        .eq('id',id).eq('role','agent').select('id').maybeSingle();
      if(error)throw error;
      if(!seller)return res.status(404).json({error:'Vendedor no encontrado.'});
      return res.status(200).json({ok:true});
    }

    return res.status(400).json({error:'Acción inválida.'});
  }catch(error){
    console.error('partner-admin',error);
    return res.status(error.status||500).json({error:error.message||'No se pudo administrar los accesos.'});
  }
}
