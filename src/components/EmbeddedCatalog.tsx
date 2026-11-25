import './EmbeddedCatalog.css';

const DEFAULT_CATALOG_URL = 'https://hotel-experience-web.gonzalogaraymunoz.workers.dev/catalogo';

export default function EmbeddedCatalog() {
  const catalogUrl = DEFAULT_CATALOG_URL;

  return <div className="embedded-catalog-shell">
    <iframe
      className="embedded-catalog-frame"
      src={catalogUrl}
      title="Catálogo Hotel Experience"
      loading="eager"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  </div>;
}
