export const prerender = false;

const API_KEY = import.meta.env.IDFM_API_KEY;
const API_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring';

function extractMonitoringRef(monitoringRef: string | null): string | null {
	if (!monitoringRef) return null;
	return monitoringRef;
}

function cleanLineRef(lineRef: string | null): string | null {
	if (!lineRef) return null;
	
	let cleaned = lineRef.replace(/^IDFM:/, '');
	cleaned = cleaned.replace(/^STIF:Line::/, '');
	cleaned = cleaned.replace(/^Line::/, '');
	
	return cleaned;
}

export async function GET({ url }: { url: URL }) {
	try {
		const monitoringRef = url.searchParams.get('monitoringRef');
		const lineRef = url.searchParams.get('lineRef');
		
		if (!monitoringRef) {
			return new Response(JSON.stringify({ error: 'monitoringRef requis' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		const cleanedMonitoringRef = extractMonitoringRef(monitoringRef);
		const cleanedLineRef = lineRef ? cleanLineRef(lineRef) : null;
		
		if (!cleanedMonitoringRef) {
			return new Response(JSON.stringify({ error: 'MonitoringRef invalide' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		let apiUrl = `${API_URL}?MonitoringRef=${encodeURIComponent(cleanedMonitoringRef)}`;
		
		if (cleanedLineRef) {
			const lineRefParam = `STIF:Line::${cleanedLineRef}:`;
			apiUrl += `&LineRef=${encodeURIComponent(lineRefParam)}`;
		}
		
		const response = await fetch(apiUrl, {
			headers: {
				'apikey': API_KEY
			}
		});
		
		if (!response.ok) {
			// Essayer sans le LineRef
			if (cleanedLineRef) {
				const urlWithoutLine = `${API_URL}?MonitoringRef=${encodeURIComponent(cleanedMonitoringRef)}`;
				const retryResponse = await fetch(urlWithoutLine, {
					headers: {
						'apikey': API_KEY
					}
				});
				
				if (!retryResponse.ok) {
					return new Response(JSON.stringify({ error: 'Erreur API' }), {
						status: response.status,
						headers: { 'Content-Type': 'application/json' }
					});
				}
				
				const data = await retryResponse.json();
				return new Response(JSON.stringify(data), {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache'
					}
				});
			}
			
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
