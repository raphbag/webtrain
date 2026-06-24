import type { APIRoute } from 'astro';

export const prerender = false;

const IDFM_GARES_URL = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/emplacement-des-gares-idf/exports/geojson?limit=-1';

interface GeoJsonFeatureCollection {
	type: 'FeatureCollection';
	features: Array<any>;
}

function toFeatureCollection(data: any): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: Array.isArray(data?.features) ? data.features : []
	};
}

function normalizeIdfmStations(data: any): GeoJsonFeatureCollection {
	const collection = toFeatureCollection(data);
	const filteredFeatures = collection.features.filter((feature) => {
		const props = feature.properties || {};
		if (props.mode === 'TER') return false;
		if (props.reseau === 'GRANDES LIGNES') return false;
		if (props.res_com === 'GL') return false;
		if (props.res_com && typeof props.res_com === 'string' && props.res_com.includes('TER')) return false;
		return true;
	});
	return {
		type: 'FeatureCollection',
		features: filteredFeatures.map((feature) => ({
			...feature,
			properties: {
				...(feature?.properties || {}),
				data_source: 'idfm'
			}
		}))
	};
}

export const GET: APIRoute = async () => {
	try {
		const response = await fetch(IDFM_GARES_URL);
		if (!response.ok) {
			return new Response(JSON.stringify({ error: 'Erreur lors de la récupération des données IDFM' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		const data = await response.json();
		const normalizedData = normalizeIdfmStations(data);

		return new Response(JSON.stringify(normalizedData), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, max-age=86400'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
