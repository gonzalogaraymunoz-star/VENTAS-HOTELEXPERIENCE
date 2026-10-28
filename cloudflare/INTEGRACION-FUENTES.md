# LINK Ventas · Alimentación de fuentes

## Estado
- LINKRRSS (Instagram/WhatsApp existentes): sincronización prospectiva cada 5 minutos en Supabase `pg_cron`; solo mensajes entrantes con señales comerciales.
- Websites: **receptor listo, integración individual requerida**. No anunciar websites conectadas hasta instalar y verificar la credencial desde su backend.

## Flujo de LINK ID
1. La fuente es dueña del contenido original. `link_rrss_messages` mantiene los textos sociales.
2. `link_sales_inbox` recibe una referencia al mensaje y la evidencia de canal/fecha, no crea persona/lead.
3. LINK Ventas presenta el mensaje, propone campos a revisar y consulta coincidencias de LINK ID por email/teléfono.
4. La persona confirma los campos; solo entonces se crea `sales_leads` y los triggers existentes vinculan `link_persons` / `link_lead_identities`.
5. Cotizaciones, ventas, cobros y operaciones siguen su propio ciclo; sin automatizar decisiones de cierre.

## Activar LINKRRSS
En LINK Ventas, seleccionar negocio → **Fuentes** → revisar cuentas conectadas → **Activar alimentación**.
Los tres negocios ya conectados (Caracol, LAMA Travelers, Raíces Atacama) fueron habilitados para solicitudes **futuras**. El historial se puede importar por separado desde **Adquisición → Desde LINKRRSS**. Para propietarios internos, usar **Accesos → Negocios ya registrados en LINK ID → Vincular**, sin crear otra ficha.

El cron `link-ventas-rrss-intake-5m` llama `private.link_sales_feed_rrss_v1(50)`. Para cada conversación solo se mantiene una entrada pendiente, evitando spam de fragmentos. La decisión humana determina si se descarta o convierte. Se puede detener desde Fuentes.

## Conectar una website con backend
1. Entrar a LINK Ventas → Fuentes → Conectar website → crear una fuente.
2. Copiar el `source_id` (público) y la clave de 64 caracteres (se muestra una sola vez).
3. Guardar la clave **exclusivamente** como variable secreta del backend de la website, por ejemplo `LINK_VENTAS_WEB_SECRET` en Cloudflare Workers.
4. Desde el backend del sitio, no desde JavaScript público, enviar una petición HTTPS:

```js
// Ejecutar en servidor/Cloudflare Worker, no en código enviado al navegador.
const id = crypto.randomUUID(); // Persistir/reutilizar para reintentos de la misma solicitud
const response = await fetch("https://link-ventas-2.gonzalogaraymunoz.workers.dev/api/intake", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-LINK-WEB-SECRET": env.LINK_VENTAS_WEB_SECRET
  },
  body: JSON.stringify({
    source_id: env.LINK_VENTAS_SOURCE_ID,
    event_id: id,
    message: "Me interesa el tour, necesito disponibilidad",
    name: "Nombre informado por el cliente",
    email: "contacto@example.com",
    phone: "+569xxxxxxxx",
    page_path: "/tour",
    utm_source: "instagram",
    utm_medium: "social",
    utm_campaign: "campana"
  })
});
if (!response.ok) throw new Error("LINK Ventas no confirmó el ingreso");
const ack = await response.json();
// ack.status: received / already_received. No equivale a una venta.
```

5. El formulario público de la website debe tener consentimiento/aviso apropiado, protección antispam y validación; no colocar la clave privada en HTML, variables NEXT_PUBLIC ni JS estático.
6. Probar la entrada desde el backend, verificar que aparezca en **Adquisición → Bandeja** y revisar/corregir el lead. Una segunda petición con el mismo `event_id` debe producir `already_received`.

### Limitaciones
El receptor valida secreto SHA-256, estado de origen, idempotencia y límite máximo por hora; sin un backend o proxy que proteja la clave no debe usarse. El endpoint no envía WhatsApp ni ejecuta pagos, reservas o cotizaciones por sí mismo.

No se ha validado una integración HTTP real end-to-end contra un website productivo durante este despliegue, y no se modificaron las websites de Raíces ni de otros clientes.

## Pruebas de Supabase
- Importación de referencia RRSS sin duplicar texto original: aprobada con `ROLLBACK`.
- Alta de origen website, emisión de clave, recepción idempotente, revisión humana y creación de identidad lead: aprobada con `ROLLBACK`.
- Cron pg_cron: job registrado activo, ejecución sucedida.
- Estado inicial de bandeja: **0 registros reales nuevos** (solo se activó para mensajes futuros).
