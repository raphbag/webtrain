import type { APIRoute } from 'astro';

export const prerender = false;

const IDFM_FERRE_URL = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/traces-du-reseau-ferre-idf/exports/geojson?limit=-1';

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

function normalizeIdfmLines(data: any): GeoJsonFeatureCollection {
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
		const response = await fetch(IDFM_FERRE_URL);
		if (!response.ok) {
			return new Response(JSON.stringify({ error: 'Erreur lors de la récupération des données IDFM' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		const data = await response.json();
		const normalizedData = normalizeIdfmLines(data);

		return new Response(JSON.stringify(normalizedData), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, max-age=300'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
