from pathlib import Path

path = Path('src/components/SalesFlowForm.tsx')
text = path.read_text()


def replace_once(old: str, new: str, label: str):
    global text
    if old not in text:
        raise SystemExit(f'Pattern not found: {label}')
    text = text.replace(old, new, 1)

if "../lib/customerItinerary" not in text:
    replace_once(
        "import { concisePolicy, downloadCustomerQuote, shareCustomerQuote } from '../lib/customerQuote';",
        "import { concisePolicy, downloadCustomerQuote, shareCustomerQuote } from '../lib/customerQuote';\nimport { downloadCustomerItinerary } from '../lib/customerItinerary';",
        'customer itinerary import',
    )

if 'function downloadItineraryPdf()' not in text:
    marker = "  async function sendItinerary() {"
    block = """  function downloadItineraryPdf() {\n    const servicesForPdf = draftServices.map(service => {\n      const product = products.find(item => item.id === service.product_id);\n      return { ...service, durationHours: product?.duration_hours, scheduleLabel: product?.schedule };\n    });\n    const fileName = downloadCustomerItinerary({\n      reference, leadCode, hotelName: hotel?.name, pickupLocation, arrivalFlight, departureFlight,\n      passengers, services: servicesForPdf,\n    });\n    setMessage(`${fileName} descargado. Descargar el PDF no registra el itinerario como enviado.`);\n  }\n\n"""
    replace_once(marker, block + marker, 'download itinerary function')

old_grid = '<div className="form-grid three"><label>Fecha<input type="date" value={service.date} onChange={event => patchService(index, { date: event.target.value })}/></label><label>Modalidad<select value={service.modality} onChange={event => patchService(index, { modality: event.target.value })}><option value="private_per_pax">Privado</option><option value="semi_private">Semi privado</option><option value="regular_per_pax">Regular</option><option value="manual">Personalizado</option></select></label><label>Precio venta p/u<input type="number" min="0" value={service.unit_price} onChange={event => patchService(index, { unit_price: Number(event.target.value || 0) })}/></label></div>'
new_grid = old_grid + '<div className="form-grid three"><label>Hora inicio <span>para itinerario</span><input type="time" value={service.start_time} onChange={event => patchService(index, { start_time: event.target.value })}/></label><label>Horario referencial<input readOnly value={product?.schedule || "Según coordinación"}/></label><label>Duración referencial<input readOnly value={product?.duration_hours ? `${product.duration_hours} h` : "Por confirmar"}/></label></div>'
if 'Hora inicio <span>para itinerario</span>' not in text:
    replace_once(old_grid, new_grid, 'itinerary schedule fields')

old_title = '<FlowTitle number="05" title="Confirmación e itinerario al pasajero" text="El itinerario se construye con los mismos productos, fechas, modalidad y datos ya ingresados. No se vuelve a escribir la reserva."/>'
new_title = '<FlowTitle number="05" title="Confirmación e itinerario al pasajero" text="El itinerario se construye con los mismos productos, fechas, modalidad y datos ya ingresados. Puedes descargarlo en PDF o enviarlo sin volver a escribir la reserva."/>'
if new_title not in text:
    replace_once(old_title, new_title, 'step 5 copy')

old_actions = '<div className="flow-bottom-actions"><button className="button dark big" disabled={busy || !passengers[0]?.email} onClick={() => void sendItinerary()}><Mail size={16}/> Enviar itinerario por email</button><button className="button ghost big" disabled={busy} onClick={() => void markItineraryExternal()}>Registrar envío externo</button></div>'
new_actions = '<div className="flow-bottom-actions"><button className="button ghost big" disabled={busy || !draftServices.length} onClick={downloadItineraryPdf}><Download size={16}/> Descargar itinerario PDF</button><button className="button dark big" disabled={busy || !passengers[0]?.email} onClick={() => void sendItinerary()}><Mail size={16}/> Enviar itinerario por email</button><button className="button ghost big" disabled={busy} onClick={() => void markItineraryExternal()}>Registrar envío externo</button></div>'
if 'Descargar itinerario PDF' not in text:
    replace_once(old_actions, new_actions, 'step 5 download button')

path.write_text(text)
