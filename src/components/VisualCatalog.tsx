import { useMemo, useState } from 'react';
import { ArrowRight, ImageOff, Minus, Plus, Search, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { clp, resolveProductPrice } from '../lib/money';
import type { Product } from '../types';
import './VisualCatalog.css';

type CatalogFamily = {
  slug: string;
  name: string;
  category: string;
  description: string;
  products: Product[];
};

function imagePaths(product: Product) {
  const slug = product.product_slug || product.code.replace(/_(regular|private|hotel|lowcost).*$/i, '');
  const category = String(product.category || '').toLowerCase();
  const paths: string[] = [];
  if (category.includes('transporte')) paths.push(`transporte/${slug}/cover.jpg`);
  else if (category.includes('procedimiento')) paths.push(`procedimientos/${slug}/cover.jpg`);
  else if (category.includes('salud')) paths.push(`salud/${slug}/cover.jpg`);
  else if (category.includes('spa') || category.includes('terapia')) paths.push(`bienestar/${slug}/cover.jpg`);
  else paths.push(`${slug}/cover.jpg`);
  paths.push(`web-tours/products/${slug}/cover.png`);
  return Array.from(new Set(paths));
}

function publicImageUrl(path: string) {
  return supabase.storage.from('catalog-images').getPublicUrl(path).data.publicUrl;
}

function CatalogImage({ product, alt, className }: { product: Product; alt: string; className?: string }) {
  const candidates = useMemo(() => imagePaths(product).map(publicImageUrl), [product.id, product.product_slug, product.code, product.category]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!candidates.length || failed) return <div className={`${className || ''} catalog-image-fallback`}><ImageOff size={22}/><span>Imagen no disponible</span></div>;
  return <img
    className={className}
    src={candidates[index]}
    alt={alt}
    loading="lazy"
    onError={()=>{
      if (index < candidates.length - 1) setIndex(current => current + 1);
      else setFailed(true);
    }}
  />;
}

function modeLabel(mode: string) {
  return ({
    private_per_pax: 'Privado',
    regular_per_pax: 'Compartido',
    regular_commission: 'Regular',
    hotel_fixed: 'Precio hotel',
    lowcost_transport: 'Transporte',
  } as Record<string,string>)[mode] || mode.split('_').join(' ');
}

function quoteFor(product: Product, pax: number) {
  const unit = resolveProductPrice(product, pax);
  if (unit == null || unit <= 0) return { valid: false, unit: 0, total: 0, label: 'Cotización manual' };
  const fixed = product.price_mode === 'hotel_fixed' || product.price_mode === 'lowcost_transport';
  return {
    valid: true,
    unit,
    total: fixed ? unit : unit * Math.max(1, pax),
    label: fixed ? 'por servicio' : 'por persona',
  };
}

export default function VisualCatalog({ products, onQuote }: { products: Product[]; onQuote: (productId: string)=>void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const [selectedSlug, setSelectedSlug] = useState('');
  const [pax, setPax] = useState(2);

  const families = useMemo<CatalogFamily[]>(() => {
    const map = new Map<string, CatalogFamily>();
    products.forEach(product => {
      const slug = product.product_slug || product.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
      const current = map.get(slug) || {
        slug,
        name: product.name,
        category: product.category,
        description: product.description || '',
        products: [],
      };
      current.products.push(product);
      if (!current.description && product.description) current.description = product.description;
      map.set(slug, current);
    });
    return Array.from(map.values()).sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
  }, [products]);

  const categories = useMemo(()=>['Todos', ...Array.from(new Set(families.map(item=>item.category)))], [families]);
  const filtered = useMemo(()=>families.filter(item => {
    const text = `${item.name} ${item.category} ${item.description} ${item.products.map(p=>p.code).join(' ')}`.toLowerCase();
    return (category === 'Todos' || item.category === category) && text.includes(query.toLowerCase().trim());
  }), [families, query, category]);

  const selected = families.find(item=>item.slug===selectedSlug) || null;

  return <div className="visual-catalog">
    <section className="visual-catalog-hero">
      <div><p className="eyebrow">CATÁLOGO VISUAL</p><h1>Experiencias que se pueden mostrar y vender.</h1><p>Las imágenes vienen del mismo <b>catalog-images</b> de HOTEL EXPERIENCE. Producto, modalidad y precio siguen naciendo de Supabase.</p></div>
      <div className="visual-catalog-count"><span>Experiencias</span><strong>{families.length}</strong><small>{products.length} tarifas / modalidades activas</small></div>
    </section>

    <section className="visual-catalog-toolbar">
      <div className="visual-catalog-search"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar experiencia, categoría o código…"/></div>
      <select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select>
    </section>

    <section className="visual-catalog-grid">
      {filtered.map(family=>{
        const heroProduct = family.products[0];
        const quotes = family.products.map(product=>quoteFor(product,2)).filter(quote=>quote.valid);
        const from = quotes.length ? Math.min(...quotes.map(quote=>quote.unit)) : null;
        return <article className="visual-product-card" key={family.slug}>
          <button className="visual-product-image-button" onClick={()=>setSelectedSlug(family.slug)} aria-label={`Abrir ${family.name}`}>
            <CatalogImage product={heroProduct} alt={family.name} className="visual-product-image"/>
            <span className="visual-product-category">{family.category}</span>
          </button>
          <div className="visual-product-copy">
            <span className="visual-product-kicker">{family.products.length} modalidad(es)</span>
            <h2>{family.name}</h2>
            <p>{family.description || 'Experiencia disponible en el catálogo HOTEL EXPERIENCE.'}</p>
            <div className="visual-product-bottom">
              <div><span>{from!=null?'Desde':'Tarifa'}</span><strong>{from!=null?clp(from):'Cotizar'}</strong></div>
              <button className="button dark" onClick={()=>setSelectedSlug(family.slug)}>Ver experiencia <ArrowRight size={15}/></button>
            </div>
          </div>
        </article>;
      })}
      {!filtered.length && <div className="visual-catalog-empty"><Search size={22}/><strong>No encontramos experiencias.</strong><span>Prueba otra categoría o búsqueda.</span></div>}
    </section>

    {selected && <div className="catalog-detail-backdrop" onClick={()=>setSelectedSlug('')}>
      <article className="catalog-detail-sheet" onClick={event=>event.stopPropagation()}>
        <button className="catalog-detail-close" onClick={()=>setSelectedSlug('')}>×</button>
        <div className="catalog-detail-media"><CatalogImage product={selected.products[0]} alt={selected.name} className="catalog-detail-image"/></div>
        <div className="catalog-detail-body">
          <div><p className="eyebrow">{selected.category}</p><h2>{selected.name}</h2><p className="catalog-detail-description">{selected.description || 'Experiencia disponible para cotización.'}</p></div>
          <div className="catalog-pax-row">
            <div><Users size={17}/><span><strong>Tarifa para el grupo</strong><small>Selecciona pasajeros para ver los tramos reales.</small></span></div>
            <div className="catalog-pax-stepper"><button onClick={()=>setPax(Math.max(1,pax-1))}><Minus size={14}/></button><strong>{pax}</strong><span>pax</span><button onClick={()=>setPax(Math.min(12,pax+1))}><Plus size={14}/></button></div>
          </div>
          <div className="catalog-variant-list">
            {selected.products.map(product=>{
              const quote = quoteFor(product,pax);
              return <div className="catalog-variant-row" key={product.id}>
                <div><span className="visual-product-kicker">{product.code}</span><strong>{modeLabel(product.price_mode)}</strong><small>{product.schedule || product.description || 'Modalidad disponible'}</small></div>
                <div className="catalog-variant-price">
                  {quote.valid?<><span>{clp(quote.unit)} {quote.label}</span><strong>{clp(quote.total)}</strong><small>Total {pax} pax</small></>:<><strong>Cotización manual</strong><small>No inventamos tarifa</small></>}
                </div>
                <button className="button dark" onClick={()=>onQuote(product.id)}>Cotizar <ArrowRight size={15}/></button>
              </div>;
            })}
          </div>
        </div>
      </article>
    </div>}
  </div>;
}
