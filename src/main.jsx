import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('Application render error:', error); }
  render() {
    if (this.state.error) return <main style={{maxWidth:720,margin:'12vh auto',padding:24,color:'#e9eef8',fontFamily:'system-ui'}}>
      <h1>Jémor Digital House</h1>
      <p>Une erreur empêche le chargement de la page. Recharge le site dans quelques instants.</p>
      <button onClick={() => location.reload()} style={{padding:'12px 18px',borderRadius:8}}>Recharger</button>
    </main>;
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    createRoot(rootElement).render(<AppErrorBoundary><App /></AppErrorBoundary>);
  } catch (error) {
    console.error('Application startup error:', error);
    rootElement.innerHTML = '<main style="max-width:720px;margin:12vh auto;padding:24px;color:#e9eef8;font-family:system-ui"><h1>Jémor Digital House</h1><p>Le site rencontre un problème au démarrage. Recharge la page dans quelques instants.</p></main>';
  }
}
