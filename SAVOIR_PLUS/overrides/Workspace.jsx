import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, BadgeCheck, BarChart3, BookOpen, BookMarked, Check,
  CheckCircle2, ChevronDown, Clock3, Download, GraduationCap, Heart, Library,
  Link2, LockKeyhole, Mail, MessageCircle, Plus, Send, ShieldCheck, Sparkles,
  UserRound, Users, Video, Wallet, X
} from 'lucide-react';
import { configured, supabase } from './supabase';

const money = n => new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA';
const dateLabel = value => value ? new Date(value).toLocaleDateString('fr-FR') : '—';
const initials = value => (value || 'S').trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join('');
const errorText = error => error?.message || 'Une erreur est survenue. Réessaie.';

function Panel({ title, subtitle, action, children }) {
  return <section className="panel workspace-panel"><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function EmptyState({ title, text, action }) {
  return <div className="workspace-empty"><BookOpen size={28}/><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function Stat({ label, value, detail, icon: Icon = Activity }) {
  return <div className="workspace-stat"><span>{label}</span><b>{value}</b><small><Icon size={14}/>{detail}</small></div>;
}
function Gate({ onNavigate }) {
  return <main className="container page-main"><div className="panel"><EmptyState title="Connexion nécessaire" text="Connecte-toi pour accéder à cet espace personnel." action={<button className="btn btn-primary" onClick={() => onNavigate('/connexion')}>Se connecter</button>}/></div></main>;
}

export function WorkspaceRouter({ page, path, session, profile, role, notify, navigate }) {
  if (!session && ['dashboard','library','studio','course','parents','messages','teacher-profile'].includes(page)) return <Gate onNavigate={navigate}/>;
  if (page === 'dashboard') return role === 'teacher'
    ? <TeacherDashboard session={session} profile={profile} navigate={navigate} notify={notify}/>
    : role === 'parent'
      ? <ParentDashboard session={session} profile={profile} navigate={navigate} notify={notify}/>
      : role === 'admin'
        ? <main className="container page-main"><Panel title="Espace administrateur" subtitle="Le centre de contrôle complet est disponible dans l’administration."><button className="btn btn-primary" onClick={() => navigate('/admin')}>Ouvrir l’administration</button></Panel></main>
        : <StudentDashboard session={session} profile={profile} navigate={navigate} notify={notify}/>;
  if (page === 'library') return role==='teacher'?<TeacherDashboard session={session} profile={profile} navigate={navigate} notify={notify}/>:role==='parent'?<ParentDashboard session={session} profile={profile} navigate={navigate} notify={notify}/>:<StudentDashboard session={session} profile={profile} navigate={navigate} notify={notify} showLibrary/>;
  if (page === 'studio') return role === 'teacher' || role === 'admin' ? <CourseStudio session={session} notify={notify} navigate={navigate}/> : <main className="container page-main"><EmptyState title="Espace enseignant requis" text="Le studio de création est réservé aux enseignants."/></main>;
  if (page === 'course') return <CoursePlayer listingId={path.split('/')[2]} session={session} role={role} notify={notify} navigate={navigate}/>;
  if (page === 'parents') return role === 'parent' ? <ParentDashboard session={session} profile={profile} navigate={navigate} notify={notify}/> : role==='teacher'?<TeacherDashboard session={session} profile={profile} navigate={navigate} notify={notify}/>:<StudentDashboard session={session} profile={profile} navigate={navigate} notify={notify}/>;
  if (page === 'messages') return <MessagesPage session={session} profile={profile} role={role} notify={notify}/>;
  if (page === 'teacher-profile') return role === 'teacher' ? <TeacherProfileEditor session={session} profile={profile} notify={notify} navigate={navigate}/> : <main className="container page-main"><EmptyState title="Espace enseignant requis" text="Cette page est réservée aux enseignants."/></main>;
  if (page === 'child-progress') return role === 'parent' ? <ParentChildProgress studentId={path.split('/')[2]} session={session} notify={notify} navigate={navigate}/> : <main className="container page-main"><EmptyState title="Espace parent requis" text="Le suivi familial est réservé aux parents ayant un lien accepté."/></main>;
  if (page === 'teachers') return <TeachersDirectory navigate={navigate}/>;
  return null;
}

function StudentDashboard({ session, profile, navigate, notify, showLibrary = false }) {
  const [enrollments, setEnrollments] = useState([]);
  const [progress, setProgress] = useState([]);
  const [pendingLinks, setPendingLinks] = useState([]);
  const [linkCode, setLinkCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const [e, p, links, code] = await Promise.all([
      supabase.from('enrollments').select('id,listing_id,status,enrolled_at,listing:listings(id,title,description,subject,level,kind,price_xof,cover_image_url)').eq('learner_id', session.user.id).order('enrolled_at', { ascending: false }),
      supabase.from('lesson_progress').select('id,lesson_id,completed,watched_seconds,lesson:lessons!lesson_progress_lesson_id_fkey(module:course_modules!lessons_module_id_fkey(listing_id))').eq('learner_id', session.user.id),
      supabase.from('parent_student_links').select('id,status,parent:profiles!parent_student_links_parent_id_fkey(id,display_name)').eq('student_id', session.user.id).eq('status', 'pending'),
      profile?.account_type === 'student' ? supabase.rpc('get_my_parent_link_code') : Promise.resolve({data:null,error:null})
    ]);
    if (e.error) notify(errorText(e.error), 'error'); else setEnrollments(e.data || []);
    if (p.data) setProgress(p.data);
    if (links.data) setPendingLinks(links.data);
    if (!code.error) setLinkCode(code.data || '');
    setLoading(false);
  }, [session, profile?.account_type, notify]);
  useEffect(() => { load(); }, [load]);
  const completed = progress.filter(x => x.completed).length;
  const inProgress = enrollments.filter(x => x.status === 'active').length;
  async function respond(id, accept) {
    setBusyId(id);
    const { error } = await supabase.rpc('respond_parent_link', { p_link_id: id, p_accept: accept });
    setBusyId('');
    if (error) notify(errorText(error), 'error'); else { notify(accept ? 'Lien parental accepté.' : 'Demande refusée.', 'success'); load(); }
  }
  const visible = enrollments.filter(x => x.status !== 'revoked' && x.listing);
  return <main className="container page-main workspace-page">
    <div className="dashboard-heading"><div><span className="eyebrow">ESPACE APPRENANT</span><h1>Bonjour {profile?.display_name?.split(' ')[0] || 'et bienvenue'} 👋</h1><p>Retrouve tes formations, ta progression et tes ressources gratuites.</p></div><span className="role-pill">{profile?.account_type==='parent'?'Parent':profile?.learner_kind==='university_student'?'Étudiant':'Élève'}</span></div>
    <div className="workspace-stats">
      <Stat label="Mes ressources" value={enrollments.length} detail="Accès actifs" icon={Library}/>
      <Stat label="En cours" value={inProgress} detail="Formations suivies" icon={BookOpen}/>
      <Stat label="Leçons terminées" value={completed} detail="Progression" icon={CheckCircle2}/>
    </div>
    {(profile?.school_class||profile?.university_year||profile?.study_field)&&<Panel title={profile?.learner_kind==='university_student'?'Mon parcours universitaire':'Ma scolarité'} subtitle={profile?.signup_goal||'Tes informations de parcours.'}><div className="workspace-row"><div><b>{profile?.learner_kind==='university_student'?[profile?.university_year,profile?.study_field].filter(Boolean).join(' · '):profile?.school_class}</b><small>{profile?.birth_year?`Année de naissance : ${profile.birth_year}`:''}</small></div></div></Panel>}
    {pendingLinks.length > 0 && <Panel title="Demandes de liaison parentale" subtitle="Un parent demande l’accès au suivi de ton espace.">{pendingLinks.map(link => <div className="workspace-row" key={link.id}><div><b>{link.parent?.display_name || 'Un parent'}</b><small>Demande reçue le {dateLabel(link.created_at)}</small></div><div className="inline-actions"><button className="btn btn-soft btn-sm" disabled={busyId === link.id} onClick={() => respond(link.id, true)}>Accepter</button><button className="btn btn-danger btn-sm" disabled={busyId === link.id} onClick={() => respond(link.id, false)}>Refuser</button></div></div>)}</Panel>}
    {showLibrary ? <div className="page-intro"><span className="eyebrow">MA BIBLIOTHÈQUE</span><h1>Mes ressources</h1><p>Les ressources auxquelles tu as accès sont regroupées ici.</p></div> : null}
    <Panel title={showLibrary ? 'Mes formations et ressources' : 'Continuer mon apprentissage'} subtitle="Les contenus payants restent désactivés tant que le paiement n’est pas configuré." action={<button className="text-button" onClick={() => navigate('/explorer')}>Explorer les ressources <ArrowRight size={15}/></button>}>
      {loading ? <p className="muted">Chargement de ta bibliothèque…</p> : visible.length ? <div className="workspace-course-grid">{visible.map(item => {
        const courseProgress = progress.filter(x => x.lesson?.module?.listing_id === item.listing_id && x.completed).length;
        return <article className="workspace-course-card" key={item.id}>
          <div className="course-cover"><BookMarked size={26}/><span>{item.listing?.kind || 'Ressource'}</span></div>
          <div className="course-card-content"><span className="eyebrow">{item.listing?.subject} · {item.listing?.level}</span><h3>{item.listing?.title}</h3><p>{item.listing?.description}</p><small>{courseProgress} leçon(s) terminée(s)</small><button className="btn btn-primary" onClick={() => navigate(`/apprendre/${item.listing_id}`)}>Continuer <ArrowRight size={16}/></button></div>
        </article>;
      })}</div> : <EmptyState title="Ta bibliothèque est prête à accueillir tes cours" text="Tu peux commencer par une ressource gratuite publiée sur SAVOIR+. Les ressources payantes seront activées après la configuration des paiements." action={<button className="btn btn-primary" onClick={() => navigate('/explorer')}>Explorer les ressources</button>}/>}
    </Panel>
    {profile?.account_type === 'student' && <Panel title="Liaison avec un parent" subtitle="Partage ce code uniquement avec ton parent pour lui permettre de suivre ta progression."><div className="link-code-box"><div><span className="muted">Ton code personnel</span><b>{linkCode || 'Indisponible'}</b></div><button className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard?.writeText(linkCode); notify('Code copié.', 'success'); }} disabled={!linkCode}><Link2 size={15}/> Copier</button></div></Panel>}
    <div className="workspace-shortcuts"><button onClick={() => navigate('/favoris')}><Heart/>Mes favoris</button><button onClick={() => navigate('/messages')}><MessageCircle/>Mes messages</button><button onClick={() => navigate('/parents')}><Users/>Espace famille</button></div>
  </main>;
}

function TeacherDashboard({ session, profile, navigate, notify }) {
  const [listings, setListings] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [teacher, setTeacher] = useState(null);
  const [customers,setCustomers]=useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const [l, m, t, c] = await Promise.all([
      supabase.from('listings').select('id,title,subject,level,kind,price_xof,status,created_at').eq('seller_id', session.user.id).order('created_at', { ascending: false }),
      supabase.rpc('get_teacher_metrics'),
      supabase.from('teacher_profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.rpc('get_teacher_customers')
    ]);
    if (l.error) notify(errorText(l.error), 'error'); else setListings(l.data || []);
    if (!m.error) setMetrics(m.data);
    if (t.data) setTeacher(t.data);
    if(!c.error)setCustomers(c.data||[]);
    setLoading(false);
  }, [session, notify]);
  useEffect(() => { load(); }, [load]);
  return <main className="container page-main workspace-page">
    <div className="dashboard-heading"><div><span className="eyebrow">ESPACE CRÉATEUR · MA BOUTIQUE</span><h1>Bonjour {profile?.display_name?.split(' ')[0] || 'créateur'} 👋</h1><p>{teacher?.store_name||'Ta boutique'} · Gère tes produits, tes clients et ton activité.</p></div><span className="role-pill">Créateur</span></div>
    <div className="workspace-shortcuts"><button onClick={() => navigate('/mes-cours')}><BookOpen/>Studio de cours</button><button onClick={() => navigate('/profil-enseignant')}><UserRound/>Mon profil public</button><button onClick={() => navigate('/messages')}><MessageCircle/>Messagerie</button></div>
    <div className="workspace-stats">
      <Stat label="Ressources" value={metrics?.total_listings ?? listings.length} detail="Toutes publications" icon={BookMarked}/>
      <Stat label="Publiées" value={metrics?.published_listings ?? listings.filter(x=>x.status==='approved').length} detail="Visibles sur la plateforme" icon={BadgeCheck}/>
      <Stat label="Clients" value={customers.length} detail="Achats confirmés" icon={Users}/>
      <Stat label="Consultations" value={metrics?.total_views ?? 0} detail="Vues de tes ressources" icon={BarChart3}/>
    </div>
    <div className="workspace-stats workspace-stats-secondary">
      <Stat label="Consultations" value={metrics?.total_views ?? 0} detail="Vues enregistrées" icon={BarChart3}/>
      <Stat label="Quiz réalisés" value={metrics?.quiz_attempts ?? 0} detail="Tentatives des apprenants" icon={CheckCircle2}/>
      <Stat label="Revenus" value="Désactivés" detail="Paiement non configuré" icon={Wallet}/>
    </div>
    <Panel title="Ma boutique · Mes produits" subtitle="Publie directement tes ressources. Elles deviennent visibles sans validation préalable." action={<button className="btn btn-primary btn-sm" onClick={() => navigate('/devenir-enseignant')}><Plus size={15}/> Nouvelle ressource</button>}>
      {loading ? <p className="muted">Chargement…</p> : listings.length ? listings.map(item => <div className="workspace-row" key={item.id}><div><b>{item.title}</b><small>{item.subject} · {item.level} · {item.kind} · {money(item.price_xof)}</small></div><span className={`status-pill ${item.status}`}>{item.status === 'approved' ? 'Publiée' : item.status === 'pending' ? 'En validation' : item.status === 'rejected' ? 'Refusée' : item.status}</span><button className="text-button" onClick={() => navigate('/mes-cours')}>Organiser <ArrowRight size={15}/></button></div>) : <EmptyState title="Aucune ressource publiée" text="Commence par créer une fiche, un cours ou un exercice. La publication reste soumise à validation." action={<button className="btn btn-primary" onClick={() => navigate('/devenir-enseignant')}>Créer une ressource</button>}/>}
    </Panel>
    <Panel title="Informations de ma boutique" subtitle="Ton espace vendeur est distinct de l’espace apprenant."><div className="workspace-row"><div><b>{teacher?.store_name||teacher?.headline||'Ma boutique'}</b><small>{teacher?.store_description||teacher?.headline||'Ajoute une présentation à ta boutique.'}</small><small>{teacher?.all_subjects?'Toutes les matières':(teacher?.subjects||[]).join(' · ')||'Matières à renseigner'} · {teacher?.all_levels?'Tous les niveaux':(teacher?.levels||[]).join(' · ')||'Niveaux à renseigner'}</small></div><button className="btn btn-outline btn-sm" onClick={() => navigate('/profil-enseignant')}>Modifier</button></div></Panel><Panel title="Mes clients" subtitle="Les coordonnées des acheteurs sont affichées après confirmation réelle d’un paiement.">{customers.length?customers.map(c=><div className="workspace-row" key={c.order_id+':'+c.listing_id}><div><b>{c.buyer_name}</b><small>{c.buyer_email} · {c.listing_title} · {dateLabel(c.purchased_at)}</small></div><strong>{money(c.amount_xof)}</strong></div>):<EmptyState title="Aucun achat confirmé" text="Les clients apparaîtront ici après les premiers paiements confirmés. Aucun faux client ni faux revenu n’est affiché."/>}</Panel>
    <NoticePaymentDisabled/>
  </main>;
}

function NoticePaymentDisabled() {
  return <div className="notice payment-disabled"><Wallet size={18}/><span>Les ventes, commissions et retraits sont volontairement suspendus. Aucun solde ni revenu fictif n’est affiché.</span></div>;
}

function ParentDashboard({ session, profile, navigate, notify }) {
  const [links,setLinks] = useState([]);
  const [code,setCode] = useState('');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await supabase.from('parent_student_links').select('id,student_id,status,created_at,student:profiles!parent_student_links_student_id_fkey(id,display_name,country)').eq('parent_id',session.user.id).order('created_at',{ascending:false});
    if(error)notify(errorText(error),'error');else setLinks(data||[]);
    setLoading(false);
  },[session,notify]);
  useEffect(()=>{load();},[load]);
  async function requestLink(e){e.preventDefault();if(!code.trim())return;setBusy(true);const {error}=await supabase.rpc('request_parent_link_by_code',{p_code:code.trim()});setBusy(false);if(error)notify(errorText(error),'error');else{notify('Demande envoyée à l’apprenant.','success');setCode('');load();}}
  const active=links.filter(x=>x.status==='active');
  return <main className="container page-main workspace-page"><div className="dashboard-heading"><div><span className="eyebrow">ESPACE PARENT</span><h1>Suivi familial</h1><p>Relie ton compte à celui de ton enfant pour suivre son apprentissage.{profile?.child_class?` Classe déclarée : ${profile.child_class}.`:''}</p></div><span className="role-pill">Parent</span></div>
    <div className="workspace-stats"><Stat label="Enfants liés" value={active.length} detail="Liens confirmés" icon={Users}/><Stat label="Demandes en attente" value={links.filter(x=>x.status==='pending').length} detail="En cours de validation" icon={Clock3}/></div>
    <Panel title="Ajouter un apprenant" subtitle="Demande à ton enfant son code de liaison personnel. Le lien ne sera actif qu’après son accord."><form className="link-request-form" onSubmit={requestLink}><input value={code} onChange={e=>setCode(e.target.value)} placeholder="Code de liaison de l’apprenant" maxLength={24}/><button className="btn btn-primary" disabled={busy || !code.trim()}>{busy?'Envoi…':'Envoyer la demande'}</button></form></Panel>
    <Panel title="Mes enfants" subtitle="Les progrès ne sont visibles qu’après acceptation de la demande par l’apprenant.">{loading?<p className="muted">Chargement…</p>:links.length?links.map(link=><div className="workspace-row" key={link.id}><div><b>{link.student?.display_name || 'Apprenant'}</b><small>{link.student?.country || 'Pays non renseigné'} · Demande du {dateLabel(link.created_at)}</small></div><span className={`status-pill ${link.status}`}>{link.status==='active'?'Actif':link.status==='pending'?'En attente':'Refusé'}</span>{link.status==='active'&&<button className="text-button" onClick={()=>navigate(`/suivi/${link.student_id}`)}>Voir le suivi <ArrowRight size={15}/></button>}</div>):<EmptyState title="Aucun apprenant lié" text="Ajoute le code de liaison communiqué par ton enfant."/>}</Panel>
  </main>;
}

function CourseStudio({ session, notify, navigate }) {
  const [listings,setListings]=useState([]),[listingId,setListingId]=useState(''),[modules,setModules]=useState([]),[lessons,setLessons]=useState([]),[quizzes,setQuizzes]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [moduleForm,setModuleForm]=useState({title:'',description:''});
  const [lessonForm,setLessonForm]=useState({module_id:'',title:'',content:'',video_url:'',duration_minutes:'',is_preview:false});
  const [quizForm,setQuizForm]=useState({title:'',description:'',passing_score:60});
  const [questionForm,setQuestionForm]=useState({quiz_id:'',question_text:'',options:['','','',''],correct:0,points:1});
  const loadListings=useCallback(async()=>{setLoading(true);const {data,error}=await supabase.from('listings').select('id,title,status,kind').eq('seller_id',session.user.id).order('created_at',{ascending:false});if(error)notify(errorText(error),'error');else{setListings(data||[]);if(!listingId&&data?.[0])setListingId(data[0].id);}setLoading(false);},[session,notify,listingId]);
  const loadCourse=useCallback(async()=>{if(!listingId)return;const [m,q]=await Promise.all([supabase.from('course_modules').select('*').eq('listing_id',listingId).order('sort_order'),supabase.from('quizzes').select('*').eq('listing_id',listingId).order('created_at')]);if(m.error)notify(errorText(m.error),'error');else{setModules(m.data||[]);const ids=(m.data||[]).map(x=>x.id);if(ids.length){const {data,error}=await supabase.from('lessons').select('*').in('module_id',ids).order('sort_order');if(error)notify(errorText(error),'error');else setLessons(data||[]);}else setLessons([]);}if(q.error)notify(errorText(q.error),'error');else setQuizzes(q.data||[]);},[listingId,notify]);
  useEffect(()=>{loadListings();},[loadListings]);
  useEffect(()=>{loadCourse();},[loadCourse]);
  async function addModule(e){e.preventDefault();if(!moduleForm.title.trim()||!listingId)return;setBusy(true);const {error}=await supabase.from('course_modules').insert({listing_id:listingId,title:moduleForm.title.trim(),description:moduleForm.description,sort_order:modules.length});setBusy(false);if(error)notify(errorText(error),'error');else{notify('Module ajouté.','success');setModuleForm({title:'',description:''});loadCourse();}}
  async function addLesson(e){e.preventDefault();if(!lessonForm.module_id||!lessonForm.title.trim())return;setBusy(true);const {error}=await supabase.from('lessons').insert({module_id:lessonForm.module_id,title:lessonForm.title.trim(),content:lessonForm.content,video_url:lessonForm.video_url.trim()||null,duration_minutes:Number(lessonForm.duration_minutes||0),is_preview:lessonForm.is_preview,is_published:false,sort_order:lessons.filter(x=>x.module_id===lessonForm.module_id).length});setBusy(false);if(error)notify(errorText(error),'error');else{notify('Leçon ajoutée en brouillon.','success');setLessonForm({module_id:lessonForm.module_id,title:'',content:'',video_url:'',duration_minutes:'',is_preview:false});loadCourse();}}
  async function publishModule(id,value){const {error}=await supabase.from('course_modules').update({is_published:value}).eq('id',id);if(error)notify(errorText(error),'error');else{notify(value?'Module publié.':'Module masqué.','success');loadCourse();}}
  async function publishLesson(id,value){const {error}=await supabase.from('lessons').update({is_published:value}).eq('id',id);if(error)notify(errorText(error),'error');else loadCourse();}
  async function addQuiz(e){e.preventDefault();if(!quizForm.title.trim()||!listingId)return;setBusy(true);const {data,error}=await supabase.from('quizzes').insert({listing_id:listingId,title:quizForm.title.trim(),description:quizForm.description,passing_score:Number(quizForm.passing_score),is_published:false}).select('id').single();setBusy(false);if(error)notify(errorText(error),'error');else{notify('Quiz créé.','success');setQuizForm({title:'',description:'',passing_score:60});loadCourse();setQuestionForm(x=>({...x,quiz_id:data.id}));}}
  async function addQuestion(e){e.preventDefault();const opts=questionForm.options.map(x=>x.trim());if(!questionForm.quiz_id||!questionForm.question_text.trim()||opts.some(x=>!x))return;setBusy(true);const {data:q,error:qError}=await supabase.from('quiz_questions').insert({quiz_id:questionForm.quiz_id,question_text:questionForm.question_text.trim(),question_type:'single_choice',points:Number(questionForm.points),sort_order:0}).select('id').single();if(qError){setBusy(false);notify(errorText(qError),'error');return;}const {data:inserted,error:optError}=await supabase.from('quiz_options').insert(opts.map((option_text,i)=>({question_id:q.id,option_text,sort_order:i}))).select('id');if(optError){await supabase.from('quiz_questions').delete().eq('id',q.id);setBusy(false);notify(errorText(optError),'error');return;}const correctId=inserted?.[Number(questionForm.correct)]?.id;const {error:keyError}=await supabase.from('quiz_answer_keys').insert({question_id:q.id,correct_option_ids:[correctId],accepted_text_answers:[]});setBusy(false);if(keyError){await supabase.from('quiz_questions').delete().eq('id',q.id);notify(errorText(keyError),'error');return;}notify('Question et corrigé enregistrés en sécurité.','success');setQuestionForm(x=>({...x,question_text:'',options:['','','',''],correct:0}));loadCourse();}
  async function publishQuiz(id,value){if(value){const {data:questions,error:qError}=await supabase.from('quiz_questions').select('id').eq('quiz_id',id);if(qError){notify(errorText(qError),'error');return;}if(!questions?.length){notify('Ajoute au moins une question avant de publier ce quiz.','error');return;}const ids=questions.map(q=>q.id);const {data:keys,error:kError}=await supabase.from('quiz_answer_keys').select('question_id').in('question_id',ids);if(kError){notify(errorText(kError),'error');return;}if(new Set((keys||[]).map(k=>k.question_id)).size!==ids.length){notify('Chaque question doit avoir un corrigé avant la publication.','error');return;}}const {error}=await supabase.from('quizzes').update({is_published:value}).eq('id',id);if(error)notify(errorText(error),'error');else{notify(value?'Quiz publié.':'Quiz masqué.','success');loadCourse();}}
  return <main className="container page-main workspace-page"><div className="dashboard-heading"><div><span className="eyebrow">STUDIO ENSEIGNANT</span><h1>Construire mes cours</h1><p>Organise tes formations en modules, leçons et quiz.</p></div><button className="btn btn-outline" onClick={()=>navigate('/mon-espace')}>Mon tableau de bord</button></div>
    <Panel title="Choisir une ressource" subtitle="Les ressources approuvées pourront être suivies par les apprenants.">{loading?<p className="muted">Chargement…</p>:listings.length?<select className="studio-select" value={listingId} onChange={e=>setListingId(e.target.value)}>{listings.map(x=><option key={x.id} value={x.id}>{x.title} · {x.status==='approved'?'Publiée':'En validation'}</option>)}</select>:<EmptyState title="Aucune ressource à organiser" text="Crée d’abord une ressource puis reviens ici pour ajouter les modules et les leçons." action={<button className="btn btn-primary" onClick={()=>navigate('/devenir-enseignant')}>Créer une ressource</button>}/>}</Panel>
    {listingId&&<div className="studio-grid">
      <Panel title="Modules" subtitle="Découpe ta formation en chapitres."><form className="form-stack" onSubmit={addModule}><label className="field"><span>Titre du module</span><input value={moduleForm.title} onChange={e=>setModuleForm({...moduleForm,title:e.target.value})} required maxLength={180}/></label><label className="field"><span>Description</span><textarea rows="2" value={moduleForm.description} onChange={e=>setModuleForm({...moduleForm,description:e.target.value})}/></label><button className="btn btn-primary" disabled={busy}>Ajouter un module <Plus size={15}/></button></form><div className="studio-list">{modules.map(m=><div key={m.id} className="studio-item"><div><b>{m.title}</b><small>{lessons.filter(l=>l.module_id===m.id).length} leçon(s)</small></div><span className={`status-pill ${m.is_published?'approved':'pending'}`}>{m.is_published?'Publié':'Brouillon'}</span><button className={`btn btn-sm ${m.is_published?'btn-soft':'btn-success'}`} onClick={()=>publishModule(m.id,!m.is_published)}>{m.is_published?'Masquer':'Publier'}</button></div>)}{!modules.length&&<p className="muted">Aucun module créé.</p>}</div></Panel>
      <Panel title="Ajouter une leçon" subtitle="Un texte pédagogique ou un lien vidéo externe."><form className="form-stack" onSubmit={addLesson}><label className="field"><span>Module</span><select required value={lessonForm.module_id} onChange={e=>setLessonForm({...lessonForm,module_id:e.target.value})}><option value="">Choisir un module</option>{modules.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label><label className="field"><span>Titre de la leçon</span><input required value={lessonForm.title} onChange={e=>setLessonForm({...lessonForm,title:e.target.value})}/></label><label className="field"><span>Contenu pédagogique</span><textarea rows="5" value={lessonForm.content} onChange={e=>setLessonForm({...lessonForm,content:e.target.value})} placeholder="Explication, consignes, exemples…"/></label><label className="field"><span>Lien vidéo (facultatif)</span><input type="url" value={lessonForm.video_url} onChange={e=>setLessonForm({...lessonForm,video_url:e.target.value})} placeholder="https://…"/></label><div className="two-fields"><label className="field"><span>Durée (minutes)</span><input type="number" min="0" max="1440" value={lessonForm.duration_minutes} onChange={e=>setLessonForm({...lessonForm,duration_minutes:e.target.value})}/></label><label className="checkbox-field"><input type="checkbox" checked={lessonForm.is_preview} onChange={e=>setLessonForm({...lessonForm,is_preview:e.target.checked})}/> Leçon d’aperçu gratuit</label></div><button className="btn btn-primary" disabled={busy||!modules.length}>Ajouter la leçon</button></form></Panel>
      <Panel title="Leçons du cours" subtitle="Publie seulement les leçons que tu as vérifiées."><div className="studio-list">{lessons.map(l=><div className="studio-item" key={l.id}><div><b>{l.title}</b><small>{modules.find(m=>m.id===l.module_id)?.title || ''} · {l.duration_minutes} min {l.is_preview?'· Aperçu':''}</small></div><button className={`btn btn-sm ${l.is_published?'btn-soft':'btn-success'}`} onClick={()=>publishLesson(l.id,!l.is_published)}>{l.is_published?'Masquer':'Publier'}</button></div>)}{!lessons.length&&<p className="muted">Ajoute ta première leçon pour démarrer.</p>}</div></Panel>
      <Panel title="Quiz et évaluations" subtitle="Les réponses correctes restent protégées et la note est calculée côté serveur."><form className="form-stack" onSubmit={addQuiz}><label className="field"><span>Titre du quiz</span><input required value={quizForm.title} onChange={e=>setQuizForm({...quizForm,title:e.target.value})}/></label><label className="field"><span>Description</span><textarea rows="2" value={quizForm.description} onChange={e=>setQuizForm({...quizForm,description:e.target.value})}/></label><label className="field"><span>Score minimal (%)</span><input type="number" min="0" max="100" value={quizForm.passing_score} onChange={e=>setQuizForm({...quizForm,passing_score:e.target.value})}/></label><button className="btn btn-primary" disabled={busy}>Créer le quiz</button></form><div className="studio-list">{quizzes.map(q=><div className="studio-item" key={q.id}><div><b>{q.title}</b><small>Seuil de réussite : {q.passing_score}%</small></div><button className={`btn btn-sm ${q.is_published?'btn-soft':'btn-success'}`} onClick={()=>publishQuiz(q.id,!q.is_published)}>{q.is_published?'Masquer':'Publier'}</button></div>)}</div>
        {quizzes.length>0&&<form className="form-stack quiz-question-form" onSubmit={addQuestion}><h3>Ajouter une question QCM</h3><label className="field"><span>Quiz</span><select value={questionForm.quiz_id} onChange={e=>setQuestionForm({...questionForm,quiz_id:e.target.value})}><option value="">Choisir un quiz</option>{quizzes.map(q=><option key={q.id} value={q.id}>{q.title}</option>)}</select></label><label className="field"><span>Question</span><textarea rows="2" required value={questionForm.question_text} onChange={e=>setQuestionForm({...questionForm,question_text:e.target.value})}/></label>{questionForm.options.map((value,i)=><label className="field" key={i}><span>Réponse {i+1}</span><div className="option-row"><input required value={value} onChange={e=>setQuestionForm(x=>({...x,options:x.options.map((v,j)=>i===j?e.target.value:v)}))}/><input type="radio" name="correct-answer" checked={Number(questionForm.correct)===i} onChange={()=>setQuestionForm(x=>({...x,correct:i}))} aria-label={`Bonne réponse ${i+1}`}/></div></label>)}<small className="muted">Sélectionne la bonne réponse avec le bouton rond.</small><button className="btn btn-primary" disabled={busy||!questionForm.quiz_id}>Enregistrer la question</button></form>}
      </Panel>
    </div>}
  </main>;
}

function CoursePlayer({ listingId, session, role, notify, navigate }) {
  const [listing,setListing]=useState(null),[modules,setModules]=useState([]),[lessons,setLessons]=useState([]),[progress,setProgress]=useState([]),[quizzes,setQuizzes]=useState([]),[quizData,setQuizData]=useState(null),[answers,setAnswers]=useState({}),[result,setResult]=useState(null),[enrolled,setEnrolled]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    const [p,m,q,e]=await Promise.all([
      supabase.from('listings').select('id,title,description,subject,level,kind,price_xof,seller_id,status').eq('id',listingId).maybeSingle(),
      supabase.from('course_modules').select('*').eq('listing_id',listingId).order('sort_order'),
      supabase.from('quizzes').select('*').eq('listing_id',listingId).eq('is_published',true),
      session?supabase.from('enrollments').select('id,status').eq('listing_id',listingId).eq('learner_id',session.user.id).in('status',['active','completed']).maybeSingle():Promise.resolve({data:null,error:null})
    ]);
    if(p.error)notify(errorText(p.error),'error');else setListing(p.data);
    setEnrolled(Boolean(e.data));
    if(m.error)notify(errorText(m.error),'error');else{setModules(m.data||[]);const ids=(m.data||[]).map(x=>x.id);if(ids.length){const [l,pr]=await Promise.all([supabase.from('lessons').select('*').in('module_id',ids).eq('is_published',true).order('sort_order'),session?supabase.from('lesson_progress').select('*').eq('learner_id',session.user.id):Promise.resolve({data:[]})]);if(l.error)notify(errorText(l.error),'error');else setLessons(l.data||[]);if(pr.data)setProgress(pr.data);}else{setLessons([]);setProgress([]);}}
    if(q.data)setQuizzes(q.data);
    setLoading(false);
  },[listingId,session,notify]);
  useEffect(()=>{if(listingId)load();},[listingId,load]);
  async function joinFree(){if(!session){navigate('/connexion');return;}if(!listing||Number(listing.price_xof)>0)return;setBusy(true);const {error}=await supabase.rpc('enroll_free_listing',{p_listing_id:listingId});setBusy(false);if(error)notify(errorText(error),'error');else{notify('Inscription gratuite confirmée.','success');load();}}
  async function markComplete(lesson){if(!session){navigate('/connexion');return;}setBusy(true);const {error}=await supabase.rpc('save_lesson_progress',{p_lesson_id:lesson.id,p_watched_seconds:Math.max(0,Number(lesson.duration_minutes||0)*60),p_completed:true});setBusy(false);if(error)notify(errorText(error),'error');else{notify('Progression enregistrée.','success');load();}}
  async function startQuiz(quiz){if(!session){navigate('/connexion');return;}setResult(null);setAnswers({});const {data,error}=await supabase.from('quiz_questions').select('id,question_text,question_type,points,sort_order,options:quiz_options(id,option_text,sort_order)').eq('quiz_id',quiz.id).order('sort_order');if(error)notify(errorText(error),'error');else setQuizData({...quiz,questions:data||[]});}
  async function submitQuiz(e){e.preventDefault();if(!quizData)return;setBusy(true);const payload={quiz_id:quizData.id,answers:quizData.questions.map(q=>({question_id:q.id,selected_option_ids:answers[q.id]||[],text_answer:''}))};const {data,error}=await supabase.functions.invoke('savoir-quiz-submit',{body:payload});setBusy(false);if(error||data?.error){notify(data?.error||errorText(error),'error');return;}setResult(data);notify('Quiz corrigé et résultat enregistré.','success');}
  if(loading)return <main className="container page-main"><p className="muted">Chargement du cours…</p></main>;
  if(!listing)return <main className="container page-main"><EmptyState title="Ressource introuvable" text="Cette ressource n’est plus disponible ou n’a pas été publiée." action={<button className="btn btn-primary" onClick={()=>navigate('/explorer')}>Retour au catalogue</button>}/></main>;
  const completed=progress.filter(p=>p.completed).length;
  return <main className="container page-main workspace-page"><div className="dashboard-heading"><div><span className="eyebrow">{listing.subject} · {listing.level}</span><h1>{listing.title}</h1><p>{listing.description}</p></div><button className="btn btn-outline" onClick={()=>navigate('/bibliotheque')}>Ma bibliothèque</button></div>
    {!enrolled&&listing.seller_id!==session?.user?.id&&role!=='admin'&&<div className="notice payment-disabled">{Number(listing.price_xof)===0?<><span>Cette ressource est gratuite. Inscris-toi pour accéder aux modules et aux leçons.</span><button className="btn btn-primary btn-sm" disabled={busy} onClick={joinFree}>{busy?'Inscription…':'Rejoindre gratuitement'}</button></>:<span>Cette ressource est payante. L’accès sera activé après la configuration des paiements.</span>}</div>}
    <div className="course-progress-summary"><div><b>{completed}/{lessons.length}</b><span>Leçons terminées</span></div><div className="progress-track"><i style={{width:`${lessons.length?completed/lessons.length*100:0}%`}}/></div></div>
    {modules.length?modules.map(module=><Panel key={module.id} title={module.title} subtitle={module.description}><div className="lesson-list">{lessons.filter(l=>l.module_id===module.id).map(lesson=>{const done=progress.some(p=>p.lesson_id===lesson.id&&p.completed);return <article className="lesson-card" key={lesson.id}><div className="lesson-card-head"><div className="lesson-symbol"><BookOpen size={20}/></div><div><b>{lesson.title}</b><small>{lesson.duration_minutes?`${lesson.duration_minutes} min`:'Leçon'} {lesson.is_preview?'· Aperçu gratuit':''}</small></div><span className={`status-pill ${done?'approved':'pending'}`}>{done?'Terminée':'À faire'}</span></div>{lesson.content&&<div className="lesson-content">{lesson.content}</div>}{lesson.video_url&&<a className="text-button" href={lesson.video_url} target="_blank" rel="noreferrer"><Video size={15}/> Ouvrir la vidéo</a>}{session&&<button className="btn btn-soft btn-sm" disabled={busy||done} onClick={()=>markComplete(lesson)}>{done?'Leçon terminée': 'Marquer comme terminée'} <Check size={15}/></button>}</article>;})}{!lessons.some(l=>l.module_id===module.id)&&<p className="muted">Aucune leçon publiée dans ce module.</p>}</div></Panel>):<Panel title="Contenu en préparation"><EmptyState title="Le cours est en préparation" text="L’enseignant n’a pas encore publié de module ou de leçon."/></Panel>}
    {quizzes.length>0&&<Panel title="Quiz et évaluations" subtitle="Les réponses sont corrigées sur le serveur ; le corrigé n’est pas envoyé au navigateur."><div className="quiz-list">{quizzes.map(q=><div className="workspace-row" key={q.id}><div><b>{q.title}</b><small>Seuil de réussite : {q.passing_score}%</small></div><button className="btn btn-primary btn-sm" onClick={()=>startQuiz(q)}>Commencer le quiz</button></div>)}</div></Panel>}
    {quizData&&<Panel title={quizData.title} subtitle={quizData.description}><form className="form-stack" onSubmit={submitQuiz}>{quizData.questions.map((q,i)=><fieldset className="quiz-question" key={q.id}><legend>{i+1}. {q.question_text} <small>({q.points} point(s))</small></legend>{(q.options||[]).map(option=><label className="quiz-option" key={option.id}><input type="radio" name={`q-${q.id}`} checked={(answers[q.id]||[]).includes(option.id)} onChange={()=>setAnswers(x=>({...x,[q.id]:[option.id]}))}/>{option.option_text}</label>)}</fieldset>)}{result&&<div className="quiz-result"><b>{result.percentage}%</b><span>{result.passed?'Bravo, seuil atteint !':'Continue tes efforts.'}</span><small>{result.correct_count} bonne(s) réponse(s) sur {result.question_count}</small></div>}<div className="inline-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy?'Correction…':'Soumettre mes réponses'}</button><button type="button" className="btn btn-outline" onClick={()=>setQuizData(null)}>Fermer</button></div></form></Panel>}
    {listing.price_xof>0&&<div className="notice payment-disabled"><Wallet size={18}/>Cette ressource est payante. L’achat est suspendu pendant la phase de configuration des paiements.</div>}
  </main>;
}

function ParentChildProgress({ studentId, session, notify, navigate }) {
  const [student,setStudent]=useState(null),[enrollments,setEnrollments]=useState([]),[progress,setProgress]=useState([]),[loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;(async()=>{
    const [p,e,l]=await Promise.all([
      supabase.from('profiles').select('id,display_name,country,account_type').eq('id',studentId).maybeSingle(),
      supabase.from('enrollments').select('id,listing_id,status,listing:listings(id,title,subject,level)').eq('learner_id',studentId).in('status',['active','completed']),
      supabase.from('lesson_progress').select('id,completed,lesson:lessons!lesson_progress_lesson_id_fkey(title,module:course_modules!lessons_module_id_fkey(listing_id))').eq('learner_id',studentId)
    ]);
    if(!alive)return;
    if(p.error||e.error||l.error)notify(errorText(p.error||e.error||l.error),'error');
    setStudent(p.data);setEnrollments(e.data||[]);setProgress(l.data||[]);setLoading(false);
  })();return()=>{alive=false;};},[studentId,notify]);
  const completed=progress.filter(x=>x.completed).length;
  return <main className="container page-main workspace-page"><div className="dashboard-heading"><div><span className="eyebrow">ESPACE FAMILLE</span><h1>Suivi de {student?.display_name||'l’apprenant'}</h1><p>Progression des ressources et leçons consultées.</p></div><button className="btn btn-outline" onClick={()=>navigate('/parents')}>Retour</button></div>
    {loading?<p className="muted">Chargement du suivi…</p>:!student?<EmptyState title="Suivi indisponible" text="Vérifie que l’apprenant a accepté ta demande de liaison."/>:<><div className="workspace-stats"><Stat label="Ressources suivies" value={enrollments.length} detail="Inscriptions actives" icon={Library}/><Stat label="Leçons terminées" value={completed} detail="Progression enregistrée" icon={CheckCircle2}/></div><Panel title="Ressources de l’apprenant">{enrollments.length?enrollments.map(e=><div className="workspace-row" key={e.id}><div><b>{e.listing?.title||'Ressource'}</b><small>{e.listing?.subject} · {e.listing?.level}</small></div><span className={`status-pill ${e.status}`}>{e.status==='completed'?'Terminée':'En cours'}</span><span>{progress.filter(p=>p.lesson?.module?.listing_id===e.listing_id&&p.completed).length} leçon(s) terminée(s)</span></div>):<p className="muted">Aucune ressource suivie pour le moment.</p>}</Panel></>}
  </main>;
}

function MessagesPage({ session, profile, role, notify }) {
  const [contacts,setContacts]=useState([]),[conversations,setConversations]=useState([]),[active,setActive]=useState(null),[messages,setMessages]=useState([]),[body,setBody]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    const [c,p]=await Promise.all([
      supabase.from('conversations').select('id,participant_one,participant_two,last_message_at').or(`participant_one.eq.${session.user.id},participant_two.eq.${session.user.id}`).order('last_message_at',{ascending:false}),
      supabase.from('profiles').select('id,display_name,account_type,country').neq('id',session.user.id).in('account_type',role==='teacher'?['student','parent']:['teacher']).order('display_name').limit(100)
    ]);
    if(c.error)notify(errorText(c.error),'error');else setConversations(c.data||[]);
    if(p.data)setContacts(p.data);
    setLoading(false);
  },[session,role,notify]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('to');if(requested&&contacts.length){const contact=contacts.find(c=>c.id===requested);if(contact)openContact(contact);}},[contacts]);
  const activeConversation=conversations.find(c=>c.id===active);
  const otherId=activeConversation?(activeConversation.participant_one===session.user.id?activeConversation.participant_two:activeConversation.participant_one):null;
  const otherContact=contacts.find(c=>c.id===otherId);
  const loadMessages=useCallback(async()=>{if(!active)return;const {data,error}=await supabase.from('messages').select('*').eq('conversation_id',active).order('created_at');if(error)notify(errorText(error),'error');else setMessages(data||[]);await supabase.from('messages').update({read_at:new Date().toISOString()}).eq('conversation_id',active).eq('recipient_id',session.user.id).is('read_at',null);},[active,session,notify]);
  useEffect(()=>{loadMessages();},[loadMessages]);
  async function openContact(contact){setBusy(true);const {data,error}=await supabase.rpc('get_or_create_conversation',{p_other_user_id:contact.id});setBusy(false);if(error){notify(errorText(error),'error');return;}await load();setActive(data);}
  async function send(e){e.preventDefault();if(!body.trim()||!active||!otherId)return;setBusy(true);const {error}=await supabase.from('messages').insert({conversation_id:active,sender_id:session.user.id,recipient_id:otherId,body:body.trim()});setBusy(false);if(error)notify(errorText(error),'error');else{setBody('');loadMessages();load();}}
  return <main className="container page-main workspace-page"><div className="page-intro"><span className="eyebrow">MESSAGERIE ENCADRÉE</span><h1>Mes conversations</h1><p>Échange avec tes enseignants ou tes apprenants dans un espace contrôlé.</p></div><div className="messaging-layout"><aside className="panel conversations-panel"><div className="panel-heading"><h2>Contacts</h2></div>{loading?<p className="muted">Chargement…</p>:contacts.length?contacts.map(c=><button className="contact-option" key={c.id} onClick={()=>openContact(c)} disabled={busy}><span className="avatar">{initials(c.display_name)}</span><span><b>{c.display_name||'Utilisateur'}</b><small>{c.account_type==='teacher'?'Enseignant':c.account_type==='parent'?'Parent':'Apprenant'}</small></span></button>):<p className="muted">Aucun contact disponible pour ton profil.</p>}<div className="panel-heading"><h3>Conversations</h3></div>{conversations.map(c=><button key={c.id} className={`contact-option ${active===c.id?'selected':''}`} onClick={()=>setActive(c.id)}><MessageCircle size={18}/><span><b>Conversation</b><small>{dateLabel(c.last_message_at)}</small></span></button>)}</aside><section className="panel chat-panel"><div className="panel-heading"><h2>{otherContact?.display_name||'Conversation'}</h2>{active&&<span className="status-pill approved">Privée</span>}</div>{active?<><div className="message-list">{messages.map(m=><div key={m.id} className={`message-bubble ${m.sender_id===session.user.id?'mine':''}`}><p>{m.body}</p><time>{new Date(m.created_at).toLocaleString('fr-FR')}</time></div>)}{!messages.length&&<p className="muted">La conversation commence ici.</p>}</div><form className="message-compose" onSubmit={send}><textarea rows="2" maxLength="5000" value={body} onChange={e=>setBody(e.target.value)} placeholder="Écris ton message…"/><button className="btn btn-primary" disabled={busy||!body.trim()}><Send size={16}/> Envoyer</button></form></>:<EmptyState title="Choisis un contact" text="Les échanges sont accessibles uniquement aux deux participants et peuvent être signalés."/>}</section></div></main>;
}

function TeachersDirectory({ navigate }) {
  const [teachers,setTeachers]=useState([]),[loading,setLoading]=useState(true);
  useEffect(()=>{supabase.from('profiles').select('id,display_name,bio,avatar_url,country,teacher_profiles(headline,subjects,levels,experience_years,city,verified_at)').eq('account_type','teacher').order('created_at',{ascending:false}).limit(60).then(({data,error})=>{if(error)console.error(error);setTeachers(data||[]);setLoading(false);});},[]);
  return <main className="container page-main workspace-page"><div className="page-intro"><span className="eyebrow">COMMUNAUTÉ ÉDUCATIVE</span><h1>Rencontrer les enseignants</h1><p>Découvre les créateurs de ressources et leurs domaines d’expertise.</p></div>{loading?<p className="muted">Chargement des profils…</p>:teachers.length?<div className="teacher-grid">{teachers.map(t=>{const meta=t.teacher_profiles?.[0]||t.teacher_profiles||{};return <article className="teacher-card" key={t.id}><div className="teacher-avatar-large">{initials(t.display_name)}</div><div className="teacher-card-body"><h3>{t.display_name||'Enseignant SAVOIR+'} {meta.verified_at&&<BadgeCheck size={17}/>}</h3><p>{meta.headline||t.bio||'Enseignant et créateur de ressources pédagogiques.'}</p><small>{meta.city||t.country||'Localisation non renseignée'}</small><div className="teacher-tags">{(meta.subjects||[]).slice(0,3).map(x=><span key={x}>{x}</span>)}</div><button className="btn btn-outline btn-sm" onClick={()=>navigate(`/messages?to=${t.id}`)}>Contacter <MessageCircle size={15}/></button></div></article>;})}</div>:<EmptyState title="Les premiers enseignants arrivent" text="Les profils apparaîtront ici dès leur inscription et la création de leur profil enseignant."/>}</main>;
}

function TeacherProfileEditor({ session, profile, notify, navigate }) {
  const [form,setForm]=useState({headline:'',subjects:'',levels:'',experience_years:'0',city:'',store_name:'',store_description:'',all_subjects:false,all_levels:false});
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  useEffect(()=>{supabase.from('teacher_profiles').select('*').eq('user_id',session.user.id).maybeSingle().then(({data,error})=>{if(error)notify(errorText(error),'error');if(data)setForm({headline:data.headline||'',subjects:(data.subjects||[]).join(', '),levels:(data.levels||[]).join(', '),experience_years:String(data.experience_years||0),city:data.city||'',store_name:data.store_name||'',store_description:data.store_description||'',all_subjects:!!data.all_subjects,all_levels:!!data.all_levels});setLoading(false);});},[session,notify]);
  async function save(e){e.preventDefault();setBusy(true);const {error}=await supabase.from('teacher_profiles').upsert({user_id:session.user.id,headline:form.headline,subjects:form.all_subjects?['Toutes les matières']:form.subjects.split(',').map(x=>x.trim()).filter(Boolean),levels:form.all_levels?['Tous niveaux']:form.levels.split(',').map(x=>x.trim()).filter(Boolean),experience_years:Number(form.experience_years),city:form.city,store_name:form.store_name,store_description:form.store_description,all_subjects:form.all_subjects,all_levels:form.all_levels},{onConflict:'user_id'});setBusy(false);if(error)notify(errorText(error),'error');else notify('Profil enseignant mis à jour.','success');}
  if(profile?.account_type!=='teacher')return <main className="container page-main"><EmptyState title="Compte enseignant requis" text="Cette page est réservée aux enseignants." action={<button className="btn btn-primary" onClick={()=>navigate('/devenir-enseignant')}>Créer un compte enseignant</button>}/></main>;
  return <main className="container page-main workspace-page"><div className="page-intro"><span className="eyebrow">PROFIL PUBLIC</span><h1>Présenter mon expertise</h1><p>Ces informations aideront les apprenants à connaître ton parcours pédagogique.</p></div><Panel title="Ma boutique et mon expertise"><form className="form-stack" onSubmit={save}><label className="field"><span>Nom de ma boutique</span><input required maxLength={100} value={form.store_name} onChange={e=>setForm({...form,store_name:e.target.value})} placeholder="Ex. La boutique des sciences"/></label><label className="field"><span>Ce que je vends / présentation de la boutique</span><textarea required rows="3" maxLength={1200} value={form.store_description} onChange={e=>setForm({...form,store_description:e.target.value})} placeholder="Fiches, exercices corrigés, vidéos, formations…"/></label><label className="field"><span>Présentation de mon expertise</span><input maxLength={180} value={form.headline} onChange={e=>setForm({...form,headline:e.target.value})} placeholder="Ex. Enseignant en sciences au secondaire"/></label><label className="field"><span>Matières enseignées (séparées par des virgules)</span><input disabled={form.all_subjects} value={form.subjects} onChange={e=>setForm({...form,subjects:e.target.value})} placeholder="Mathématiques, Physique, Informatique"/></label><label className="check-line"><input type="checkbox" checked={form.all_subjects} onChange={e=>setForm({...form,all_subjects:e.target.checked})}/> Toutes les matières</label><label className="field"><span>Niveaux (séparés par des virgules)</span><input disabled={form.all_levels} value={form.levels} onChange={e=>setForm({...form,levels:e.target.value})} placeholder="CM2, 6e, 3e, Terminale"/></label><label className="check-line"><input type="checkbox" checked={form.all_levels} onChange={e=>setForm({...form,all_levels:e.target.checked})}/> Tous les niveaux</label><div className="two-fields"><label className="field"><span>Années d’expérience</span><input type="number" min="0" max="60" value={form.experience_years} onChange={e=>setForm({...form,experience_years:e.target.value})}/></label><label className="field"><span>Ville</span><input maxLength={100} value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label></div><button className="btn btn-primary" disabled={busy||loading}>{busy?'Enregistrement…':'Enregistrer mon profil'}</button></form></Panel></main>;
}
