export const prerender = true;

export async function GET() {
	try {
		const FERRE_URL = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/traces-du-reseau-ferre-idf/exports/geojson?limit=-1';
		
		const response = await fetch(FERRE_URL);
		
		if (!response.ok) {
			return new Response(JSON.stringify({ error: 'Erreur lors de la récupération des données' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		const data = await response.json();
		
		return new Response(JSON.stringify(data), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, max-age=86400, immutable'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
