# Jémor Digital House

Starter React + Vite + Supabase pour le site commercial et le mini espace administrateur.

## Configuration
1. Copier `.env.example` vers `.env` pour un test local.
2. Vérifier `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Remplacer `VITE_WHATSAPP_NUMBER` par le numéro WhatsApp au format international sans `+`, par exemple `229XXXXXXXX`.
4. `npm install`, puis `npm run dev`.
5. Pour publier : importer le dépôt GitHub dans Vercel et ajouter les mêmes variables dans Project Settings > Environment Variables.

## Administration
- Le lien Administration est en bas du site, à `/admin`.
- Créer d'abord un utilisateur dans Supabase Authentication.
- Après avoir vérifié l'adresse e-mail, attribuer le rôle administrateur dans Supabase SQL Editor :

  ```sql
  update auth.users
  set raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'agency_admin')
  where email = 'TON_EMAIL_ADMIN';
  ```

- Déconnecter puis reconnecter le compte pour obtenir le nouveau JWT.
- Les règles RLS n'autorisent la lecture et la modification des prospects qu'aux utilisateurs ayant ce rôle dans `app_metadata`.

## Sécurité
- Ne jamais mettre une clé `service_role` ou un secret Supabase dans le frontend.
- La clé `sb_publishable_...` est conçue pour être utilisée côté navigateur ; la sécurité repose sur les politiques RLS.
- Le formulaire public peut créer une demande, mais ne peut pas lire les demandes.
- Les prix sont des prix de départ indicatifs ; confirmer le périmètre et le devis avec chaque client.

## Tables Supabase déjà préparées
- `public.agency_services`
- `public.agency_leads`
