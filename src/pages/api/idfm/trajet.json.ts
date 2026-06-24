import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const prerender = false;

const NAVITIA_API_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/trips/';

export const GET: APIRoute = async ({ url }) => {
	try {
		const API_KEY = env.IDFM_API_KEY;
		const vehicleJourneyId = url.searchParams.get('id'); // format: UUID
		
		if (!vehicleJourneyId) {
			return new Response(JSON.stringify({ error: 'id requis' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		// L'ID du trip pour la SNCF est simplement IDFM:TN:SNCF:UUID
		const tripId = `IDFM:TN:SNCF:${vehicleJourneyId}`;
		const apiUrl = `${NAVITIA_API_URL}${encodeURIComponent(tripId)}/vehicle_journeys?data_freshness=realtime`;
		
		const response = await fetch(apiUrl, {
			headers: {
				'apikey': API_KEY
			}
		});
		
		if (!response.ok) {
			return new Response(JSON.stringify({ error: 'Erreur API Navitia' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		const data = (await response.json()) as any;
		
		if (!data.vehicle_journeys || data.vehicle_journeys.length === 0) {
			return new Response(JSON.stringify({ error: 'Trajet non trouvé' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		
		// Navitia peut créer un doublon :RealTime: pour les horaires en temps réel.
		// On cherche la version de base (théorique) et la version temps réel.
		const journeys = data.vehicle_journeys;
		const baseJourney = journeys.find((j: any) => !j.id.includes(':RealTime:') && !j.id.includes(':Adapted:'));
		const realtimeJourney = journeys.find((j: any) => j.id.includes(':RealTime:') || j.id.includes(':Adapted:'));
		
		const journeyToUse = realtimeJourney || baseJourney || journeys[0];
		
		// Parser les arrêts
		const stops = journeyToUse.stop_times.map((st: any) => {
			const stopId = st.stop_point?.id;
			
			let aimedArrivalTime = st.arrival_time;
			let aimedDepartureTime = st.departure_time;
			
			// Si on utilise le trajet temps réel, on récupère les heures théoriques depuis le trajet de base
			if (realtimeJourney && baseJourney && stopId) {
				const baseSt = baseJourney.stop_times.find((bst: any) => bst.stop_point?.id === stopId);
				if (baseSt) {
					aimedArrivalTime = baseSt.arrival_time;
					aimedDepartureTime = baseSt.departure_time;
				}
			}
			
			// vérifier le statut de l'arrêt (supprimé, ajouté, etc)
			const isCancelled = st.amended_departure_time === null && st.amended_arrival_time === null && st.departure_status === 'cancelled';
			const isSkipped = (st.pickup_type === 'no_pickup' && st.drop_off_type === 'no_drop_off') || st.arrival_status === 'cancelled' || st.departure_status === 'cancelled';
			
			return {
				name: st.stop_point?.name || 'Inconnu',
				aimedArrivalTime: aimedArrivalTime, // Théorique
				aimedDepartureTime: aimedDepartureTime, // Théorique
				expectedArrivalTime: st.amended_arrival_time || st.arrival_time, // Temps réel
				expectedDepartureTime: st.amended_departure_time || st.departure_time, // Temps réel
				status: isCancelled || isSkipped ? 'cancelled' : 'active',
				platform: st.stop_point?.physical_mode?.name || '-'
			};
		});
		
		return new Response(JSON.stringify({
			name: journeyToUse.name || '',
			stops: stops
		}), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
