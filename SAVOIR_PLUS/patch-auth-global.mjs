import fs from "node:fs";

const appPath = "src/App.jsx";
const cssPath = "src/styles.css";
let app = fs.readFileSync(appPath, "utf8");

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Patch ${label}: expected 1 match, found ${count}`);
  return source.replace(before, after);
}

app = replaceOnce(
  app,
  "ArrowRight, BookOpen, GraduationCap, Search, Menu, X, UserRound, LogOut,",
  "ArrowRight, BookOpen, GraduationCap, Search, Menu, X, UserRound, LogOut, EyeOff,",
  "EyeOff import"
);
app = replaceOnce(
  app,
  "const [busy,setBusy]=useState(false),[mobileOpen,setMobileOpen]=useState(false),[authMode,setAuthMode]=useState('login');",
  "const [busy,setBusy]=useState(false),[mobileOpen,setMobileOpen]=useState(false),[authMode,setAuthMode]=useState('login'),[showPassword,setShowPassword]=useState(false);",
  "password visibility state"
);
app = replaceOnce(
  app,
  "const [auth,setAuth]=useState({name:'',email:'',password:'',role:'student',country:'Bénin',city:'',phone:''});",
  "const [auth,setAuth]=useState({name:'',email:'',password:'',role:'student',country:'',city:'',phone:''});",
  "global country default"
);
app = replaceOnce(
  app,
  "country:auth.country,city:auth.city,phone:auth.phone",
  "country:auth.country.trim()||'Non précisé',city:auth.city,phone:auth.phone",
  "optional country metadata"
);
app = replaceOnce(
  app,
  "<Button kind=\"btn-primary btn-sm\" onClick={()=>navigate('/connexion')}>Connexion <ArrowRight size={16}/></Button>",
  "<><Button kind=\"btn-outline btn-sm\" onClick={()=>{setAuthMode('signup');navigate('/connexion');}}>S’inscrire</Button><Button kind=\"btn-primary btn-sm\" onClick={()=>{setAuthMode('login');navigate('/connexion');}}>Connexion <ArrowRight size={16}/></Button></>",
  "separate header signup and login"
);
app = replaceOnce(
  app,
  "<button className={authMode==='login'?'selected':''} onClick={()=>setAuthMode('login')}>Connexion</button><button className={authMode==='signup'?'selected':''} onClick={()=>setAuthMode('signup')}>Créer un compte</button>",
  "<button className={authMode==='login'?'selected':''} onClick={()=>{setAuthMode('login');setShowPassword(false);}}>Connexion</button><button className={authMode==='signup'?'selected':''} onClick={()=>{setAuthMode('signup');setShowPassword(false);}}>S’inscrire</button>",
  "auth tabs"
);
app = replaceOnce(
  app,
  "<Field label=\"Pays\"><input value={auth.country} onChange={e=>setAuth({...auth,country:e.target.value})}/></Field>",
  "<Field label=\"Pays\" hint=\"SAVOIR+ est ouvert aux utilisateurs de tous les pays.\"><input autoComplete=\"country-name\" value={auth.country} onChange={e=>setAuth({...auth,country:e.target.value})} placeholder=\"Ex. Bénin, France, Canada…\"/></Field>",
  "international country input"
);
app = replaceOnce(
  app,
  "<Field label=\"Mot de passe\"><input required type=\"password\" minLength=\"8\" autoComplete={authMode==='login'?'current-password':'new-password'} value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})} placeholder=\"8 caractères minimum\"/></Field>",
  "<Field label=\"Mot de passe\"><div className=\"password-control\"><input required type={showPassword?\"text\":\"password\"} minLength=\"8\" autoComplete={authMode==='login'?'current-password':'new-password'} value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})} placeholder=\"8 caractères minimum\"/><button type=\"button\" className=\"password-visibility\" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?\"Masquer le mot de passe\":\"Afficher le mot de passe\"} aria-pressed={showPassword}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></Field>",
  "password visibility"
);
app = replaceOnce(
  app,
  "<Field label=\"Nouveau mot de passe\"><input required type=\"password\" minLength=\"8\" autoComplete=\"new-password\" value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})} placeholder=\"8 caractères minimum\"/></Field>",
  "<Field label=\"Nouveau mot de passe\"><div className=\"password-control\"><input required type={showPassword?\"text\":\"password\"} minLength=\"8\" autoComplete=\"new-password\" value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})} placeholder=\"8 caractères minimum\"/><button type=\"button\" className=\"password-visibility\" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?\"Masquer le mot de passe\":\"Afficher le mot de passe\"} aria-pressed={showPassword}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></Field>",
  "recovery password visibility"
);
app = replaceOnce(app, "<span>Plateforme éducative · Bénin</span>", "<span>Plateforme éducative · Ouverte à l’international</span>", "international footer");
fs.writeFileSync(appPath, app);

let css = fs.readFileSync(cssPath, "utf8");
if (!css.includes(".password-control{")) {
  css += "\n/* Accessible password visibility control */\n.password-control{position:relative;display:flex;align-items:center}.password-control input{width:100%;padding-right:48px!important}.password-visibility{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:9px;background:transparent;color:#61718b;cursor:pointer}.password-visibility:hover{background:#edf2ff;color:var(--blue)}.password-visibility:focus-visible{outline:2px solid var(--blue);outline-offset:2px}\n";
  fs.writeFileSync(cssPath, css);
}
console.log("SAVOIR+ auth, password visibility and international registration patch applied.");

fs.mkdirSync('public',{recursive:true});
fs.copyFileSync(appPath,'public/_inspect-app-source.txt');
fs.copyFileSync(cssPath,'public/_inspect-app-styles.txt');

fs.copyFileSync('src/Workspace.jsx','public/_inspect-workspace-source.txt');

fs.copyFileSync('overrides/App.jsx', 'src/App.jsx');
fs.copyFileSync('overrides/Workspace.jsx', 'src/Workspace.jsx');
fs.copyFileSync('overrides/styles.css', 'src/styles.css');
console.log('SAVOIR+ audience landing, role-based onboarding, creator shop and owner-only admin promotion applied.');
