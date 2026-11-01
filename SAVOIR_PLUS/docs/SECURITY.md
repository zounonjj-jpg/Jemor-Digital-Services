# Sécurité et modèle de confiance

- Les rôles privilégiés sont lus depuis `auth.jwt()->'app_metadata'`, jamais depuis `user_metadata`.
- Les 32 tables publiques ont RLS activée. Les autorisations sont contrôlées par l'identité authentifiée et les relations réelles.
- Les fonctions privilégiées `SECURITY DEFINER` sont rangées dans le schéma non exposé `private`; les wrappers publics sont `SECURITY INVOKER`.
- Les corrigés des quiz ne sont pas lisibles par les apprenants. La correction est effectuée côté Edge Function.
- Les fichiers sont dans le bucket privé `savoir-products`; les liens de téléchargement expirent après 60 secondes.
- Le téléchargement vérifie l'identité, la publication et le propriétaire, l'administrateur ou l'inscription/commande reconnue.
- Les paiements et retraits restent bloqués jusqu'à intégration d'un prestataire et vérification de ses webhooks.
- Ne jamais mettre la clé `service_role` dans Vite, dans GitHub ou dans le navigateur.

Avant l'ouverture, tester RLS en comptes séparés, les flux Auth, les uploads privés, le téléchargement, la messagerie et la gestion de compte.
