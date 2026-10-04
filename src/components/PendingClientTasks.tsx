import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowUpRight,BellRing,CalendarDays,CheckCircle2,ChevronRight,RefreshCw,Search,X} from 'lucide-react';
import {supabase} from '../lib/supabase';
import './PendingClientTasks.css';
import './PendingClientTasksV2.css';

type PendingTask={
  task_key:string;app_scope:'sales'|'operations'|string;lead_id:string;lead_code:string;
  lead_service_id?:string|null;service_code?:string|null;priority:string;title:string;detail:string;sort_order:number;
  pax_name?:string|null;service_date?:string|null;requested_at?:string|null;
};

const priorityWeight:Record<string,number>={Alta:0,Media:1,Baja:2};

function salesStepFor(taskKey:string){
  if(taskKey.startsWith('sales_missing_name:')||taskKey.startsWith('sales_missing_contact:'))return 1;
  if(taskKey.startsWith('sales_missing_stay:'))return 0;
  if(
    taskKey.startsWith('sales_no_product:')||taskKey.startsWith('sales_service_date:')||
    taskKey.startsWith('sales_service_price:')||taskKey.startsWith('sales_participants:')||
    taskKey.startsWith('sales_quote:')||taskKey.startsWith('sales_accept:')
  )return 2;
  if(taskKey.startsWith('sales_payment:'))return 3;
  if(taskKey.startsWith('sales_itinerary:'))return 4;
  if(taskKey.startsWith('sales_complete:'))return 5;
  return 0;
}
function salesDestination(step:number){
  return ['Cotización e ingreso','Datos y pax','Carta cotización','Aceptación y pago','Itinerario cliente','Completar reserva'][step]||'Cotización e ingreso';
}
function taskDateValue(task:PendingTask){
  const value=task.service_date||task.requested_at;
  if(!value)return Number.MAX_SAFE_INTEGER;
  const date=new Date(value.includes('T')?value:value+'T12:00:00');
  const time=date.getTime();
  return Number.isFinite(time)?time:Number.MAX_SAFE_INTEGER;
}
function formatTaskDate(task:PendingTask){
  const value=task.service_date||task.requested_at;
  if(!value)return'Sin fecha';
  const date=new Date(value.includes('T')?value:value+'T12:00:00');
  if(Number.isNaN(date.getTime()))return'Sin fecha';
  return new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric'}).format(date).replace('.','');
}
function priorityClass(value:string){return String(value||'Media').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}

export default function PendingClientTasks({scope}:{scope:'sales'|'operations'}){
  const [tasks,setTasks]=useState<PendingTask[]>([]);
  const [dashboardOpen,setDashboardOpen]=useState(false);
  const [selectedLeadCode,setSelectedLeadCode]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [query,setQuery]=useState('');
  const [roomQuery,setRoomQuery]=useState('');
  const [priority,setPriority]=useState('Todos');

  async function refresh(){
    setLoading(true);
    const {data,error}=await supabase.from('client_pending_tasks_ui').select('*').eq('app_scope',scope).order('sort_order',{ascending:true}).limit(300);
    if(!error){
      const base=(data||[]) as PendingTask[];
      const serviceIds=Array.from(new Set(base.map(task=>task.lead_service_id).filter(Boolean))) as string[];
      const leadIds=Array.from(new Set(base.map(task=>task.lead_id).filter(Boolean))) as string[];
      const [serviceResult,leadResult]=await Promise.all([
        serviceIds.length?supabase.from('lead_services').select('id,fecha_servicio,created_at').in('id',serviceIds):Promise.resolve({data:[],error:null}),
        leadIds.length?supabase.from('leads').select('id,created_at').in('id',leadIds):Promise.resolve({data:[],error:null})
      ]);
      const serviceById=new Map((serviceResult.data||[]).map((row:any)=>[row.id,row]));
      const leadById=new Map((leadResult.data||[]).map((row:any)=>[row.id,row]));
      setTasks(base.map(task=>{
        const service=task.lead_service_id?serviceById.get(task.lead_service_id):null;
        const lead=leadById.get(task.lead_id);
        return {...task,service_date:service?.fecha_servicio||null,requested_at:service?.created_at||lead?.created_at||null};
      }));
    }
    setLoading(false);
  }

  function openTask(task:PendingTask){
    if(scope!=='sales')return;
    const step=salesStepFor(task.task_key);
    window.dispatchEvent(new CustomEvent('link:open-pending-task',{detail:{
      leadId:task.lead_id,
      serviceId:task.lead_service_id||null,
      taskKey:task.task_key,
      title:task.title,
      detail:task.detail,
      step,
      destination:salesDestination(step),
      fromPending:true
    }}));
    setDashboardOpen(false);
    setSelectedLeadCode(null);
  }

  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>void refresh(),45000);
    const onFocus=()=>void refresh();
    const onOpen=()=>setDashboardOpen(true);
    const onClose=()=>setDashboardOpen(false);
    window.addEventListener('focus',onFocus);
    window.addEventListener('link:open-pending-dashboard',onOpen);
    window.addEventListener('link:close-pending-dashboard',onClose);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',onFocus);window.removeEventListener('link:open-pending-dashboard',onOpen);window.removeEventListener('link:close-pending-dashboard',onClose)};
  },[scope]);
  useEffect(()=>{document.body.classList.toggle('pending-dashboard-lock',dashboardOpen);return()=>document.body.classList.remove('pending-dashboard-lock')},[dashboardOpen]);

  const allGroups=useMemo(()=>{
    const map=new Map<string,PendingTask[]>();
    tasks.forEach(task=>map.set(task.lead_code,[...(map.get(task.lead_code)||[]),task]));
    return Array.from(map.entries()).map(([code,rows])=>{
      const ordered=[...rows].sort((a,b)=>(priorityWeight[a.priority]??9)-(priorityWeight[b.priority]??9)||(a.sort_order??999)-(b.sort_order??999)||taskDateValue(a)-taskDateValue(b));
      const serviceCodes=Array.from(new Set(ordered.map(row=>row.service_code).filter(Boolean))) as string[];
      const nearest=[...ordered].sort((a,b)=>taskDateValue(a)-taskDateValue(b))[0];
      return{
        code,
        paxName:ordered.find(row=>row.pax_name)?.pax_name||'Cliente por completar',
        rows:ordered,
        serviceCodes,
        high:ordered.filter(row=>row.priority==='Alta').length,
        medium:ordered.filter(row=>row.priority==='Media').length,
        low:ordered.filter(row=>row.priority==='Baja').length,
        nearest
      };
    }).sort((a,b)=>(priorityWeight[a.rows[0]?.priority]??9)-(priorityWeight[b.rows[0]?.priority]??9)||taskDateValue(a.nearest)-taskDateValue(b.nearest)||a.code.localeCompare(b.code,'es'));
  },[tasks]);

  const groups=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return allGroups;
    return allGroups.filter(group=>[group.code,group.paxName,...group.serviceCodes,...group.rows.flatMap(row=>[row.title,row.detail])].some(value=>String(value||'').toLowerCase().includes(q)));
  },[allGroups,query]);

  const selectedGroup=useMemo(()=>selectedLeadCode?allGroups.find(group=>group.code===selectedLeadCode)||null:null,[allGroups,selectedLeadCode]);
  const roomTasks=useMemo(()=>{
    if(!selectedGroup)return[];
    const q=roomQuery.trim().toLowerCase();
    return selectedGroup.rows.filter(task=>{
      if(priority!=='Todos'&&task.priority!==priority)return false;
      if(!q)return true;
      return [task.title,task.detail,task.service_code,salesDestination(salesStepFor(task.task_key))].some(value=>String(value||'').toLowerCase().includes(q));
    });
  },[selectedGroup,priority,roomQuery]);

  const priorities=['Todos','Alta','Media','Baja'];
  const highCount=tasks.filter(task=>task.priority==='Alta').length;

  return <>
    <button className={'pending-task-launcher '+(tasks.length?'has-items':'')} onClick={()=>{setSelectedLeadCode(null);setQuery('');setRoomQuery('');setPriority('Todos');setDashboardOpen(true)}} title="Abrir pendientes">
      <BellRing size={18}/><span>Pendientes</span>{tasks.length>0&&<b>{tasks.length}</b>}
    </button>

    {dashboardOpen&&<section className="pending-dashboard-shell pending-dashboard-full" role="dialog" aria-modal="true" aria-label={selectedGroup?'Sala de pendientes':'Reservas con pendientes'}>
      <header className="pending-dashboard-header pending-dashboard-header-full">
        <div className="pending-dashboard-history">
          {selectedGroup?<button type="button" onClick={()=>{setSelectedLeadCode(null);setRoomQuery('');setPriority('Todos')}} title="Volver a reservas"><ArrowLeft size={18}/></button>:<span className="pending-dashboard-spacer"/>}
        </div>
        <div className="pending-dashboard-heading">
          <small>LINK VENTAS</small>
          <h2>{selectedGroup?'Sala de pendientes':'Reservas con pendientes'}</h2>
          <p>{selectedGroup?selectedGroup.code+' · '+selectedGroup.paxName:'Elige una reserva y entra a su sala. Cada pendiente te lleva al lugar exacto donde se resuelve.'}</p>
        </div>
        <div className="pending-dashboard-header-actions">
          <button className="pending-dashboard-refresh" type="button" onClick={()=>void refresh()}><RefreshCw size={14}/> Actualizar</button>
          <button className="pending-dashboard-close" onClick={()=>{setSelectedLeadCode(null);setDashboardOpen(false)}} aria-label="Cerrar pendientes"><X size={20}/></button>
        </div>
      </header>

      {!selectedGroup?<>
        <div className="pending-dashboard-kpis">
          <article><span>Reservas</span><strong>{groups.length}</strong><small>con trabajo comercial abierto</small></article>
          <article><span>Pendientes</span><strong>{tasks.length}</strong><small>acciones por resolver</small></article>
          <article><span>Alta prioridad</span><strong>{highCount}</strong><small>resolver primero</small></article>
        </div>
        <div className="pending-dashboard-toolbar pending-dashboard-toolbar-full pending-reservation-toolbar">
          <label><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar código, pasajero, servicio o pendiente…"/></label>
        </div>
        <div className="pending-dashboard-list pending-reservation-body">
          {loading&&tasks.length===0?<div className="pending-dashboard-empty">Actualizando reservas…</div>:groups.length===0?<div className="pending-dashboard-empty"><CheckCircle2 size={25}/><strong>{tasks.length?'Sin coincidencias':'Todo al día'}</strong><span>{tasks.length?'Cambia la búsqueda.':'Los nuevos pendientes comerciales aparecerán aquí automáticamente.'}</span></div>:<div className="pending-reservation-grid">
            {groups.map((group,index)=><button type="button" className="pending-reservation-card" key={group.code} onClick={()=>{setSelectedLeadCode(group.code);setRoomQuery('');setPriority('Todos')}}>
              <span className="pending-reservation-top"><span className="pending-reservation-number">{String(index+1).padStart(2,'0')}</span><span className="pending-reservation-summary"><b>{group.rows.length}</b><small>pendientes</small></span></span>
              <span className="pending-reservation-copy"><small>RESERVA</small><strong>{group.code}</strong><b>{group.paxName}</b>{group.serviceCodes.length>0&&<em>{group.serviceCodes.slice(0,3).join(' · ')}</em>}</span>
              <span className="pending-reservation-bottom"><span className="pending-reservation-date"><CalendarDays size={13}/>{group.nearest?formatTaskDate(group.nearest):'Sin fecha'}</span><span className="pending-reservation-open">Abrir sala <ChevronRight size={15}/></span></span>
            </button>)}
          </div>}
        </div>
      </>:<>
        <div className="pending-room-summary">
          <button type="button" className="pending-room-back" onClick={()=>{setSelectedLeadCode(null);setRoomQuery('');setPriority('Todos')}}><ArrowLeft size={15}/> Reservas</button>
          <div className="pending-room-identity"><small>RESERVA</small><strong>{selectedGroup.code}</strong><span>{selectedGroup.paxName}</span>{selectedGroup.serviceCodes.length>0&&<em>{selectedGroup.serviceCodes.join(' · ')}</em>}</div>
          <div className="pending-room-stats"><span><b>{selectedGroup.rows.length}</b><small>Total</small></span><span><b>{selectedGroup.high}</b><small>Alta</small></span><span><b>{selectedGroup.medium}</b><small>Media</small></span><span><b>{selectedGroup.low}</b><small>Baja</small></span></div>
        </div>
        <div className="pending-dashboard-toolbar pending-room-toolbar">
          <label><Search size={15}/><input value={roomQuery} onChange={event=>setRoomQuery(event.target.value)} placeholder="Buscar dentro de esta reserva…"/></label>
          <div className="pending-dashboard-priority">{priorities.map(item=><button key={item} className={priority===item?'active':''} onClick={()=>setPriority(item)}>{item}</button>)}</div>
        </div>
        <div className="pending-dashboard-list pending-room-body">
          {roomTasks.length===0?<div className="pending-dashboard-empty"><CheckCircle2 size={25}/><strong>Sin pendientes para este filtro</strong><button onClick={()=>{setRoomQuery('');setPriority('Todos')}}>Mostrar todos</button></div>:<div className="pending-room-list">
            {roomTasks.map((task,index)=>{
              const step=salesStepFor(task.task_key);
              return <section role="button" tabIndex={0} key={task.task_key} onClick={()=>openTask(task)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')openTask(task)}} className={'pending-room-task priority-'+priorityClass(task.priority)}>
                <span className="pending-room-rank">{index+1}</span>
                <span className="pending-room-task-copy">
                  <span className="pending-room-meta"><b>{task.priority}</b><small><CalendarDays size={11}/>{formatTaskDate(task)}</small>{task.service_code&&<em>{task.service_code}</em>}</span>
                  <strong>{task.title}</strong>
                  <p>{task.detail}</p>
                  <small className="pending-room-destination">Se resuelve en: <b>{salesDestination(step)}</b></small>
                </span>
                <span className="pending-room-resolve">Resolver <ArrowUpRight size={14}/></span>
              </section>
            })}
          </div>}
        </div>
      </>}
    </section>}
  </>;
}
