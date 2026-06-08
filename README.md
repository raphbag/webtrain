
# WebTrain

Petit projet personnel montrant une intégration de Google Maps API et la récupération de données de transport via des sources IDFM, SNCF Navitia et SIRI Lite. Le site est construit avec Astro et stylé avec Tailwind CSS.

## Architecture

L'application utilise une architecture serveur-client avec Astro en mode SSR (Server-Side Rendering) et Cloudflare Workers :

- **Frontend** : Google Maps API pour l'affichage cartographique, avec un filtrage personnalisé séparant les modes de transport (Métro, RER, Transilien, Grandes lignes, Tram, etc.). L'UI offre des info-bulles séparant les Départs et les Arrivées.
- **Backend** : Endpoints API côté serveur pour sécuriser les appels aux APIs IDFM et SNCF, filtrer/nettoyer les données (ex. retrait des doublons IDFM/SNCF) et gérer la pagination.
- **Déploiement** : Cloudflare Workers/Pages

### Endpoints API

Le projet structure ses endpoints API en deux dossiers distincts pour plus de clarté :

**IDFM (`/api/idfm/`)**
- `/api/idfm/lignes.json` - Tracés du réseau ferré d'Île-de-France
- `/api/idfm/gares.json` - Emplacements des gares d'Île-de-France
- `/api/idfm/horaires.json` - Horaires en temps réel via l'API PRIM (stop-monitoring)
- `/api/idfm/perturbations.json` - Perturbations de lignes via l'API PRIM (line-reports)

**SNCF (`/api/sncf/`)**
- `/api/sncf/lignes.json` - Tracés des lignes du réseau ferré national (Open Data SNCF)
- `/api/sncf/gares.json` - Emplacements des gares nationales (SNCF Navitia avec pagination)
- `/api/sncf/horaires.json` - Horaires temps réel SNCF via proxy transport.data.gouv.fr (SIRI Lite)
- `/api/sncf/perturbations.json` - Perturbations SNCF via l'API SNCF Navitia


Prérequis

- Node.js (18+ recommandé)

Installation

```bat
npm install
```

Build et preview local

```bat
npm run build
npm run preview
```

Build et preview Cloudflare

```bat
npx astro build
npx wrangler versions upload
```

Build et production Cloudflare

```bat
npx astro build
npx wrangler@latest deploy
```

## Variables d'environnement

Créer un fichier `.env` à la racine pour le développement local avec :

```
PUBLIC_GOOGLE_MAPS_API_KEY=votre_cle_google_maps
IDFM_API_KEY=votre_clé_api_idfm
SNCF_API_USERNAME=votre_username_sncf
SNCF_API_PASSWORD=
```

Pour la production il faut les définir avec :
```bat
wrangler secret put PUBLIC_GOOGLE_MAPS_API_KEY
wrangler secret put IDFM_API_KEY
wrangler secret put SNCF_API_USERNAME
wrangler secret put SNCF_API_PASSWORD
```