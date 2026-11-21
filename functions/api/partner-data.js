import handler from '../_lib/partner-data-handler.js';

export async function onRequest({request,env}){
  const headers=new Headers();
  let status=200,payload=null;
  const url=new URL(request.url);
  let body={};
  if(request.method!=='GET'&&request.method!=='HEAD'){
    try{body=await request.json();}catch{body={};}
  }
  const req={
    method:request.method,
    headers:Object.fromEntries(request.headers.entries()),
    body,
    query:Object.fromEntries(url.searchParams.entries())
  };
  const res={
    setHeader(name,value){headers.set(name,String(value));return this;},
    status(code){status=code;return this;},
    json(value){payload=value;return this;}
  };
  try{
    await handler(req,res,env);
  }catch(error){
    console.error('LINK Ventas Pages Function',error);
    status=error.status||500;
    payload={error:error.message||'Error interno del servidor.'};
  }
  headers.set('Content-Type','application/json; charset=utf-8');
  headers.set('Cache-Control','no-store, private, max-age=0');
  return new Response(payload===null?'null':JSON.stringify(payload),{status,headers});
}
