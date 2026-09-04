from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Pattern not found: {label}')
    return text.replace(old, new, 1)


# ---- Types: expose catalog detail fields and payment coordination ----
path = Path('src/types.ts')
text = path.read_text()
text = replace_once(
    text,
    "  schedule?: string | null;\n  description?: string | null;",
    "  schedule?: string | null;\n  stops?: string | null;\n  snack?: string | null;\n  description?: string | null;",
    'Product detail fields',
)
text = replace_once(
    text,
    "  payment_link?: string | null;\n  payment_link_sent_at?: string | null;",
    "  payment_link?: string | null;\n  payment_link_sent_at?: string | null;\n  payment_coordination_status?: string | null;\n  payment_coordination_at?: string | null;\n  payment_coordination_note?: string | null;",
    'Lead payment coordination fields',
)
path.write_text(text)


# ---- Sales flow UX ----
path = Path('src/components/SalesFlowForm.tsx')
text = path.read_text()

helper = r'''
function productClientInfo(product?: Product) {
  if (!product) return '';
  const parts: string[] = [];
  const description = String(product.description || '').trim();
  const stops = String(product.stops || '').trim();
  const schedule = String(product.schedule || '').trim();
  const snack = String(product.snack || '').trim();
  const duration = Number(product.duration_hours || 0);
  if (description) parts.push(description.replace(/\s+/g, ' '));
  if (stops) parts.push(`Recorrido: ${stops.replace(/\s*\+\s*/g, ', ')}.`);
  if (duration > 0) parts.push(`Duración aproximada: ${duration % 1 === 0 ? duration.toFixed(0) : duration.toFixed(1)} h.`);
  if (schedule) parts.push(`Horario referencial: ${schedule}.`);
  if (snack) parts.push(`Alimentación referencial: ${snack}.`);
  const category = `${product.category || ''} ${product.name || ''}`.toLowerCase();
  if (/transfer|traslado|transporte/.test(category)) {
    parts.push('Recomendación: confirmar con anticipación el horario, punto de recogida y datos de vuelo cuando corresponda.');
  } else if (/wellness|spa|masaje|terapia/.test(category)) {
    parts.push('Recomendación: informar previamente restricciones, alergias o condiciones relevantes para adaptar el servicio.');
  } else {
    parts.push('Recomendación: llevar agua, protección solar, abrigo y calzado cómodo. El horario y punto de encuentro definitivos se confirman antes del servicio.');
  }
  return parts.join(' ');
}
'''
text = replace_once(
    text,
    "  return `Tarifa aplicada · ${clp(unitPrice)}`;\n}\n\nfunction stageToStep",
    "  return `Tarifa aplicada · ${clp(unitPrice)}`;\n}\n" + helper + "\nfunction stageToStep",
    'productClientInfo helper',
)
text = replace_once(
    text,
    "  if (stage === 'accepted_payment' || stage === 'payment_link_sent') return 3;",
    "  if (stage === 'payment_link_sent' || stage === 'payment_coordinated') return 4;\n  if (stage === 'accepted_payment') return 3;",
    'stage mapping',
)
text = replace_once(
    text,
    "  const [paymentLink, setPaymentLink] = useState(existingLead?.payment_link || '');",
    "  const [paymentLink, setPaymentLink] = useState(existingLead?.payment_link || '');\n  const [paymentCoordination, setPaymentCoordination] = useState(existingLead?.payment_coordination_status || (existingLead?.payment_link_sent_at ? 'link_sent' : 'pending'));",
    'payment coordination state',
)
text = replace_once(
    text,
    "  const paymentSent = Boolean(currentLead?.payment_link_sent_at);\n  const itinerarySent = Boolean(currentLead?.itinerary_sent_at);",
    "  const paymentSent = Boolean(currentLead?.payment_link_sent_at);\n  const paymentReady = paymentSent || paymentCoordination === 'link_sent' || paymentCoordination === 'external_or_later';\n  const itinerarySent = Boolean(currentLead?.itinerary_sent_at);",
    'payment ready derived state',
)
text = replace_once(
    text,
    "      operator_cost: 0, supplier_id: '', supplier_name: '', hotel_commission_pct: 0, seller_commission_pct: 0, notes: '',",
    "      operator_cost: 0, supplier_id: '', supplier_name: '', hotel_commission_pct: 0, seller_commission_pct: 0, notes: productClientInfo(product),",
    'autofill notes from catalog',
)
text = replace_once(
    text,
    "      payment_link: paymentLink,\n      arrival_flight_number: arrivalFlight,",
    "      payment_link: paymentLink,\n      payment_coordination_status: paymentCoordination,\n      arrival_flight_number: arrivalFlight,",
    'metadata payment coordination',
)

old_send = """      const result = await sharePaymentLink(reference, paymentLink);\n      await updateSalesFlow(id, { ...metadata('payment_link_sent'), mark_payment_link_sent: true });\n      setMessage(result === 'shared' ? 'Link de pago compartido y registrado.' : 'Link copiado y registrado como entregado.');\n      await onSaved();"""
new_send = """      const result = await sharePaymentLink(reference, paymentLink);\n      await updateSalesFlow(id, { ...metadata('payment_link_sent'), payment_coordination_status: 'link_sent', mark_payment_link_sent: true });\n      setPaymentCoordination('link_sent');\n      setActiveStep(4);\n      setMessage(result === 'shared' ? 'Link de pago compartido y registrado.' : 'Link copiado y registrado como entregado.');\n      await onSaved();"""
text = replace_once(text, old_send, new_send, 'send payment flow')

continue_fn = r'''

  async function continueWithoutPaymentLink() {
    setBusy(true); setMessage('');
    try {
      const id = await persist('accepted_payment', true);
      await updateSalesFlow(id, {
        ...metadata('payment_coordinated'),
        sales_stage: 'payment_coordinated',
        payment_coordination_status: 'external_or_later',
        payment_coordination_note: 'Pago coordinado sin link desde LINK Ventas',
      });
      setPaymentCoordination('external_or_later');
      setActiveStep(4);
      setMessage('Pago coordinado sin link. Puedes preparar el itinerario; no se registró ningún link como enviado.');
      await onSaved();
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo continuar sin link de pago.');
    } finally { setBusy(false); }
  }
'''
text = replace_once(
    text,
    "  function itineraryBody() {",
    continue_fn + "\n  function itineraryBody() {",
    'continue without payment link function',
)
text = replace_once(
    text,
    "      const id = await persist('payment_link_sent', true);",
    "      const id = await persist(paymentSent || paymentCoordination === 'link_sent' ? 'payment_link_sent' : 'payment_coordinated', true);",
    'itinerary persist stage',
)
text = replace_once(
    text,
    "      await persist('payment_link_sent', true);",
    "      await persist(paymentSent || paymentCoordination === 'link_sent' ? 'payment_link_sent' : 'payment_coordinated', true);",
    'external itinerary persist stage',
)
text = replace_once(
    text,
    "    if (!paymentSent) missing.push('link de pago enviado');",
    "    if (!paymentReady) missing.push('forma de pago definida');",
    'final gate payment requirement',
)
text = replace_once(
    text,
    "  }, [quoteAccepted, paymentSent, itinerarySent, checkin, checkout, contact, passengers, draftServices]);",
    "  }, [quoteAccepted, paymentReady, itinerarySent, checkin, checkout, contact, passengers, draftServices]);",
    'final gate deps',
)
text = replace_once(
    text,
    "  const stageUnlocked = (index: number) => index <= 1 || (index === 2 && Boolean(leadId)) || (index === 3 && quoteAccepted) || (index === 4 && quoteAccepted && paymentSent) || (index === 5 && itinerarySent);",
    "  const stageUnlocked = (index: number) => index <= 1 || (index === 2 && Boolean(leadId)) || (index === 3 && quoteAccepted) || (index === 4 && quoteAccepted && paymentReady) || (index === 5 && itinerarySent);",
    'step unlock',
)
text = replace_once(text, "(index === 3 && paymentSent)", "(index === 3 && paymentReady)", 'stepper check')

old_info = """<label>Información para el cliente<input value={service.notes} onChange={event => patchService(index, { notes: event.target.value })} placeholder=\"Horario, punto de encuentro, condiciones particulares…\"/></label>"""
new_info = """<div className=\"service-client-info\"><label>Información para el cliente<textarea value={service.notes} onChange={event => patchService(index, { notes: event.target.value })} placeholder=\"Descripción del lugar, recorrido, recomendaciones y condiciones particulares…\"/></label>{product && <button type=\"button\" className=\"button ghost\" onClick={() => patchService(index, { notes: productClientInfo(product) })}>Rellenar desde catálogo</button>}</div>"""
text = replace_once(text, old_info, new_info, 'client information field')

old_payment_card = """<section className=\"payment-link-card\"><div><strong>Link de pago</strong><span>Se guarda en el mismo ingreso; compartirlo no crea otra reserva.</span></div><div className=\"payment-link-row\"><input value={paymentLink} onChange={event => setPaymentLink(event.target.value)} placeholder=\"https://…\"/><button className=\"button dark\" disabled={busy || !paymentLink.trim()} onClick={() => void sendPayment()}><Send size={15}/> Compartir link</button><button className=\"button ghost\" disabled={!paymentLink.trim()} onClick={() => navigator.clipboard.writeText(paymentLink)}><Copy size={15}/></button></div></section>"""
new_payment_card = """<section className=\"payment-link-card\"><div><strong>Link de pago <span>· opcional</span></strong><span>Pega la URL real que abre el cobro de esta reserva. No uses la página general del proveedor. Si el pago será por transferencia, efectivo o se coordinará después, puedes continuar sin link.</span></div><div className=\"payment-link-row\"><input value={paymentLink} onChange={event => setPaymentLink(event.target.value)} placeholder=\"https://… enlace real de cobro\"/><button className=\"button dark\" disabled={busy || !paymentLink.trim()} onClick={() => void sendPayment()}><Send size={15}/> Compartir link</button><button className=\"button ghost\" disabled={!paymentLink.trim()} onClick={() => navigator.clipboard.writeText(paymentLink)}><Copy size={15}/></button><button className=\"button ghost\" disabled={busy} onClick={() => void continueWithoutPaymentLink()}>Continuar sin link</button></div>{paymentReady && <small className=\"payment-ready-note\">{paymentCoordination === 'link_sent' || paymentSent ? 'Link de pago registrado como compartido.' : 'Pago coordinado sin link; no se registró un envío inexistente.'}</small>}</section>"""
text = replace_once(text, old_payment_card, new_payment_card, 'payment card UX')

old_actions = """<FlowActions busy={busy} onSave={() => void persist(paymentSent ? 'payment_link_sent' : 'accepted_payment')} onNext={async () => { setBusy(true); try { await persist(paymentSent ? 'payment_link_sent' : 'accepted_payment', true); if (!paymentSent) throw new Error('Comparte el link de pago antes de avanzar al itinerario.'); setActiveStep(4); } catch (error: any) { setMessage(error?.message || 'No se pudo avanzar.'); } finally { setBusy(false); } }} nextLabel=\"Preparar itinerario\"/>"""
new_actions = """<FlowActions busy={busy} onSave={() => void persist(paymentSent || paymentCoordination === 'link_sent' ? 'payment_link_sent' : paymentReady ? 'payment_coordinated' : 'accepted_payment')} onNext={async () => { setBusy(true); try { await persist(paymentSent || paymentCoordination === 'link_sent' ? 'payment_link_sent' : paymentReady ? 'payment_coordinated' : 'accepted_payment', true); if (!paymentReady) throw new Error('Comparte una URL real de cobro o elige “Continuar sin link”.'); setActiveStep(4); } catch (error: any) { setMessage(error?.message || 'No se pudo avanzar.'); } finally { setBusy(false); } }} nextLabel=\"Preparar itinerario\"/>"""
text = replace_once(text, old_actions, new_actions, 'payment step actions')
path.write_text(text)


# ---- CSS for longer customer info and flexible payment controls ----
path = Path('src/components/SalesFlowForm.css')
text = path.read_text()
css = r'''

/* Quote/payment UX refinement */
.service-client-info{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end}
.service-client-info label{min-width:0}
.service-client-info textarea{min-height:76px;resize:vertical;line-height:1.45}
.service-client-info>.button{margin-bottom:1px;white-space:nowrap}
.payment-link-card>div:first-child strong span{font-weight:500;color:var(--muted,#756f68)}
.payment-link-row{flex-wrap:wrap}
.payment-link-row input{min-width:260px;flex:1}
.payment-ready-note{display:block;margin-top:8px;color:#39614b;font-size:11px}
@media(max-width:760px){.service-client-info{grid-template-columns:1fr}.service-client-info>.button{width:100%;justify-content:center}.payment-link-row input{min-width:100%}.payment-link-row .button{flex:1 1 auto}}
'''
if '/* Quote/payment UX refinement */' not in text:
    text += css
path.write_text(text)


# ---- One-page customer quote PDF ----
path = Path('src/lib/customerQuote.ts')
text = path.read_text()
replacement = r'''function compactExperienceText(item: Record<string, unknown>) {
  const notes = String(item.notes || '').trim();
  const description = String(item.description || '').trim();
  const stops = String(item.stops || '').trim();
  const snack = String(item.snack || '').trim();
  const pieces = [notes || description || modeExplanation(String(item.modality || item.catalog_price_mode || ''))];
  if (!notes && stops) pieces.push(`Recorrido: ${stops.replace(/\s*\+\s*/g, ', ')}`);
  if (!notes && snack) pieces.push(`Alimentación: ${snack}`);
  return pieces.filter(Boolean).join(' · ');
}

function drawPolicyBlock(doc: jsPDF, quote: SalesQuoteSnapshot, y: number) {
  const left = 18, right = 192;
  const lines = concisePolicy(quote.policy_summary).slice(0, 3);
  const height = 28;
  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
  doc.roundedRect(left, y, right - left, height, 2.5, 2.5, 'FD');
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2);
  doc.text('POLÍTICAS DE CANCELACIÓN', left + 6, y + 6.5);
  let rowY = y + 12;
  lines.forEach(line => {
    doc.setFillColor(...ACCENT); doc.circle(left + 7, rowY - 1.1, 0.65, 'F');
    doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.9);
    doc.text(line, left + 11, rowY); rowY += 4.2;
  });
  doc.setTextColor(...MUTED); doc.setFontSize(5.1);
  doc.text('* Se descuentan entradas, permisos o servicios de terceros ya emitidos y no reembolsables.', left + 6, y + 25);
  return y + height + 6;
}

function drawCompactDetails(doc: jsPDF, items: Array<Record<string, unknown>>, y: number, maxY = 260) {
  if (!items.length || y >= maxY - 8) return y;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2);
  doc.text('INFORMACIÓN DE LAS EXPERIENCIAS', 18, y); y += 5;
  const available = Math.max(0, maxY - y);
  const perItem = Math.max(5.5, Math.min(12, available / Math.max(1, items.length)));
  for (let index = 0; index < items.length && y < maxY - 2; index += 1) {
    const item = items[index];
    const title = cleanCommercialName(item.product_name).toUpperCase();
    const detail = compactExperienceText(item);
    doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.2);
    doc.text(String(index + 1).padStart(2, '0'), 18, y);
    doc.setTextColor(...INK); doc.setFontSize(6.1);
    doc.text(doc.splitTextToSize(title, 62)[0], 25, y);
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.2);
    const maxLines = perItem >= 9 ? 2 : 1;
    const body = doc.splitTextToSize(detail, 104).slice(0, maxLines);
    doc.text(body, 86, y);
    y += Math.max(5.5, Math.min(perItem, 3.3 * Math.max(1, body.length) + 2.2));
  }
  return y;
}

export function buildCustomerQuotePdf'''
text, count = re.subn(
    r"function drawDetailPage\(doc: jsPDF, quote: SalesQuoteSnapshot, items: Array<Record<string, unknown>>\) \{.*?\n\}\n\nexport function buildCustomerQuotePdf",
    replacement,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('Could not replace multi-page detail function')

old_tail_pattern = re.compile(r"  doc\.setFillColor\(251, 250, 247\);.*?\n  drawDetailPage\(doc, quote, items\);", re.S)
new_tail = r'''  y = drawPolicyBlock(doc, quote, y);
  y = drawCompactDetails(doc, items, y, 259);

  if (y < 263) {
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.2);
    doc.text('Los horarios “Por confirmar” se actualizan cuando la coordinación del servicio queda definida.', left, Math.min(267, y + 3));
  }

  doc.setDrawColor(...LINE); doc.line(left, 276, right, 276);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.text('LINK · HOTEL EXPERIENCE', left, 282);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.2); doc.text('Cotización comercial · valores expresados en pesos chilenos', right, 282, { align: 'right' });'''
text, count = old_tail_pattern.subn(new_tail, text, count=1)
if count != 1:
    raise SystemExit('Could not replace PDF tail')
path.write_text(text)


# ---- SQL documentation marker kept in repo; live migration is applied separately ----
Path('supabase/20260904_quote_payment_ux.sql').write_text(
    "-- Applied directly to shared HOTEL EXPERIENCE Supabase.\n"
    "-- Documents the payment coordination fields used by LINK Ventas.\n"
)
