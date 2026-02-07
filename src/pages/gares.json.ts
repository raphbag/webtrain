export const prerender = false;

export async function GET() {
	try {
		const GARES_URL = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/emplacement-des-gares-idf/exports/geojson?limit=-1';
		
		const response = await fetch(GARES_URL);
		
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
				'Cache-Control': 'public, max-age=3600'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
