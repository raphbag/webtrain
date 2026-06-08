import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  try {
    // Fetch SNCF lines using data.sncf.com (No API key needed for this open data endpoint)
    const response = await fetch('https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/formes-des-lignes-du-rfn/exports/geojson?limit=-1');
    
    if (!response.ok) {
      return new Response(JSON.stringify({ error: `SNCF Open Data API responded with ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json() as any;

    const normalizedLignes = data.features?.map((feature: any) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        id: feature.properties.code_ligne,
        name: 'Grandes lignes',
        code: feature.properties.code_ligne,
        color: '1D4ED8', // Default color for SNCF
        type: 'sncf',
        mode: 'Grandes lignes'
      }
    })) || [];

    return new Response(JSON.stringify({
      type: "FeatureCollection",
      features: normalizedLignes
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
};
