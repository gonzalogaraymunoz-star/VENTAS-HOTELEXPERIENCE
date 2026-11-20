import {createClient} from '@supabase/supabase-js';

export const PARTNER_COOKIE='he_partner_session';
export const SESSION_HOURS=12;
const encoder=new TextEncoder();

function randomBytes(length){
  const bytes=new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
function toHex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function fromHex(value){
  const pairs=String(value||'').match(/.{1,2}/g)||[];
  return new Uint8Array(pairs.map(pair=>parseInt(pair,16)));
}
function toBase64Url(bytes){
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function equalBytes(a,b){
  if(a.length!==b.length)return false;
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0;
}
async function derivePassword(password,salt,iterations,length=32){
  const key=await crypto.subtle.importKey('raw',encoder.encode(String(password||'')),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,length*8);
  return new Uint8Array(bits);
}
export function setupAdmin(env){
  const url=env?.SUPABASE_URL||'https://lpirjwifzosdzgdncsbt.supabase.co';
  const key=env?.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)throw new Error('Falta el secreto SUPABASE_SERVICE_ROLE_KEY en la configuración de Cloudflare Pages.');
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}
export async function crmUserFrom(req,admin){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token)throw Object.assign(new Error('Sesión inválida.'),{status:401});
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data.user)throw Object.assign(new Error('Sesión inválida.'),{status:401});
  const {data:profile}=await admin.from('profiles').select('*').eq('id',data.user.id).maybeSingle();
  if(!profile?.is_active)throw Object.assign(new Error('Cuenta desactivada.'),{status:403});
  return {user:data.user,profile};
}
export async function hashPassword(password){
  const value=String(password||'');
  if(value.length<8)throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const salt=randomBytes(16),iterations=120000;
  const hash=await derivePassword(value,salt,iterations,32);
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(hash)}`;
}
export async function verifyPassword(password,encoded){
  try{
    const [kind,iterationsRaw,saltHex,hashHex]=String(encoded||'').split('$');
    if(kind!=='pbkdf2'||!iterationsRaw||!saltHex||!hashHex)return false;
    const iterations=Number(iterationsRaw);
    if(!Number.isFinite(iterations)||iterations<10000||iterations>500000)return false;
    const salt=fromHex(saltHex),expected=fromHex(hashHex);
    if(salt.length!==16||expected.length!==32)return false;
    const actual=await derivePassword(password,salt,iterations,expected.length);
    return equalBytes(expected,actual);
  }catch{return false;}
}
export function randomPassword(){return toBase64Url(randomBytes(12));}
export function makeAccessCode(type,name){
  const prefix=type==='agency'?'AGY':'HTL';
  const slug=String(name||'PARTNER').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,6)||'PARTNER';
  return `${prefix}-${slug}-${toHex(randomBytes(3)).toUpperCase()}`;
}
export function normalizePrefix(value,name=''){
  const raw=String(value||name||'B2B').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
  return (raw.length>=2?raw:`B2${raw}`).slice(0,6);
}
export function publicAccount(account){
  return {
    id:account.id,name:account.name,partner_type:account.partner_type,scope_value:account.scope_value,
    lead_prefix:account.lead_prefix,access_code:account.access_code,active:Boolean(account.active),
    can_create_requests:Boolean(account.can_create_requests),notes:account.notes||'',
    last_login_at:account.last_login_at||null,created_at:account.created_at,updated_at:account.updated_at
  };
}
function parseCookies(req){
  const header=String(req.headers.cookie||''),out={};
  for(const part of header.split(';')){
    const i=part.indexOf('=');if(i<0)continue;
    const key=part.slice(0,i).trim(),value=part.slice(i+1).trim();
    if(key){try{out[key]=decodeURIComponent(value);}catch{out[key]=value;}}
  }
  return out;
}
async function tokenHash(token){
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(String(token||'')));
  return toHex(new Uint8Array(digest));
}
export async function getPartnerSession(req,admin,{touch=true}={}){
  const token=parseCookies(req)[PARTNER_COOKIE];
  if(!token)return null;
  const hash=await tokenHash(token);
  const {data:session,error}=await admin.from('partner_portal_sessions')
    .select('id,account_id,expires_at,last_seen_at').eq('token_hash',hash).maybeSingle();
  if(error)throw error;
  if(!session)return null;
  if(new Date(session.expires_at).getTime()<=Date.now()){
    await admin.from('partner_portal_sessions').delete().eq('id',session.id);return null;
  }
  const {data:account,error:accountError}=await admin.from('partner_portal_accounts')
    .select('*').eq('id',session.account_id).maybeSingle();
  if(accountError)throw accountError;
  if(!account?.active){
    await admin.from('partner_portal_sessions').delete().eq('id',session.id);return null;
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
  const token=toBase64Url(randomBytes(32));
  const expires=new Date(Date.now()+SESSION_HOURS*60*60*1000);
  const {error}=await admin.from('partner_portal_sessions').insert({
    account_id:accountId,token_hash:await tokenHash(token),expires_at:expires.toISOString()
  });
  if(error)throw error;
  res.setHeader('Set-Cookie',`${PARTNER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS*3600}`);
}
export async function destroyPartnerSession(req,res,admin){
  const token=parseCookies(req)[PARTNER_COOKIE];
  if(token)await admin.from('partner_portal_sessions').delete().eq('token_hash',await tokenHash(token));
  res.setHeader('Set-Cookie',`${PARTNER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
export function noStore(res){
  res.setHeader('Cache-Control','no-store, private, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
}
