import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BellRing, CheckCircle2, ChevronRight, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './PendingClientTasks.css';

type PendingTask = {
  task_key: string;
  app_scope: 'sales' | 'operations' | string;
  lead_id: string;
  lead_code: string;
  lead_service_id?: string | null;
  service_code?: string | null;
  priority: string;
  title: string;
  detail: string;
  sort_order: number;
};

function salesStepFor(taskKey: string) {
  if (taskKey.startsWith('sales_missing_name:') || taskKey.startsWith('sales_missing_contact:')) return 1;
  if (taskKey.startsWith('sales_missing_stay:')) return 0;
  if (
    taskKey.startsWith('sales_no_product:') || taskKey.startsWith('sales_service_date:') ||
    taskKey.startsWith('sales_service_price:') || taskKey.startsWith('sales_participants:') ||
    taskKey.startsWith('sales_quote:') || taskKey.startsWith('sales_accept:')
  ) return 2;
  if (taskKey.startsWith('sales_payment:')) return 3;
  if (taskKey.startsWith('sales_itinerary:')) return 4;
  if (taskKey.startsWith('sales_complete:')) return 5;
  return 0;
}

function focusSalesStep(step: number, attempt = 0) {
  window.setTimeout(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sales-stepper button'));
    const target = buttons[step];
    if (target && !target.disabled) {
      target.click();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (attempt < 12) focusSalesStep(step, attempt + 1);
  }, attempt === 0 ? 180 : 120);
}

export default function PendingClientTasks({ scope }: { scope: 'sales' | 'operations' }) {
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const previousCount = useRef(0);

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from('client_pending_tasks')
      .select('*')
      .eq('app_scope', scope)
      .order('sort_order', { ascending: true })
      .limit(120);
    if (!error) {
      const next = (data || []) as PendingTask[];
      setTasks(next);
      if (previousCount.current === 0 && next.length > 0) setOpen(true);
      previousCount.current = next.length;
    }
    setLoading(false);
  }

  function openTask(task: PendingTask) {
    if (scope !== 'sales') return;
    const step = salesStepFor(task.task_key);
    window.dispatchEvent(new CustomEvent('link:open-pending-task', {
      detail: { leadId: task.lead_id, taskKey: task.task_key, step },
    }));
    setOpen(false);
    focusSalesStep(step);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 45000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [scope]);

  const groups = useMemo(() => {
    const map = new Map<string, PendingTask[]>();
    tasks.forEach(task => map.set(task.lead_code, [...(map.get(task.lead_code) || []), task]));
    return Array.from(map.entries()).map(([code, rows]) => ({ code, rows }));
  }, [tasks]);

  return <>
    <button className={`pending-task-launcher ${tasks.length ? 'has-items' : ''}`} onClick={() => setOpen(value => !value)} title="Pendientes por cliente">
      <BellRing size={18}/><span>Pendientes</span>{tasks.length > 0 && <b>{tasks.length}</b>}
    </button>
    <aside className={`pending-task-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
      <header>
        <div><small>{scope === 'sales' ? 'LINK VENTAS' : 'HOTEL EXPERIENCE'}</small><strong>Pendientes por código</strong><span>{tasks.length ? `${tasks.length} tarea(s) activa(s)` : 'Sin tareas pendientes'}</span></div>
        <button onClick={() => setOpen(false)} aria-label="Cerrar pendientes"><X size={18}/></button>
      </header>
      <div className="pending-task-body">
        {loading && tasks.length === 0 ? <div className="pending-task-empty">Actualizando…</div> : groups.length === 0 ? <div className="pending-task-empty"><CheckCircle2 size={24}/><strong>Todo al día</strong><span>Los nuevos pendientes aparecerán aquí automáticamente.</span></div> : groups.slice(0, 12).map(group => <article className="pending-client-card" key={group.code}>
          <div className="pending-client-head"><strong>{group.code}</strong><span>{group.rows.length}</span></div>
          <div>{group.rows.slice(0, 5).map(task => scope === 'sales' ? <button key={task.task_key} type="button" onClick={() => openTask(task)} className={`pending-task-row pending-task-action priority-${task.priority.toLowerCase()}`}>
            <ChevronRight size={14}/><span><strong>{task.title}</strong><small>{task.service_code ? `${task.service_code} · ` : ''}{task.detail}</small></span><span className="pending-go"><ArrowUpRight size={13}/> Ir</span>
          </button> : <section key={task.task_key} className={`pending-task-row priority-${task.priority.toLowerCase()}`}>
            <ChevronRight size={14}/><span><strong>{task.title}</strong><small>{task.service_code ? `${task.service_code} · ` : ''}{task.detail}</small></span>
          </section>)}</div>
          {group.rows.length > 5 && <small className="pending-more">+{group.rows.length - 5} pendiente(s) adicionales</small>}
        </article>)}
      </div>
      <footer><button onClick={() => void refresh()}>Actualizar ahora</button></footer>
    </aside>
  </>;
}
