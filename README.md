# LINK Ventas

Aplicación comercial separada de **HOTEL EXPERIENCE Operaciones**, conectada al mismo Supabase.

## Qué resuelve

**Hotel / Canal → Lead → Cliente + acompañantes → Productos → Venta → Pago → Operaciones → Comisiones**

LINK Ventas se concentra en captación y conversión. HOTEL EXPERIENCE mantiene la ejecución operacional.

### Principios conservados

- Supabase `lpirjwifzosdzgdncsbt` continúa siendo la fuente de verdad.
- No se duplica catálogo, hotel, operador ni cliente.
- Un lead puede comprar múltiples productos.
- El costo operador se paga/considera antes de distribuir el margen comercial.
- Comisión hotel y vendedor son porcentajes editables del margen, no del precio total.
- El código del lead usa la lógica existente `PREFIX-YYMM-###`.
- Cliente y acompañantes usan `LEAD-P01`, `P02`, etc.
- La extensión de esta app agrega códigos de negocio para servicios, pagos y comisiones sin reemplazar los UUID de Supabase.

## Pantallas

1. **Inicio** — KPIs comerciales y handoff a Operaciones.
2. **Nueva venta** — formulario ancho con origen, cliente, acompañantes, múltiples productos y economía.
3. **Clientes** — tabla CRM con código, origen, productos, total y estado.
4. **Pipeline** — Nuevo → Contactado → Cotizando → Propuesta → Confirmado → Perdido.
5. **Productos** — lectura directa de `product_catalog`.
6. **Pagos** — ingresos vinculados a `lead_services`.

## Backend compartido

La app usa las tablas actuales:

- `hotel_partners`
- `leads`
- `passengers`
- `product_catalog`
- `lead_services`
- `suppliers`
- `service_assignments`
- `payment_movements`
- `service_commissions`
- `profiles`

No crea un segundo CRM.

## Migración requerida

Ejecuta:

`supabase/migrations/20260830203000_link_sales_codes_and_rpc.sql`

La migración es aditiva. Agrega:

- `lead_services.service_code` → `FAU-2608-001-S01`
- `payment_movements.payment_code` → `FAU-2608-001-S01-PG01`
- `service_commissions.commission_code` → `FAU-2608-001-S01-CM01`
- RPC transaccional `create_link_sale(jsonb)`

El RPC crea de forma atómica:

**Lead → pasajeros → servicios → operador propuesto → comisiones**

Si una parte falla, no queda media venta construida.

## Desarrollo local

```bash
npm install
npm run dev
```

Validación:

```bash
npm run typecheck
npm run build
```

## Variables

La app incluye como fallback la URL y publishable key del Supabase compartido. Para administrar el deploy de manera explícita puedes copiar `.env.example` a `.env.local` o definir las variables en Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_OPERATIONS_URL` (opcional)

Nunca uses `SUPABASE_SERVICE_ROLE_KEY` en una variable `VITE_*`.

## Deploy correcto

**GitHub = código**  
**Supabase = datos, Auth y RPC**  
**Vercel = frontend de LINK Ventas**

No se recomienda servir este frontend desde Supabase. Primero aplica la migración al proyecto compartido y luego conecta el repo a Vercel.
