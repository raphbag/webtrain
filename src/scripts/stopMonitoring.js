/**
 * Module pour gérer les appels à l'API stop-monitoring de PRIM
 */

const API_KEY = 'SvPHVJ5fPXkfJPKsu6958pwLCh5Oidhq';
const API_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring';

// Configuration de l'affichage des horaires
const MAX_SCHEDULES_METRO_TRAM = 5; // Nombre d'horaires affichés pour Métro/Tram
const MAX_SCHEDULES_RAIL = 10; // Nombre d'horaires affichés pour RER/TER/Transilien

/**
 * Extrait le MonitoringRef depuis un MonitoringRef complet
 * Le MonitoringRef est déjà au format STIF:StopArea:SP:xxxxx depuis emplacement-des-gares-idf
 */
function extractMonitoringRef(monitoringRef) {
	if (!monitoringRef) return null;
	
	// Le MonitoringRef est déjà au bon format depuis le dataset
	return monitoringRef;
}

/**
 * Nettoie un lineRef pour l'API
 */
function cleanLineRef(lineRef) {
	if (!lineRef) return null;
	
	let cleaned = lineRef.replace(/^IDFM:/, '');
	cleaned = cleaned.replace(/^STIF:Line::/, '');
	cleaned = cleaned.replace(/^Line::/, '');
	
	return cleaned;
}

/**
 * Récupère les horaires en temps réel pour une gare
 */
export async function fetchStopSchedules(monitoringRef, lineRef, routeType) {
	try {
		const cleanedMonitoringRef = extractMonitoringRef(monitoringRef);
		const cleanedLineRef = cleanLineRef(lineRef);
		
		if (!cleanedMonitoringRef) {
			console.warn('MonitoringRef invalide:', monitoringRef);
			return [];
		}
		
		const lineRefParam = `STIF:Line::${cleanedLineRef}:`;
		
		const url = `${API_URL}?MonitoringRef=${encodeURIComponent(cleanedMonitoringRef)}&LineRef=${encodeURIComponent(lineRefParam)}`;
		
		console.log('📍 Récupération horaires API stop-monitoring:');
		console.log('  MonitoringRef (id_ref_zda de la gare):', cleanedMonitoringRef);
		console.log('  Type de transport:', routeType);
		console.log('  LineRef (idrefligc de la ligne):', lineRefParam);
		
		const response = await fetch(url, {
			headers: {
				'apikey': API_KEY
			}
		});
		
		if (!response.ok) {
			const errorText = await response.text();
			console.error('❌ API Error:', response.status);
			console.error('Response:', errorText);
			
			// Si erreur, essayer sans le LineRef (parfois ça aide)
			const urlWithoutLine = `${API_URL}?MonitoringRef=${encodeURIComponent(cleanedMonitoringRef)}`;
			console.log('🔄 Nouvelle tentative sans LineRef (tous les trains de la gare)');
			
			const retryResponse = await fetch(urlWithoutLine, {
				headers: {
					'apikey': API_KEY
				}
			});
			
			if (!retryResponse.ok) {
				throw new Error(`Erreur API: ${response.status}`);
			}
			
			const data = await retryResponse.json();
			console.log('✅ Horaires récupérés sans LineRef:', data.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit?.length || 0, 'passages trouvés');
			return parseSchedulesData(data);
		}
		
		const data = await response.json();
		console.log('✅ Horaires récupérés:', data.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit?.length || 0, 'passages trouvés');
		return parseSchedulesData(data);
		
	} catch (error) {
		console.error('Error in fetchStopSchedules:', error);
		return [];
	}
}

/**
 * Parse les données de l'API pour extraire les horaires
 */
function parseSchedulesData(data) {
	const schedules = [];
	
	try {
		const delivery = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0];
		if (!delivery || !delivery.MonitoredStopVisit) {
			console.warn('No MonitoredStopVisit in response');
			return schedules;
		}
		
		delivery.MonitoredStopVisit.forEach(visit => {
			const journey = visit.MonitoredVehicleJourney;
			if (!journey) return;
			
			const destinationName = journey.DestinationName?.[0]?.value || 
			                       journey.DestinationName?.value || 
			                       'Destination inconnue';
			const aimedTime = journey.MonitoredCall?.AimedDepartureTime;
			const expectedTime = journey.MonitoredCall?.ExpectedDepartureTime;
			const platform = journey.MonitoredCall?.DeparturePlatformName?.value || 
			                journey.MonitoredCall?.ArrivalPlatformName?.value || 
			                '-';
			
			// Récupérer le JourneyNote
			const journeyNote = journey.JourneyNote?.[0]?.value || 
			                   journey.JourneyNote?.value || 
			                   null;
			
			// Vérifier si le train est annulé
			const isCancelled = journey.MonitoredCall?.DepartureStatus === 'cancelled' ||
			                   journey.MonitoredCall?.VehicleAtStop === false && 
			                   journey.MonitoredCall?.ExpectedDepartureTime === undefined;
			
			// Récupérer VehicleAtStop
			const vehicleAtStop = journey.MonitoredCall?.VehicleAtStop === true;
			
			if (aimedTime || expectedTime) {
				schedules.push({
					destination: destinationName,
					aimedTime: aimedTime,
					expectedTime: expectedTime,
					platform: platform,
					isCancelled: isCancelled,
					journeyNote: journeyNote,
					vehicleAtStop: vehicleAtStop
				});
			}
		});
		
		// Trier par heure (utiliser expectedTime si disponible, sinon aimedTime)
		schedules.sort((a, b) => {
			const timeA = new Date(a.expectedTime || a.aimedTime);
			const timeB = new Date(b.expectedTime || b.aimedTime);
			return timeA - timeB;
		});
		
		console.log(`✅ ${schedules.length} horaires parsés et triés`);
		
	} catch (error) {
		console.error('Erreur parsing horaires:', error);
	}
	
	return schedules;
}

/**
 * Génère un élément DOM pour afficher les horaires dans une info-bulle
 */
export function generateSchedulesElement(schedules, routeType) {
	// Créer le conteneur principal
	const container = document.createElement('div');
	container.className = 'text-[11px]';
	
	if (!schedules || schedules.length === 0) {
		container.innerHTML = '<p class="text-[11px] text-gray-400">Aucun horaire disponible</p>';
		return container;
	}
	
	// Déterminer si on affiche la colonne voie (uniquement pour RER, TER, Transilien)
	const showPlatform = routeType === 'RER' || routeType === 'TER' || routeType === 'Transilien';
	
	// Déterminer le nombre d'horaires à afficher selon le type de transport
	const maxSchedules = showPlatform ? MAX_SCHEDULES_RAIL : MAX_SCHEDULES_METRO_TRAM;
	
	// Titre
	const title = document.createElement('h5');
	title.className = 'm-0 mb-1.5 text-xs font-semibold';
	title.textContent = 'Prochains passages';
	container.appendChild(title);
	
	// Conteneur avec scroll si nécessaire
	const tableWrapper = document.createElement('div');
	if (showPlatform) {
		tableWrapper.className = 'max-h-[300px] overflow-y-auto';
	}
	
	// Créer la table
	const table = document.createElement('table');
	table.className = 'w-full border-collapse text-[11px]';
	
	// En-tête
	const thead = document.createElement('thead');
	const headerRow = document.createElement('tr');
	headerRow.className = 'border-b border-gray-300';
	
	const headers = ['Heure', 'Direction'];
	if (showPlatform) headers.push('Voie');
	
	headers.forEach((text, index) => {
		const th = document.createElement('th');
		th.className = 'text-left p-1 font-semibold';
		if (index === 2) th.className = 'text-center p-1 font-semibold';
		th.textContent = text;
		headerRow.appendChild(th);
	});
	
	thead.appendChild(headerRow);
	table.appendChild(thead);
	
	// Corps du tableau
	const tbody = document.createElement('tbody');
	
	schedules.slice(0, maxSchedules).forEach(schedule => {
		const now = new Date();
		const aimedTime = schedule.aimedTime ? new Date(schedule.aimedTime) : null;
		const expectedTime = schedule.expectedTime ? new Date(schedule.expectedTime) : null;
		const isCancelled = schedule.isCancelled || false;
		const journeyNote = schedule.journeyNote || null;
		const vehicleAtStop = schedule.vehicleAtStop || false;
		
		// Utiliser expectedTime si disponible, sinon aimedTime
		const displayTime = expectedTime || aimedTime;
		const diffMinutes = Math.round((displayTime - now) / 60000);
		
		// Pour RER, TER et Transilien : toujours afficher l'heure originale
		// Pour Métro et Tram : afficher "X min" basé sur le temps réel (avec retard)
		let timeStr;
		if (routeType === 'RER' || routeType === 'TER' || routeType === 'Transilien') {
			timeStr = aimedTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
		} else {
			if (diffMinutes < 0) {
				timeStr = displayTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
			} else if (diffMinutes < 60) {
				timeStr = `${diffMinutes} min`;
			} else {
				timeStr = displayTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
			}
		}
		
		// Créer la ligne
		const tr = document.createElement('tr');
		tr.className = 'border-b border-gray-100';
		if (isCancelled) {
			tr.className += ' line-through text-red-600';
		}
		
		// Colonne heure
		const tdTime = document.createElement('td');
		tdTime.className = 'p-1 whitespace-nowrap';
		if (isCancelled) tdTime.className += ' line-through text-red-600';
		
		// Créer un conteneur flex pour tout mettre sur une ligne
		const timeContainer = document.createElement('div');
		timeContainer.className = 'flex items-center gap-1';
		
		// Ajouter l'heure
		const timeSpan = document.createElement('span');
		timeSpan.textContent = timeStr;
		timeContainer.appendChild(timeSpan);
		
		// Ajouter le retard en orange si applicable
		if ((routeType === 'RER' || routeType === 'TER' || routeType === 'Transilien') && 
		    expectedTime && aimedTime && expectedTime > aimedTime) {
			const delayMinutes = Math.round((expectedTime - aimedTime) / 60000);
			if (delayMinutes > 0) {
				const expectedTimeStr = expectedTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
				const delaySpan = document.createElement('span');
				delaySpan.className = 'text-orange-500 font-semibold';
				delaySpan.textContent = expectedTimeStr;
				timeContainer.appendChild(delaySpan);
			}
		}
		
		// Ajouter l'icône train si vehicleAtStop est true
		if (vehicleAtStop) {
			const trainIcon = document.createElement('img');
			trainIcon.src = '/webtrain/train_at_station.svg';
			trainIcon.alt = 'Train à quai';
			trainIcon.className = 'w-3 h-3';
			trainIcon.title = 'Train à quai';
			timeContainer.appendChild(trainIcon);
		}
		
		tdTime.appendChild(timeContainer);
		
		tr.appendChild(tdTime);
		
		// Colonne destination
		const tdDest = document.createElement('td');
		tdDest.className = 'p-1';
		if (isCancelled) tdDest.className += ' line-through text-red-600';
		
		// Créer un conteneur flex pour destination + note
		const destContainer = document.createElement('div');
		destContainer.className = 'flex items-center gap-2';
		
		// Destination
		const destSpan = document.createElement('span');
		destSpan.textContent = schedule.destination;
		destContainer.appendChild(destSpan);
		
		// Ajouter le JourneyNote si présent
		if (journeyNote) {
			const noteSpan = document.createElement('span');
			noteSpan.className = 'text-[10px] text-blue-600 italic';
			noteSpan.textContent = `${journeyNote}`;
			destContainer.appendChild(noteSpan);
		}
		
		tdDest.appendChild(destContainer);
		tr.appendChild(tdDest);
		
		// Colonne voie (si applicable)
		if (showPlatform) {
			const tdPlatform = document.createElement('td');
			tdPlatform.className = 'p-1 text-center';
			if (isCancelled) tdPlatform.className += ' line-through text-red-600';
			tdPlatform.textContent = schedule.platform;
			tr.appendChild(tdPlatform);
		}
		
		tbody.appendChild(tr);
	});
	
	table.appendChild(tbody);
	tableWrapper.appendChild(table);
	container.appendChild(tableWrapper);
	
	return container;
}

/**
 * Version legacy qui retourne du HTML en string (pour compatibilité)
 */
export function generateSchedulesHTML(schedules, routeType) {
	const element = generateSchedulesElement(schedules, routeType);
	return element.outerHTML;
}
