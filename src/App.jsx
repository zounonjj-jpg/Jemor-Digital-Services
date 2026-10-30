import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { ArrowRight, Check, Code2, Globe, LayoutDashboard, LogIn, MessageCircle, MonitorSmartphone, Send, ShieldCheck, Sparkles } from 'lucide-react';

const money = value => new Intl.NumberFormat('fr-FR').format(value || 0) + ' F CFA';
const waNumber = import.meta.env.VITE_WHATSAPP_NUMBER || '';
const wa = /^229\d{8}$/.test(waNumber);
const waLink = () => 'https://wa.me/' + waNumber;
const emptyForm = { full_name:'', phone:'', business_name:'', service_id:'', project_type:'Site web', brief:'', budget_xof:'', preferred_contact:'WhatsApp' };

function Header(){return <header className="header"><a className="brand" href="#"><span className="brand-mark">J</span><span>JÉMOR <span className="brand-light">DIGITAL HOUSE</span></span></a><nav className="nav"><a href="#services">Services</a><a href="#methode">Méthode</a><a className="nav-cta" href="#contact">Démarrer un projet <ArrowRight size={15}/></a></nav></header>}

function LeadForm({services}) {
 const [form,setForm]=useState(emptyForm),[state,setState]=useState({busy:false,message:'',ok:false});
 const change=e=>setForm({...form,[e.target.name]:e.target.value});
 async function submit(e){e.preventDefault();if(!supabase){setState({busy:false,message:'Le formulaire est temporairement indisponible. Contacte-nous directement.',ok:false});return;}
 setState({busy:true,message:'Envoi en cours…',ok:false});
 const payload={...form,budget_xof:form.budget_xof?Number(form.budget_xof):null,service_id:form.service_id||null};
 const {error}=await supabase.from('agency_leads').insert(payload);
 if(error)setState({busy:false,message:'Impossible d’envoyer la demande. Réessaie dans un instant.',ok:false});
 else {setState({busy:false,message:'Demande envoyée ! Nous te recontacterons rapidement.',ok:true});setForm(emptyForm);}
 }
 return <form className="lead-form" onSubmit={submit}>
 <div className="form-grid"><label>Ton nom complet<input required minLength="2" name="full_name" value={form.full_name} onChange={change} placeholder="Ex. Jean K."/></label><label>Téléphone / WhatsApp<input required name="phone" value={form.phone} onChange={change} placeholder="+229…"/></label></div>
 <label>Entreprise ou activité (facultatif)<input name="business_name" value={form.business_name} onChange={change} placeholder="Nom de ton entreprise"/></label>
 <div className="form-grid"><label>Service souhaité<select name="service_id" value={form.service_id} onChange={change}><option value="">Je ne sais pas encore</option>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Budget indicatif<select name="budget_xof" value={form.budget_xof} onChange={change}><option value="">À discuter</option><option value="5000">Moins de 10 000 F</option><option value="15000">10 000 – 25 000 F</option><option value="30000">25 000 – 50 000 F</option><option value="50000">Plus de 50 000 F</option></select></label></div>
 <label>Décris ton besoin<textarea required minLength="10" maxLength="4000" name="brief" value={form.brief} onChange={change} placeholder="Que souhaites-tu créer ? Quelles fonctionnalités te seraient utiles ?" rows="4"/></label>
 <button className="btn btn-primary full" disabled={state.busy}>{state.busy?'Envoi…':'Envoyer ma demande'} <Send size={17}/></button>
 {state.message&&<p className={state.ok?'notice success':'notice'} role="status">{state.message}</p>}<p className="fine">Tes informations servent uniquement à traiter ta demande. Elles ne sont pas affichées publiquement.</p>
 </form>
}

function Admin(){
 const [session,setSession]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[leads,setLeads]=useState([]),[msg,setMsg]=useState('');
 useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data})=>setSession(data.session));const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>subscription.unsubscribe();},[]);
 async function load(){const {data,error}=await supabase.from('agency_leads').select('*').order('created_at',{ascending:false});if(error)setMsg('Accès refusé : vérifie le rôle agency_admin.');else setLeads(data||[]);}
 useEffect(()=>{if(session)load();},[session]);
 async function login(e){e.preventDefault();setMsg('Connexion…');const {error}=await supabase.auth.signInWithPassword({email,password});setMsg(error?'Connexion refusée. Vérifie tes identifiants et ton rôle administrateur.':'');}
 async function updateStatus(id,status){const {error}=await supabase.from('agency_leads').update({status,updated_at:new Date().toISOString()}).eq('id',id);if(error)setMsg('Mise à jour impossible.');else load();}
 if(!supabase)return <main className="admin-wrap"><p>Configure les variables Supabase avant d’ouvrir l’administration.</p></main>;
 if(!session)return <main className="admin-wrap"><a href="/" className="back">← Retour au site</a><div className="admin-card"><ShieldCheck size={34}/><h1>Espace administrateur</h1><p>Connecte-toi avec ton compte agence autorisé.</p><form onSubmit={login}><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Mot de passe<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="btn btn-primary full">Se connecter <LogIn size={16}/></button></form>{msg&&<p className="notice">{msg}</p>}</div></main>;
 return <main className="admin-wrap"><div className="admin-top"><div><p className="eyebrow">JÉMOR DIGITAL HOUSE</p><h1>Demandes clients</h1></div><button className="btn btn-outline" onClick={()=>supabase.auth.signOut()}>Déconnexion</button></div>{msg&&<p className="notice">{msg}</p>}<div className="stats"><div><b>{leads.length}</b><span>Total demandes</span></div><div><b>{leads.filter(x=>x.status==='new').length}</b><span>Nouvelles</span></div><div><b>{leads.filter(x=>x.status==='in_progress').length}</b><span>En cours</span></div></div><div className="lead-list">{leads.map(l=><article className="lead-card" key={l.id}><div className="lead-head"><div><b>{l.full_name}</b><small>{l.business_name||'Particulier'} · {new Date(l.created_at).toLocaleString('fr-FR')}</small></div><a className="phone-link" href={'tel:'+l.phone}>{l.phone}</a></div><p>{l.brief}</p><div className="lead-actions"><span>{l.project_type}</span><select value={l.status} onChange={e=>updateStatus(l.id,e.target.value)}><option value="new">Nouveau</option><option value="contacted">Contacté</option><option value="quoted">Devis envoyé</option><option value="in_progress">En cours</option><option value="delivered">Livré</option><option value="cancelled">Annulé</option></select><a href={'https://wa.me/'+l.phone.replace(/\D/g,'')} target="_blank" rel="noreferrer">WhatsApp ↗</a></div></article>)}</div></main>
}

function Site(){
 const [services,setServices]=useState([]),[loading,setLoading]=useState(true);
 useEffect(()=>{if(!supabase){setLoading(false);return;}supabase.from('agency_services').select('*').eq('active',true).order('sort_order').then(({data})=>{setServices(data||[]);setLoading(false);});},[]);
 if(location.pathname==='/admin')return <Admin/>;
 return <><Header/><main><section className="hero"><div className="hero-glow"></div><div className="hero-content"><div className="eyebrow"><Sparkles size={15}/> LE DIGITAL AU SERVICE DE VOS IDÉES</div><h1>Fais grandir ton activité <span>avec le digital.</span></h1><p>Des sites web professionnels et des solutions numériques simples, modernes et adaptées à ton entreprise.</p><div className="hero-actions"><a className="btn btn-primary" href="#contact">Parlons de ton projet <ArrowRight size={17}/></a><a className="btn btn-ghost" href="#services">Découvrir les services</a></div><div className="hero-proof"><span><Check size={15}/> Adapté au mobile</span><span><Check size={15}/> Accompagnement direct</span></div></div><div className="hero-art"><div className="art-card"><div className="art-top"><i></i><i></i><i></i></div><div className="art-screen"><div className="art-line wide"></div><div className="art-line"></div><div className="art-blocks"><i></i><i></i><i></i></div><div className="art-line short"></div></div></div><div className="float-chip"><Globe size={18}/> Présence en ligne</div><div className="float-chip second"><Code2 size={18}/> Solutions sur mesure</div></div></section>
 <section className="trust-strip"><span>POUR LES ENTREPRENEURS</span><span>COMMERCES</span><span>ASSOCIATIONS</span><span>PME & INDÉPENDANTS</span></section>
 <section id="services" className="section"><div className="section-heading"><p className="eyebrow">NOS SOLUTIONS</p><h2>Les bons outils pour <span>passer au niveau supérieur.</span></h2><p>Choisis un service ou explique-nous ton besoin. Nous construirons une solution adaptée à ton activité.</p></div>{loading?<p>Chargement des services…</p>:<div className="service-grid">{services.map((s,i)=><article className="service-card" key={s.id}><div className="service-icon">{i===0?<MonitorSmartphone/>:i===1?<LayoutDashboard/>:<Code2/>}</div><p className="service-tag">0{i+1} / SERVICE</p><h3>{s.name}</h3><p>{s.short_description}</p><div className="service-bottom"><div><small>À partir de</small><b>{money(s.price_from_xof)}</b></div><a href="#contact" aria-label={'Demander '+s.name}><ArrowRight/></a></div></article>)}</div>}</section>
 <section id="methode" className="method-section"><div className="section-heading"><p className="eyebrow">COMMENT ÇA MARCHE</p><h2>De ton idée à <span>ta solution en ligne.</span></h2></div><div className="steps"><div><b>01</b><h3>Tu nous expliques</h3><p>Ton activité, tes objectifs et ce dont tu as besoin.</p></div><div><b>02</b><h3>Nous proposons</h3><p>Une solution claire, un délai et un devis avant le démarrage.</p></div><div><b>03</b><h3>Nous réalisons</h3><p>Tu suis l'avancement et tu testes le résultat.</p></div><div><b>04</b><h3>Tu prends en main</h3><p>Après validation et règlement convenu, nous livrons ton projet.</p></div></div></section>
 <section id="contact" className="contact-section"><div className="contact-copy"><p className="eyebrow">ON EN PARLE ?</p><h2>Ton prochain projet commence <span>ici.</span></h2><p>Décris-nous ton idée. Nous te répondrons pour préciser le besoin et préparer une proposition adaptée.</p>{wa&&<a className="btn btn-whatsapp" href={waLink()} target="_blank" rel="noreferrer"><MessageCircle size={18}/> Écrire sur WhatsApp</a>}<div className="contact-note"><ShieldCheck size={18}/> Demande sans engagement. Aucun paiement n'est demandé via ce formulaire.</div></div><LeadForm services={services}/></section></main><footer><a className="brand" href="#"><span className="brand-mark">J</span><span>JÉMOR <span className="brand-light">DIGITAL HOUSE</span></span></a><span>© {new Date().getFullYear()} Jémor Digital House. Tous droits réservés.</span><a href="/admin">Administration</a></footer></>;
}
export default function App(){return <Site/>;}
