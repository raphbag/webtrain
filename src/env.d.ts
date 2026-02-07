/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}

interface ImportMetaEnv {
	// Clés API publiques (accessibles côté client)
	// Les clés PUBLIC_* sont exposées dans le HTML - sécurisez-les avec des restrictions de domaine
	readonly PUBLIC_GOOGLE_MAPS_API_KEY: string;
	
	// Clés API privées (accessibles uniquement côté serveur)
	readonly IDFM_API_KEY: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
