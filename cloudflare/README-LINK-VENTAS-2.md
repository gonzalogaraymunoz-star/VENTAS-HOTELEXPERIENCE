# LINK Ventas 2.0 · Piloto Cloudflare (2026-10-27)

Aplicación original: `VENTAS-HOTELEXPERIENCE` (Vercel). Esta versión crea **otra salida** en Cloudflare sin eliminar ni modificar el frontend anterior.

**URL:** https://link-ventas-2.gonzalogaraymunoz.workers.dev/

## Objetivo

Una aplicación comercial fácil de manejar para cualquier profesional o negocio que opere sobre el ecosistema LINK.

- **Mi negocio:** indicadores y resumen.
- **Productos:** alta y edición de productos propios, con un registro global LINK ID por producto.
- **Adquisición:** solicitudes sin calificar; ingreso manual o desde un mensaje de texto revisado por humanos.
- **Ventas:** oportunidades calificadas, cotizaciones, aceptación y confirmación manual de preparación operacional.

El ingreso usa Supabase Auth del proyecto **LINK CONTROL CENTRAL**. El modo demostración muestra *únicamente* datos simulados. Ningún usuario de la plataforma ingresa automáticamente al rol interno `app_members`.

## Fuentes existentes reutilizadas

- `link_world_businesses` (identidad del negocio: su trigger asigna global ID).
- `ecosystem_entities` (registro canónico de códigos y referencias, sin importar origen).
- `sales_leads` y `link_lead_identities` (lead con identidad).
- `sales_quotes` (cotización y snapshot histórico; no representa dinero cobrado).
- `link_persons` y `link_person_leads` (identidad y vínculos generados por los triggers preexistentes).

## Adiciones acotadas

`link_sales_members` conecta usuarios a negocios existentes, sin crear otra ficha de negocio. La política RLS permite a cada persona leer solo su membresía.

`link_sales_items` almacena exclusivamente productos **nuevos** de negocios creados en el portal. Cada uno se registra en `ecosystem_entities` con `owner_domain='world'` y `owner_table='link_sales_items'`. Los 74 productos originales de HOTEL EXPERIENCE **no se copian**; su registro existente referencia al catálogo del Supabase heredado.

`link_sales_portal(text,jsonb)` es la API única del piloto. Se ejecuta con autenticación y comprueba `auth.uid()` y la membresía del negocio **para cada acción**. Los roles `owner` y `editor` pueden escribir; `viewer` es solo lectura.

**Importante:** la plataforma no ofrece una resolución automática del catálogo heredado. Para incorporar fichas preexistentes al espacio de un usuario debe confirmarse la titularidad y definirse una conexión de lectura con su fuente propietaria. Nunca crear copias silenciosas.

## Seguridad

- RLS activado en todas las nuevas tablas.
- `anon` NO puede ejecutar `link_sales_portal`; `authenticated` sí.
- La clave `sb_publishable` en el frontend es pública, no `service_role`.
- La RPC fija el usuario según sesión; no acepta `user_id` arbitrario desde el navegador.
- La identidad LINK central se comparte, **pero los leads visibles se filtran por negocio**.
- La publicación y aceptación de cotizaciones son **declaraciones humanas**. Nada se cobra ni reserva automáticamente.
- Las altas de negocio que coinciden exactamente con uno existente se bloquean y requieren vinculación con verificación.

## Probar

1. Abre la URL y selecciona **Explorar demostración** para ver los flujos sin credenciales, datos reales ni escrituras.
2. Para datos reales, crea una cuenta y confirma el correo si Supabase lo exige; ingresa.
3. Crea un negocio, un producto, una solicitud y luego **Calificar**.
4. En Ventas, **Cotizar → Aceptar venta → Listo para operar** (validaciones humanas).
5. Comprueba los códigos globales en `ecosystem_entities` y los leads en `sales_leads`.

## Límites del piloto

- No integra todavía canales externos en tiempo real, cobros, boletas, impuestos específicos, inventario, WhatsApp ni operación logística.
- El analizador inicial es heurístico (regex simples), sin IA y siempre sujeto a revisión.
- La API devuelve hasta 250 leads por negocio; requiere paginación para volumen alto.
- No se ha realizado prueba E2E real autenticada con un usuario de prueba, ni prueba de carga.
- El acceso comercial a negocios existentes requiere vinculación verificada; no se adjudica propiedad por coincidencia de nombre.
- `app_members` mantiene permisos internos del ecosistema y no se usa para la incorporación de usuarios externos.

## Archivos

- `cloudflare/link-ventas-2.mjs`: app desplegada en Cloudflare Workers.
- `cloudflare/link-ventas-2-migration.sql`: versión documentada de la migración ya aplicada a LINK CONTROL CENTRAL.

El repo base (rama `main`), su despliegue Vercel y el Supabase original de Hotel Experience no fueron alterados por este piloto.
