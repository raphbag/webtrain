import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const prerender = false;

const LINE_REPORTS_API_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/line_reports';

function cleanLineRef(lineRef: string | null): string | null {
	if (!lineRef) return null;
	
	let cleaned = lineRef.replace(/^IDFM:/, '');
	cleaned = cleaned.replace(/^STIF:Line::/, '');
	cleaned = cleaned.replace(/^Line::/, '');
	
	return cleaned;
}

export const GET: APIRoute = async ({ url }) => {
	try {
		const API_KEY = env.IDFM_API_KEY;
		const lineRef = url.searchParams.get('lineRef');
		const idRefZdA = url.searchParams.get('idRefZdA');
		const routeType = url.searchParams.get('routeType');
		
		if (!lineRef) {
			return new Response(JSON.stringify({ error: 'lineRef requis' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		const cleanedLineRef = cleanLineRef(lineRef);
		
		if (!cleanedLineRef) {
			return new Response(JSON.stringify({ error: 'LineRef invalide' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		let apiUrl;
		
		// Pour Grandes lignes : utiliser uniquement le stop_point
		if (routeType === 'Grandes lignes' && idRefZdA) {
			const stopPointId = `stop_point:IDFM:monomodalStopPlace:${idRefZdA}`;
			apiUrl = `${LINE_REPORTS_API_URL}/stop_points/${encodeURIComponent(stopPointId)}/departures`;
		} 
		// Si idRefZdA est fourni (RER, Transilien), construire l'URL avec ligne + stop_point
		else if (idRefZdA) {
			const navitiaLineId = `line:IDFM:${cleanedLineRef}`;
			const stopPointId = `stop_point:IDFM:monomodalStopPlace:${idRefZdA}`;
			apiUrl = `${LINE_REPORTS_API_URL}/lines/${encodeURIComponent(navitiaLineId)}/stop_points/${encodeURIComponent(stopPointId)}/departures`;
		} 
		// Sinon, utiliser line_reports (Métro, Tram)
		else {
			const navitiaLineId = `line:IDFM:${cleanedLineRef}`;
			apiUrl = `${LINE_REPORTS_API_URL}/lines/${encodeURIComponent(navitiaLineId)}/line_reports`;
		}
		
		const response = await fetch(apiUrl, {
			headers: {
				'apikey': API_KEY
			}
		});
		
		if (!response.ok) {
			return new Response(JSON.stringify({ error: 'Erreur API' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		const data = await response.json() as any;
		
		// Filter disruptions by 'active' status
		if (data && data.disruptions && Array.isArray(data.disruptions)) {
			data.disruptions = data.disruptions.filter((disruption: any) => disruption.status === 'active');
		}
		
		return new Response(JSON.stringify(data), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
