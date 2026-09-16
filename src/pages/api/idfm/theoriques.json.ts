import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
    try {
        const API_KEY = env.IDFM_API_KEY;
        const line = url.searchParams.get('line');
        const stopArea = url.searchParams.get('stopArea');
        const dateTime = url.searchParams.get('dateTime'); // expected format YYYYMMDDTHHMMSS

        if (!line || !stopArea || !dateTime) {
            return new Response(JSON.stringify({ error: 'line, stopArea et dateTime sont requis' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const lineId = line.startsWith('line:') ? line : `line:IDFM:${line}`;
        const stopAreaId = stopArea.startsWith('stop_area:') ? stopArea : `stop_area:IDFM:${stopArea}`;

        const apiUrl = `https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/lines/${encodeURIComponent(lineId)}/stop_areas/${encodeURIComponent(stopAreaId)}/departures?count=50&from_datetime=${encodeURIComponent(dateTime)}`;

        const response = await fetch(apiUrl, {
            headers: {
                'apikey': API_KEY || ''
            }
        });

        if (!response.ok) {
            console.error('IDFM API Error:', response.status, await response.text());
            return new Response(JSON.stringify({ error: 'Erreur API IDFM' }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const data = await response.json() as {
            departures?: any[];
            vehicle_journeys_map?: Record<string, unknown>;
            [key: string]: unknown;
        };

        if (data.departures && Array.isArray(data.departures)) {
            // Collect unique vehicle journey IDs for each departure
            const vjIds: string[] = [...new Set(
                data.departures
                    .map((d: any) => d.links?.find((l: any) => l.type === 'vehicle_journey')?.id)
                    .filter(Boolean) as string[]
            )];

            // Fetch specific vehicle journey stops in parallel
            const vehicleJourneysMap: Record<string, { id: string; name: string; stop_area_id?: string; stop_area_name?: string; arrival_time?: string; departure_time?: string }[]> = {};

            await Promise.all(vjIds.map(async (vjId) => {
                try {
                    const vjRes = await fetch(`https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/vehicle_journeys/${encodeURIComponent(vjId)}`, {
                        headers: { 'apikey': API_KEY || '' }
                    });
                    if (vjRes.ok) {
                        const vjData = await vjRes.json() as {
                            vehicle_journeys?: Array<{
                                stop_times?: any[];
                            }>;
                        };
                        const vj = vjData.vehicle_journeys?.[0];
                        if (vj && Array.isArray(vj.stop_times)) {
                            // Filter only stops that are actually served and not skipped
                            const filtered = vj.stop_times
                                .filter((st: any) => !st.skipped_stop && (st.pickup_allowed || st.drop_off_allowed))
                                .map((st: any) => ({
                                    id: st.stop_point?.id || '',
                                    name: st.stop_point?.name || st.stop_point?.stop_area?.name || '',
                                    stop_area_id: st.stop_point?.stop_area?.id || '',
                                    stop_area_name: st.stop_point?.stop_area?.name || st.stop_point?.name || '',
                                    arrival_time: st.arrival_time || '',
                                    departure_time: st.departure_time || ''
                                }));

                            // Deduplicate consecutive identical station names
                            const dedup: typeof filtered = [];
                            for (const s of filtered) {
                                if (!dedup.length || dedup[dedup.length - 1].name !== s.name) {
                                    dedup.push(s);
                                }
                            }
                            vehicleJourneysMap[vjId] = dedup;
                        }
                    }
                } catch (e) {
                    console.error('Failed to fetch vehicle journey', vjId, e);
                }
            }));

            // Attach stop_times directly to departures for frontend consumption
            data.departures.forEach((d: any) => {
                const vjId = d.links?.find((l: any) => l.type === 'vehicle_journey')?.id;
                if (vjId && vehicleJourneysMap[vjId]) {
                    d.stop_times = vehicleJourneysMap[vjId];
                }
            });

            data.vehicle_journeys_map = vehicleJourneysMap;
        }

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    } catch (error: any) {
        console.error('Server Error:', error);
        return new Response(JSON.stringify({ error: 'Erreur serveur', details: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
