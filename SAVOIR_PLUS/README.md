# SAVOIR+

Plateforme éducative pour les enseignants du primaire et du secondaire, les élèves et les parents.
**« Votre savoir a plus de valeur. »**

## Application publiée
- Production Vercel : https://savoir-plus-app.vercel.app
- Projet Vercel : `savoir-plus-app` (racine `SAVOIR_PLUS`).
- Supabase : projet `SEM`, ref `xzvseylpaiezoezdzdbv`.
- Source applicative complète : fragments compressés sous `parts/`. Ils sont concaténés dans l'ordre lexicographique, puis décodés et extraits.

## Reconstruction locale
Depuis ce dossier :
```bash
cat parts/*.b64 | base64 -d | tar -xz
cd SAVOIR_PLUS
npm install
npm run dev
```

Sur Vercel, la commande d'installation configurée reconstitue automatiquement le dossier source avant `npm install`, puis `npm run build`.

## Parcours par profil
- Landing page qui présente séparément les parcours Élève, Étudiant, Parent et Créateur.
- Inscription en deux étapes : choix du profil, puis formulaire adapté (classe, année universitaire/filière, classe de l'enfant ou boutique du créateur).
- Comptes élèves, étudiants, parents et créateurs avec tableaux de bord distincts.
- Boutique créateur avec matières et niveaux de spécialisation, publications automatiques sans validation préalable.
- Chaque créateur dispose d'une boutique publique dédiée, accessible depuis l'annuaire des créateurs et son tableau de bord.
- Administration : annuaire protégé des utilisateurs avec e-mails, profils, ventes et soldes réels.
- Les données personnelles de scolarité, année de naissance, téléphone et ville sont stockées dans le schéma privé et lisibles uniquement par leur propriétaire ou l’administration.
- Seul le propriétaire de la plateforme (claim `app_metadata.is_platform_owner=true`) peut nommer un administrateur ; un administrateur nommé ne peut pas en nommer un autre.

## Fonctionnalités disponibles sans paiement
- Marketplace, recherche/filtres, favoris, ressources, upload privé et accès aux ressources gratuites.
- Cours en modules/leçons, inscriptions gratuites, progression et quiz corrigés côté serveur.
- Liaison parent/élève, messagerie, notifications, favoris et signalements.
- Espace administrateur : utilisateurs, modération, catégories, inscriptions, statistiques, rapports et journal d'actions.
- Stockage privé et téléchargements temporaires contrôlés par serveur.

## Paiements suspendus
Le checkout, les commandes réelles, les soldes, les commissions et les retraits restent désactivés jusqu'à la configuration du prestataire et des webhooks. Aucun faux paiement ni faux solde n'est affiché.

## Premier administrateur
Créer un compte normal dans l'application, confirmer son adresse e-mail, puis attribuer `app_metadata.role = 'savoir_admin'` dans Supabase. Le rôle administrateur ne doit jamais être placé dans `user_metadata` ni modifiable depuis le navigateur.

Voir `docs/IMPLEMENTATION_STATUS.md` et `docs/SECURITY.md`.
