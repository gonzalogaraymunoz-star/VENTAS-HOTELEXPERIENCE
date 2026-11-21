# Draft PR — Ficha 360 integral por solicitud

## Estado y límites
- Preparación en rama `draft/ficha360-integral`, basada en `link-ventas-cloudflare`.
- Este cambio es de lectura consolidada. No agrega escrituras comerciales, reservas, pagos, mensajes, cupos ni confirmaciones.
- No contiene migraciones SQL ni cambios de esquema.
- No se agregaron dependencias, servicios pagos ni cuentas.
- No se desplegó ni publicó la aplicación.
- No se ejecutaron pruebas contra datos productivos.

## Alcance incluido

### A. Índice cronológico
La pantalla Clientes filtra por fecha de ingreso (`leads.created_at`), estado, hotel y vendedor; ordena las solicitudes de más reciente a más antigua. La fecha de servicio sigue siendo una dimensión distinta y se muestra en la ficha.

### B. Ficha integral
La Ficha 360 existente conserva el ingreso parcial para una ficha nueva. Al abrir un `lead_id` existente, presenta una ficha de lectura con:
1. Adquisición: importes pactados leídos exclusivamente de `lead_services.precio_unitario`, `precio_total` o `precio_venta`; no usa `intake_request.agreedPrice` ni consulta/recalcula TV1.2.
2. Pasajeros: titular explícito y acompañantes.
3. Itinerario: servicios ordenados por fecha y hora, con pasajeros vinculados cuando existe `lead_service_passengers`.
4. Documentos: `reservation_documents`, `reservation_document_versions` y `operational_entity_documents`; enlaces a originales y versiones existentes, sin copiarlos.
5. Operación: `service_assignments` por `lead_service_id`, proveedores, personas de servicio, vehículos y alimentación consultada por salida y pasajero.
6. Cronología: `crm_activities` por `lead_id`.

### C. Panel documental
Los documentos se consultan desde sus tablas actuales. Para objetos en Storage privado se solicita URL firmada temporal al abrir la ficha; las referencias externas/Drive se enlazan sin duplicar archivos. La URL firmada tiene vigencia de cinco minutos.

### D. Impresión
El botón Imprimir ficha llama a la impresión del navegador con una hoja de estilos específica. Cada documento original conserva su enlace individual. No se implementa paquete PDF unificado ni conversión de XLSX/Drive.

## Pendientes de aprobación o validación productiva (no incluidos)
- Verificar en entorno de pruebas autorizado que las políticas RLS permiten las lecturas de `service_assignments`, `suppliers`, `service_people`, `vehicles`, tablas de alimentación y documentos.
- Verificar los valores reales de `entity_type` y `document_type` usados para hojas de riesgo y la correspondencia de cada archivo con el UUID de pasajero. Si la relación no existe en el esquema actual, proponer migración separada y solicitar aprobación antes de escribirla.
- Verificar si todos los documentos de cotización e itinerario tienen versión y referencia original registradas. No se inventan documentos faltantes.
- Verificar permisos y acceso a archivos Drive, y la conversión/impresión oficial de XLSX. Paquete documental único queda expresamente fuera.
- Si se necesita un campo/relación para identificar titular, fecha de ingreso, vendedor, asignación de pasajero a servicio o documento de riesgo y no existe en el esquema, documentar y solicitar aprobación de migración independiente.
- Confirmar que la aplicación desplegada corresponde al código de la rama base antes de cualquier publicación.

## Validación técnica
- Revisión estática del código y de los puntos de integración existentes.
- No se ejecutó `npm run typecheck` ni `npm run build` porque este flujo no dispone de un runner/checkout aislado del repositorio.
- No se usaron filas reales de producción para pruebas.
- Revisión visual, RLS, impresión física y enlaces de Drive quedan pendientes en entorno no productivo.

## Fuera de alcance
WhatsApp entrante, email ingestion, pagos, cobros, confirmaciones, ocupación/cálculo de cupos, TV1.2, generación de hojas de riesgo, asignaciones operacionales nuevas, escritura de datos, migraciones, despliegue y publicación.

## Criterio de revisión
Una solicitud se abre por su `lead_id`; los datos de cada sección se leen desde su fuente canónica. La ficha no crea entidades, no recalcula precios y no sustituye el tablero de HOTEL EXPERIENCE Operaciones.
