-- Verificación de la integración LINK Ventas / HOTEL EXPERIENCE
select table_name, column_name
from information_schema.columns
where table_schema='public'
  and ((table_name='lead_services' and column_name='service_code')
    or (table_name='payment_movements' and column_name='payment_code')
    or (table_name='service_commissions' and column_name='commission_code'))
order by table_name;

select routine_name
from information_schema.routines
where routine_schema='public' and routine_name='create_link_sale';

select codigo,reserva,estado,commercial_status,created_at
from public.leads
order by created_at desc
limit 5;

select service_code,producto,precio_total,costo_operador_total,margen_comercial,
       comision_hotel,comision_vendedor,margen_hotel_experience,estado_operacion
from public.lead_services
order by created_at desc
limit 10;
