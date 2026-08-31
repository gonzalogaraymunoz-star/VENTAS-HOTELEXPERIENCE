import { FormEvent, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  return <main className="login-screen">
    <section className="login-editorial">
      <div className="brand-mark inverse">LINK</div>
      <div>
        <p className="eyebrow inverse-text">HOTEL EXPERIENCE · COMERCIAL</p>
        <h1>Ventas sin perder el hilo de la operación.</h1>
        <p>Captura un huésped, arma su compra, registra el pago y entrega una venta limpia a Operaciones.</p>
      </div>
      <small>Lead → Pasajeros → Productos → Pago → Operación → Comisión</small>
    </section>
    <section className="login-panel">
      <form className="login-form" onSubmit={submit}>
        <div>
          <p className="eyebrow">ACCESO</p>
          <h2>LINK Ventas</h2>
          <p className="muted">Usa el mismo usuario de HOTEL EXPERIENCE.</p>
        </div>
        <label>Email<input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} autoComplete="email" required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="error-box">{error}</div>}
        <button className="button dark wide" disabled={loading}>{loading ? 'Ingresando…' : <>Ingresar <ArrowRight size={17}/></>}</button>
      </form>
    </section>
  </main>;
}
