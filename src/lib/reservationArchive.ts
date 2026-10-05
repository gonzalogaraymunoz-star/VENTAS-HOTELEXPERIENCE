import {supabase} from './supabase';

type PdfDocumentLike={output:(type:'arraybuffer')=>ArrayBuffer};

function endpoint(operationsUrl:string){
  const base=String(operationsUrl||'').trim().replace(/\/$/,'');
  if(!base)throw new Error('HOTEL EXPERIENCE Operaciones no está configurado para respaldos.');
  return base+'/api/reservation-archive';
}
async function authToken(){
  const {data}=await supabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token)throw new Error('Sesión requerida para respaldar la reserva.');
  return token;
}
function base64FromArrayBuffer(buffer:ArrayBuffer){
  const bytes=new Uint8Array(buffer);let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));
  return btoa(binary);
}
async function callArchive(operationsUrl:string,payload:Record<string,unknown>){
  const token=await authToken();
  const response=await fetch(endpoint(operationsUrl),{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body?.error||'No se pudo registrar el respaldo de la reserva.');
  return body;
}

export async function archivePdf(input:{
  operationsUrl:string;leadId:string;documentType:string;title:string;category:string;fileName:string;
  doc:PdfDocumentLike;sourceApp?:string;
}){
  if(!input.leadId)return null;
  const arrayBuffer=input.doc.output('arraybuffer');
  return callArchive(input.operationsUrl,{
    action:'store_file',leadId:input.leadId,documentType:input.documentType,title:input.title,category:input.category,
    fileName:input.fileName,mimeType:'application/pdf',base64:base64FromArrayBuffer(arrayBuffer),sourceApp:input.sourceApp||'link_ventas'
  });
}

export async function archiveFile(input:{
  operationsUrl:string;leadId:string;documentType:string;title:string;category:string;file:File;sourceApp?:string;
}){
  if(!input.leadId||!input.file)return null;
  if(input.file.size>9*1024*1024)throw new Error('El comprobante supera el máximo de 9 MB.');
  const arrayBuffer=await input.file.arrayBuffer();
  return callArchive(input.operationsUrl,{
    action:'store_file',leadId:input.leadId,documentType:input.documentType,title:input.title,category:input.category,
    fileName:input.file.name||input.title,mimeType:input.file.type||'application/octet-stream',
    base64:base64FromArrayBuffer(arrayBuffer),sourceApp:input.sourceApp||'link_ventas'
  });
}

export async function archiveLink(input:{
  operationsUrl:string;leadId:string;documentType:string;title:string;category:string;url:string;sourceApp?:string;
}){
  if(!input.leadId||!input.url.trim())return null;
  return callArchive(input.operationsUrl,{action:'register_link',...input,sourceApp:input.sourceApp||'link_ventas'});
}

export async function ensureReservationArchive(operationsUrl:string,leadId:string){
  return callArchive(operationsUrl,{action:'ensure_folder',leadId});
}
export async function archiveReservationSnapshot(operationsUrl:string,leadId:string){
  return callArchive(operationsUrl,{action:'reservation_snapshot',leadId});
}
export async function archivePassengerSnapshot(operationsUrl:string,leadId:string){
  return callArchive(operationsUrl,{action:'passenger_snapshot',leadId});
}
