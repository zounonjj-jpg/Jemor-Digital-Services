# État de l'implémentation SAVOIR+

## Infrastructure
- Supabase `xzvseylpaiezoezdzdbv` : 32 tables publiques, 76 politiques RLS, RLS active sur les 32 tables.
- Security Advisor : aucun lint de sécurité au dernier contrôle.
- Bucket `savoir-products` privé.
- Edge Functions actives : `savoir-product-download` v3 et `savoir-quiz-submit` v1.
- Vercel `savoir-plus-app`, déploiement de production `READY`. Le build Vite a transformé 1 638 modules et généré `dist/`.
- GitHub source isolée : `SAVOIR_PLUS/parts/` ; le projet Jémor Digital House à la racine n'a pas été remplacé.

## Parcours disponibles sans paiement
- Comptes élève, parent et enseignant ; profils et récupération du mot de passe.
- Marketplace, recherche/filtres, favoris, ressources, upload privé et modération.
- Modules, leçons, progression, quiz, inscriptions aux ressources gratuites.
- Lien parent/élève consenti, messagerie, notifications et signalements.
- Dashboard enseignant et dashboard administrateur.
- Paiements et retraits explicitement désactivés.

## Avant l'ouverture réelle
- Aucun compte utilisateur n'existe encore dans Supabase Auth. Créer le compte propriétaire avec le formulaire normal, vérifier son e-mail, puis lui attribuer `app_metadata.role = 'savoir_admin'`.
- Configurer les URLs de site/redirection et modèles d'e-mail dans Supabase Auth.
- Tester les parcours avec trois comptes distincts et les refus d'accès croisés.
- Vérifier les uploads, téléchargements, quiz, messagerie, notifications et modération depuis un navigateur utilisateur.

Le build de production est réussi, mais les parcours de bout en bout avec de vrais comptes restent à valider avant de déclarer la plateforme prête pour l'ouverture publique complète.


## Refonte des parcours (1 novembre 2026)
- Landing page orientée conversion avec quatre entrées explicites : Élève, Étudiant, Parent, Créateur.
- Inscription en deux étapes avec informations scolaires/universitaires, classe de l'enfant, ou informations de boutique.
- Tableaux de bord séparés pour apprenants, parents et créateurs.
- Publication des ressources créateur automatique : statut `approved` imposé à la création ; le vendeur ne peut pas modifier lui-même le statut.
- Annuaire d'administration séparé dans le schéma privé, accessible uniquement aux administrateurs, avec e-mails et données de profil.
- Vue admin des commandes, acheteurs, créateurs, ventes confirmées et soldes issus du ledger.
- RPC `promote_savoir_admin` : autorise la nomination uniquement au compte portant le claim protégé `app_metadata.is_platform_owner=true`.
- RPC `get_teacher_customers` : retourne au créateur uniquement les acheteurs de ses produits dont la commande est réellement payée.
- Les paiements restent suspendus : aucune vente ni aucun solde fictif n'est généré. Les clients et ventes apparaîtront après activation réelle des paiements.
- RLS reste activée sur les tables publiques ; l'annuaire d'e-mails est protégé par RLS dans le schéma privé.
