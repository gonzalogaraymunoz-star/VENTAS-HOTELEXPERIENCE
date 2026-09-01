create or replace function public.register_link_client_payment(
  p_lead_id uuid,
  p_amount numeric,
  p_payment_method text default null,
  p_reference text default null,
  p_counterparty text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_role text := public.current_user_role();
  v_lead public.leads%rowtype;
  v_service public.lead_services%rowtype;
  v_total numeric;
  v_paid numeric;
  v_balance numeric;
  v_account_balance numeric := 0;
  v_remaining numeric := p_amount;
  v_apply numeric;
  v_allocated integer := 0;
  v_remaining_balance numeric;
begin
  if v_user is null or v_role not in ('admin','manager','agent') then
    raise exception 'Not authorized to register client payments';
  end if;
  if coalesce(p_amount,0) <= 0 then
    raise exception 'El monto debe ser mayor que cero';
  end if;

  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;

  perform pg_advisory_xact_lock(hashtext(p_lead_id::text));

  for v_service in
    select * from public.lead_services
    where lead_id=p_lead_id and booking_status='confirmed'
    order by fecha_servicio nulls last, created_at, id
    for update
  loop
    v_total := coalesce(v_service.precio_total,v_service.precio_venta,0);
    select coalesce(sum(pm.amount),0) into v_paid
    from public.payment_movements pm
    where pm.lead_service_id=v_service.id
      and pm.party_type='client'
      and (pm.direction is null or pm.direction='inflow');
    if v_paid=0 and v_service.estado_pago='Pagado' then v_paid:=v_total; end if;
    v_account_balance := v_account_balance + greatest(0,v_total-v_paid);
  end loop;

  if v_account_balance <= 0 then raise exception 'La venta no tiene saldo pendiente'; end if;
  if p_amount > v_account_balance then
    raise exception 'El monto supera el saldo pendiente de %', to_char(v_account_balance,'FM999G999G999G990');
  end if;

  for v_service in
    select * from public.lead_services
    where lead_id=p_lead_id and booking_status='confirmed'
    order by fecha_servicio nulls last, created_at, id
    for update
  loop
    exit when v_remaining <= 0;
    v_total := coalesce(v_service.precio_total,v_service.precio_venta,0);
    select coalesce(sum(pm.amount),0) into v_paid
    from public.payment_movements pm
    where pm.lead_service_id=v_service.id
      and pm.party_type='client'
      and (pm.direction is null or pm.direction='inflow');
    if v_paid=0 and v_service.estado_pago='Pagado' then v_paid:=v_total; end if;
    v_balance := greatest(0,v_total-v_paid);
    if v_balance <= 0 then continue; end if;

    v_apply := least(v_remaining,v_balance);
    insert into public.payment_movements(
      lead_service_id,party_type,amount,currency,payment_method,reference,counterparty_name,direction,category,created_by
    ) values (
      v_service.id,'client',v_apply,coalesce(v_service.moneda,'CLP'),nullif(p_payment_method,''),nullif(p_reference,''),nullif(p_counterparty,''),'inflow','customer_payment',v_user
    );

    update public.lead_services
    set estado_pago = case when v_paid+v_apply >= v_total and v_total>0 then 'Pagado' else 'Parcial' end,
        updated_at=now()
    where id=v_service.id;

    v_remaining := v_remaining-v_apply;
    v_allocated := v_allocated+1;
  end loop;

  v_remaining_balance := greatest(0,v_account_balance-p_amount);
  update public.leads
  set next_best_action = case when v_remaining_balance<=0 then 'Cobro completo · continuar operación' else 'Cobrar saldo pendiente' end,
      updated_at=now()
  where id=p_lead_id;

  insert into public.crm_activities(lead_id,type,title,body,created_by)
  values(
    p_lead_id,
    'customer_payment',
    'Pago de cliente registrado',
    'Pago CLP '||to_char(p_amount,'FM999G999G999G990')||' distribuido en '||v_allocated||' servicio(s). Saldo restante CLP '||to_char(v_remaining_balance,'FM999G999G999G990')||'.',
    coalesce(v_user::text,'LINK Ventas')
  );

  return jsonb_build_object(
    'lead_id',p_lead_id,
    'amount',p_amount,
    'allocated_services',v_allocated,
    'remaining_balance',v_remaining_balance
  );
end;
$$;

revoke all on function public.register_link_client_payment(uuid,numeric,text,text,text) from public, anon;
grant execute on function public.register_link_client_payment(uuid,numeric,text,text,text) to authenticated, service_role;
