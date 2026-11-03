# SAVOIR+ — Configuration SasPay

## État

Le circuit technique de paiement SasPay est préparé et les Edge Functions sont déployées dans Supabase. Les paiements réels restent désactivés tant que les secrets SasPay et le webhook ne sont pas configurés et testés.

Le paiement utilise une session de checkout hébergée par SasPay, créée pour chaque commande. Le lien stable que le créateur partage est le lien SAVOIR+ de prévisualisation/paiement. Le lien de checkout SasPay est généré après connexion du client et création de sa commande.

## Secrets Supabase requis

Ajouter ces secrets dans le tableau de bord Supabase du projet SEM, section Edge Functions / Secrets :

- `SASPAY_API_KEY` : clé API SasPay avec le scope PAYIN ou BOTH.
- `SASPAY_WEBHOOK_SECRET` : secret de signature révélé lors de la création ou de la rotation du webhook SasPay.

Ne jamais mettre ces valeurs dans GitHub, dans le code client, dans Vercel public env vars ou dans un message/chat.

Les variables Supabase standards `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont utilisées par les Edge Functions via l'environnement Supabase.

## Edge Functions déployées

- `savoir-create-checkout` — exige un JWT valide ; crée/réutilise une commande, réserve une tentative unique et demande une session hébergée SasPay.
- `savoir-saspay-webhook` — reçoit les événements SasPay, valide la signature HMAC-SHA256 sur le corps brut et l'horodatage, puis vérifie la transaction auprès de SasPay avant toute livraison.
- `savoir-payment-status` — exige un JWT valide ; permet à l'acheteur de vérifier le statut de sa propre commande après le retour du checkout.

## URL webhook à enregistrer dans SasPay

`https://xzvseylpaiezoezdzdbv.supabase.co/functions/v1/savoir-saspay-webhook`

Événements à souscrire :

- `transaction.success`
- `transaction.failed`
- `transaction.cancelled`

Après création, copier immédiatement le secret de signature affiché par SasPay et l'enregistrer dans Supabase sous `SASPAY_WEBHOOK_SECRET`. SasPay n'affiche le secret qu'à la création ou à sa rotation.

## Vérification et sécurité

La fonction webhook :

- vérifie `X-Webhook-Signature` sur `timestamp + "." + rawBody`, HMAC-SHA256 ;
- rejette les horodatages à plus de 5 minutes de l'heure serveur ;
- compare les signatures sans comparaison textuelle directe ;
- appelle l'endpoint SasPay de vérification et n'accorde l'accès que si le statut vérifié est `SUCCESS` ;
- vérifie la devise XOF et le montant demandé par rapport à la commande locale ;
- traite les événements de manière idempotente et protège le crédit du portefeuille/registre.

L'endpoint de session de checkout hébergée ne prend pas en charge `Idempotency-Key` selon la documentation technique examinée. En cas de délai réseau ou de résultat incertain, le serveur bloque une nouvelle création automatique de session afin d'éviter une deuxième collecte. Une vérification manuelle peut alors être nécessaire.

Le retour navigateur n'est jamais une preuve de paiement. Les produits payants ne doivent être délivrés que par le traitement serveur après confirmation SasPay.

## Limites avant le lancement réel

1. Confirmer dans le compte SasPay si la clé utilisée est Sandbox ou Production. La documentation examinée indique la même base URL pour les deux modes et ne décrit pas clairement comment le compte sélectionne l'environnement.
2. Effectuer les tests Sandbox avec des paiements réussis, échoués, annulés, des timeouts et des webhooks rejoués.
3. Confirmer comment les commissions réseau SasPay sont appliquées (ajout au montant payé ou déduction du montant marchand) et qui supporte ces frais. Le calcul comptable 10 % / 90 % est préparé sur le prix du produit ; il ne doit pas déclencher des retraits réels avant que les montants nets soient rapprochés.
4. Confirmer les règles de règlement et le compte qui reçoit les fonds. Les CGU SasPay publiées indiquent que SasPay agit comme couche technique, n'est pas PSP/agrégateur et ne détient pas les fonds ; les prestataires tiers traitent les paiements.
5. Ne pas activer les retraits aux créateurs avant validation de l'API de payout, de son activation sur le compte marchand, de la whitelist IP requise et des tests de paiement sortant.

## Reversements créateurs

6. Clarifier la politique de frais : pour préserver 10 % de commission SAVOIR+ et 90 % pour le vendeur, SasPay doit confirmer si les frais de paiement peuvent être ajoutés au montant payé par le client (mode ADD_ON) ou s'ils sont prélevés sur le montant marchand. Ne pas faire de versements créateurs à partir des soldes bruts tant que cette règle n'est pas validée.
7. Les Edge Functions Supabase n'ont pas d'adresse IP sortante statique garantie. SasPay indique que l'API de payout avec clé API exige une IP autorisée. Sans solution d'egress statique (proxy/serveur avec IP fixe) ou alternative acceptée par SasPay, les reversements automatiques depuis Supabase Edge ne doivent pas être activés. En mode zéro budget, les retraits devront rester manuels via le tableau de bord SasPay au lancement, avec rapprochement administratif.


Le portefeuille SAVOIR+ et le registre de commission sont comptables. Ils ne transfèrent pas d'argent à eux seuls.

La documentation consultée décrit un endpoint de payout, mais indique également que les payouts doivent être activés par SasPay et que l'adresse IP serveur doit être autorisée. La fonctionnalité de payout n'a pas été considérée comme testée/confirmée pour le lancement. Aucun virement automatique aux créateurs n'est activé dans ce code à ce stade.
