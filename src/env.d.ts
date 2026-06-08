/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}

declare namespace Cloudflare {
	interface Env {
		ASSETS: Fetcher;
		IDFM_API_KEY: string;
		SNCF_API_USERNAME: string;
		SNCF_API_PASSWORD: string;
		PUBLIC_GOOGLE_MAPS_API_KEY: string;
	}
}

interface Env extends Cloudflare.Env {}

interface ImportMetaEnv {
	// Clés API publiques (accessibles côté client)
	// Les clés PUBLIC_* sont exposées dans le HTML - sécurisez-les avec des restrictions de domaine
	readonly PUBLIC_GOOGLE_MAPS_API_KEY: string;
	
	// Clés API privées (accessibles uniquement côté serveur)
	readonly IDFM_API_KEY: string;
	readonly SNCF_API_USERNAME: string;
	readonly SNCF_API_PASSWORD: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
