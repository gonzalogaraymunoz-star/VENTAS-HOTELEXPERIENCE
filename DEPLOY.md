# Deploy paso a paso

## 1. GitHub

Crea un repositorio nuevo sugerido como `LINK-VENTAS` y sube el contenido completo de esta carpeta.

## 2. Supabase

Usa el proyecto existente:

`lpirjwifzosdzgdncsbt`

En **SQL Editor**, ejecuta el archivo:

`supabase/migrations/20260830203000_link_sales_codes_and_rpc.sql`

La migración no reemplaza tablas existentes.

## 3. Verificación Supabase

Confirma que existan:

- columna `service_code` en `lead_services`
- columna `payment_code` en `payment_movements`
- columna `commission_code` en `service_commissions`
- función `create_link_sale`

## 4. Vercel

Importa el repositorio.

Framework: **Vite**  
Build: `npm run build`  
Output: `dist`

Variables opcionales (el repo ya tiene fallback al Supabase actual):

- `VITE_SUPABASE_URL=https://lpirjwifzosdzgdncsbt.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=...`
- `VITE_OPERATIONS_URL=https://...` cuando esté definido el dominio de Operaciones

## 5. Prueba funcional

1. Inicia sesión con un usuario existente de HOTEL EXPERIENCE.
2. Crea una venta de prueba con hotel, cliente y un producto.
3. Revisa que el lead tenga `PREFIX-YYMM-###`.
4. Revisa pasajero `-P01` y servicio `-S01`.
5. Confirma que el servicio quede `estado_operacion = Pendiente`.
6. Registra un pago y comprueba su código `-PG01`.
7. Abre HOTEL EXPERIENCE Operaciones y confirma que el mismo `lead_service` sea visible allí.

Solo después de esa prueba conviene apuntar el flujo comercial real a LINK Ventas.
