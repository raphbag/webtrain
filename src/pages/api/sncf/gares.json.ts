import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async () => {
  try {
    const sncfApiKey = env.SNCF_API_USERNAME;
    
    if (!sncfApiKey) {
      return new Response(JSON.stringify({ error: 'SNCF_API_USERNAME is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const authHeader = 'Basic ' + btoa(sncfApiKey + ':');
    
    let allStopAreas: any[] = [];
    let startPage = 0;
    const itemsPerPage = 1000;
    let hasMore = true;

    // Fetch all SNCF stop areas using Navitia pagination
    while (hasMore) {
      const url = `https://api.sncf.com/v1/coverage/sncf/stop_areas?filter=physical_mode.id%3Dphysical_mode%3ATrain%20or%20physical_mode.id%3Dphysical_mode%3ALongDistanceTrain&count=${itemsPerPage}&start_page=${startPage}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': authHeader
        }
      });
      
      if (!response.ok) {
        // If we get an error on the first page, throw it. Otherwise, break and use what we have.
        if (startPage === 0) {
          return new Response(JSON.stringify({ error: `SNCF API responded with ${response.status}` }), {
            status: response.status,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          break;
        }
      }

      const data = await response.json() as { stop_areas?: any[] };
      
      if (data.stop_areas && data.stop_areas.length > 0) {
        allStopAreas = allStopAreas.concat(data.stop_areas);
        startPage++;
        
        // Safety break if there's no more data or it returns fewer items than requested
        if (data.stop_areas.length < itemsPerPage) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    // Normalize response for the map (features as GeoJSON)
    const normalizedGares = allStopAreas.map((area: any) => {
      // Navitia coord objects usually have lon and lat
      const lon = parseFloat(area.coord?.lon || "0");
      const lat = parseFloat(area.coord?.lat || "0");

      if (lon === 0 && lat === 0) {
        return null; // Skip invalid coordinates
      }

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lon, lat]
        },
        properties: {
          id: area.id,
          name: area.name,
          type: 'sncf'
        }
      };
    }).filter(Boolean);

    return new Response(JSON.stringify({
      type: "FeatureCollection",
      features: normalizedGares
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400'
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
