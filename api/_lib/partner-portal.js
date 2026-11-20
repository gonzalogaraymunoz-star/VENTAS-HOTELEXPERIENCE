import crypto from 'crypto';
import {createClient} from '@supabase/supabase-js';

export const PARTNER_COOKIE='he_partner_session';
export const SESSION_HOURS=12;

export function setupAdmin(){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||'https://lpirjwifzosdzgdncsbt.supabase.co';
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Configuración del servidor incompleta.');
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}

export async function crmUserFrom(req,admin){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data.user)throw Object.assign(new Error('Sesión inválida.'),{status:401});
  const {data:profile}=await admin.from('profiles').select('*').eq('id',data.user.id).maybeSingle();
  if(!profile?.is_active)throw Object.assign(new Error('Cuenta desactivada.'),{status:403});
  return {user:data.user,profile};
}

export function hashPassword(password){
  const value=String(password||'');
  if(value.length<8)throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const salt=crypto.randomBytes(16);
  const hash=crypto.scryptSync(value,salt,64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password,encoded){
  try{
    const [kind,saltHex,hashHex]=String(encoded||'').split('$');
    if(kind!=='scrypt'||!saltHex||!hashHex)return false;
    const expected=Buffer.from(hashHex,'hex');
    const actual=crypto.scryptSync(String(password||''),Buffer.from(saltHex,'hex'),expected.length);
    return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);
  }catch{return false}
}

export function randomPassword(){
  return crypto.randomBytes(9).toString('base64url');
}

export function makeAccessCode(type,name){
  const prefix=type==='agency'?'AGY':'HTL';
  const slug=String(name||'PARTNER')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,'')
    .slice(0,6)||'PARTNER';
  return `${prefix}-${slug}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export function normalizePrefix(value,name=''){
  const raw=String(value||name||'B2B')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]/g,'')
    .slice(0,6);
  return (raw.length>=2?raw:`B2${raw}`).slice(0,6);
}

export function publicAccount(account){
  return {
    id:account.id,
    name:account.name,
    partner_type:account.partner_type,
    scope_value:account.scope_value,
    lead_prefix:account.lead_prefix,
    access_code:account.access_code,
    active:Boolean(account.active),
    can_create_requests:Boolean(account.can_create_requests),
    notes:account.notes||'',
    last_login_at:account.last_login_at||null,
    created_at:account.created_at,
    updated_at:account.updated_at
  };
}

function parseCookies(req){
  const header=String(req.headers.cookie||'');
  const out={};
  for(const part of header.split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    const key=part.slice(0,i).trim();
    const value=part.slice(i+1).trim();
    if(key)out[key]=decodeURIComponent(value);
  }
  return out;
}
function tokenHash(token){
  return crypto.createHash('sha256').update(String(token||'')).digest('hex');
}

export async function getPartnerSession(req,admin,{touch=true}={}){
  const token=parseCookies(req)[PARTNER_COOKIE];
  if(!token)return null;
  const hash=tokenHash(token);
  const {data:session,error}=await admin.from('partner_portal_sessions')
    .select('id,account_id,expires_at,last_seen_at')
    .eq('token_hash',hash)
    .maybeSingle();
  if(error)throw error;
  if(!session)return null;
  if(new Date(session.expires_at).getTime()<=Date.now()){
    await admin.from('partner_portal_sessions').delete().eq('id',session.id);
    return null;
  }
  const {data:account,error:accountError}=await admin.from('partner_portal_accounts')
    .select('*').eq('id',session.account_id).maybeSingle();
  if(accountError)throw accountError;
  if(!account?.active){
    await admin.from('partner_portal_sessions').delete().eq('id',session.id);
    return null;
  }
  if(touch){
    const last=new Date(session.last_seen_at||0).getTime();
    if(!last||Date.now()-last>15*60*1000){
      await admin.from('partner_portal_sessions').update({last_seen_at:new Date().toISOString()}).eq('id',session.id);
    }
  }
  return {account,session,token};
}

export async function issuePartnerSession(res,admin,accountId){
  const token=crypto.randomBytes(32).toString('base64url');
  const expires=new Date(Date.now()+SESSION_HOURS*60*60*1000);
  const {error}=await admin.from('partner_portal_sessions').insert({
    account_id:accountId,
    token_hash:tokenHash(token),
    expires_at:expires.toISOString()
  });
  if(error)throw error;
  res.setHeader('Set-Cookie',`${PARTNER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS*3600}`);
}

export async function destroyPartnerSession(req,res,admin){
  const token=parseCookies(req)[PARTNER_COOKIE];
  if(token)await admin.from('partner_portal_sessions').delete().eq('token_hash',tokenHash(token));
  res.setHeader('Set-Cookie',`${PARTNER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export function noStore(res){
  res.setHeader('Cache-Control','no-store, private, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
}
