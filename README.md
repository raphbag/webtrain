
# WebTrain

Petit projet personnel montrant une intégration de Google Maps API et la récupération de données de transport via l'API d'Ile-de-France Mobilités. Le site est construit avec Astro et stylé avec Tailwind CSS.

## Architecture

L'application utilise une architecture serveur-client avec Astro en mode SSR (Server-Side Rendering) et Cloudflare Workers :

- **Frontend** : Google Maps API pour l'affichage cartographique
- **Backend** : Endpoints API côté serveur pour sécuriser les appels aux APIs IDFM
- **Déploiement** : Cloudflare Workers/Pages

### Endpoints API

- `/lignes.json` - Récupération des tracés du réseau ferré IDF
- `/gares.json` - Récupération des emplacements des gares
- `/horaires.json` - Récupération des horaires en temps réel (stop-monitoring)
- `/perturbations.json` - Récupération des perturbations de ligne


Prérequis

- Node.js (18+ recommandé)

Installation

```bat
> npm install
```

Build et preview local

```bat
> npm run build
> npm run preview
```

Build et preview Cloudflare

```bat
> npx astro build
> npx wrangler versions upload
```

Build et production Cloudflare

```bat
> npx astro build
> npx wrangler@latest deploy
```

## Variables d'environnement

Créer un fichier `.env` à la racine avec :

```
PUBLIC_GOOGLE_MAPS_API_KEY=votre_cle_google_maps
IDFM_API_KEY=votre_clé_api_idfm
```
