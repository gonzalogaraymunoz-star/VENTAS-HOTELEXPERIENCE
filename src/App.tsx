import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import type { Profile } from './types';
import LoginScreen from './components/LoginScreen';
import SalesAppV2 from './components/SalesAppV2';
import PendingClientTasks from './components/PendingClientTasks';
import PartnerPortal from './components/PartnerPortal';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routeHash, setRouteHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRouteHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    let alive = true;
    void (async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (!alive) return;
      setProfile((data || {
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuario',
        role: 'agent',
        is_active: true,
      }) as Profile);
    })();
    return () => { alive = false; };
  }, [session?.user.id]);

  if (routeHash === '#/escritorio') return <PartnerPortal />;
  if (session === undefined) return <div className="center-screen"><div className="brand-mark">LINK</div><p>Conectando ventas…</p></div>;
  if (!session) return <><LoginScreen /><a href="#/escritorio" style={{position:'fixed',right:24,bottom:20,zIndex:50,fontSize:12,fontWeight:800,color:'#242424',background:'#fff',border:'1px solid #dedbd5',borderRadius:999,padding:'11px 15px',textDecoration:'none',boxShadow:'0 8px 24px rgba(0,0,0,.08)'}}>Acceso de recepción y vendedores →</a></>;
  if (!profile) return <div className="center-screen"><div className="brand-mark">LINK</div><p>Preparando tu espacio comercial…</p></div>;
  if (profile.is_active === false) return <div className="center-screen"><h1>Cuenta desactivada</h1><button className="button dark" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></div>;
  return <><SalesAppV2 profile={profile} /><PendingClientTasks scope="sales" /></>;
}
