export const prerender = false;

const API_KEY = import.meta.env.IDFM_API_KEY;
const LINE_REPORTS_API_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/line_reports';

function cleanLineRef(lineRef: string | null): string | null {
	if (!lineRef) return null;
	
	let cleaned = lineRef.replace(/^IDFM:/, '');
	cleaned = cleaned.replace(/^STIF:Line::/, '');
	cleaned = cleaned.replace(/^Line::/, '');
	
	return cleaned;
}

export async function GET({ url }: { url: URL }) {
	try {
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
		
		// Pour TER : utiliser uniquement le stop_point
		if (routeType === 'TER' && idRefZdA) {
			const stopPointId = `stop_point:IDFM:monomodalStopPlace:${idRefZdA}`;
			apiUrl = `${LINE_REPORTS_API_URL}/stop_points/${encodeURIComponent(stopPointId)}/departures?count=10`;
		} 
		// Si idRefZdA est fourni (RER, Transilien), construire l'URL avec ligne + stop_point
		else if (idRefZdA) {
			const navitiaLineId = `line:IDFM:${cleanedLineRef}`;
			const stopPointId = `stop_point:IDFM:monomodalStopPlace:${idRefZdA}`;
			apiUrl = `${LINE_REPORTS_API_URL}/lines/${encodeURIComponent(navitiaLineId)}/stop_points/${encodeURIComponent(stopPointId)}/departures?count=10`;
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
		
		const data = await response.json();
		
		return new Response(JSON.stringify(data), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
