/**
 * Module pour gérer les appels aux endpoints serveur pour les horaires et perturbations
 */

// Configuration de l'affichage des horaires
const MAX_SCHEDULES_METRO_TRAM = 5; // Nombre d'horaires affichés pour Métro/Tram
const MAX_SCHEDULES_RAIL = 10; // Nombre d'horaires affichés pour RER/TER/Transilien

interface Schedule {
	destination: string;
	aimedTime: string;
	expectedTime?: string;
	platform: string;
	isCancelled: boolean;
	journeyNote: string | null;
	vehicleAtStop: boolean;
}

interface Disruption {
	disruptionId: string;
	status: string;
	severity: string;
	effect: string;
	priority: number;
	color: string;
	pidsText: string;
	titleText: string;
	webText: string;
	applicationPeriods: ApplicationPeriod[];
	updatedAt: string;
}

interface ApplicationPeriod {
	begin: string;
	end: string;
}

/**
 * Extrait le MonitoringRef depuis un MonitoringRef complet
 * Le MonitoringRef est déjà au format STIF:StopArea:SP:xxxxx depuis emplacement-des-gares-idf
 */
function extractMonitoringRef(monitoringRef: string): string | null {
	if (!monitoringRef) return null;
	
	// Le MonitoringRef est déjà au bon format depuis le dataset
	return monitoringRef;
}

/**
 * Nettoie un lineRef pour l'API
 */
function cleanLineRef(lineRef: string): string | null {
	if (!lineRef) return null;
	
	let cleaned = lineRef.replace(/^IDFM:/, '');
	cleaned = cleaned.replace(/^STIF:Line::/, '');
	cleaned = cleaned.replace(/^Line::/, '');
	
	return cleaned;
}

/**
 * Récupère les horaires en temps réel pour une gare
 */
export async function fetchStopSchedules(monitoringRef: string, lineRef: string, routeType: string): Promise<Schedule[]> {
	try {
		const cleanedMonitoringRef = extractMonitoringRef(monitoringRef);
		const cleanedLineRef = cleanLineRef(lineRef);
		
		if (!cleanedMonitoringRef) {
			console.warn('MonitoringRef invalide:', monitoringRef);
			return [];
		}
		
		console.log('📍 Récupération horaires depuis le serveur:');
		console.log('  MonitoringRef (id_ref_zda de la gare):', cleanedMonitoringRef);
		console.log('  Type de transport:', routeType);
		console.log('  LineRef (idrefligc de la ligne):', cleanedLineRef);
		
		let url = `/horaires.json?monitoringRef=${encodeURIComponent(cleanedMonitoringRef)}`;
		if (cleanedLineRef) {
			url += `&lineRef=${encodeURIComponent(cleanedLineRef)}`;
		}
		
		const response = await fetch(url);
		
		if (!response.ok) {
			throw new Error(`Erreur API: ${response.status}`);
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
function parseSchedulesData(data: any): Schedule[] {
	const schedules: Schedule[] = [];
	
	try {
		const delivery = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0];
		if (!delivery || !delivery.MonitoredStopVisit) {
			console.warn('No MonitoredStopVisit in response');
			return schedules;
		}
		
		delivery.MonitoredStopVisit.forEach((visit: any) => {
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
			return timeA.getTime() - timeB.getTime();
		});
		
		console.log(`✅ ${schedules.length} horaires parsés et triés`);
		
	} catch (error) {
		console.error('Erreur parsing horaires:', error);
	}
	
	return schedules;
}

/**
 * Récupère les perturbations pour une ligne et un arrêt spécifique
 */
export async function fetchLineDisruptions(lineRef: string, idRefZdA: string | null = null, routeType: string | null = null): Promise<Disruption[]> {
	try {
		const cleanedLineRef = cleanLineRef(lineRef);
		
		if (!cleanedLineRef) {
			console.warn('LineRef invalide:', lineRef);
			return [];
		}
		
		console.log('📡 Récupération perturbations depuis le serveur');
		
		let url = `/perturbations.json?lineRef=${encodeURIComponent(cleanedLineRef)}`;
		if (idRefZdA) {
			url += `&idRefZdA=${encodeURIComponent(idRefZdA)}`;
		}
		if (routeType) {
			url += `&routeType=${encodeURIComponent(routeType)}`;
		}
		
		console.log('📡 URL:', url);
		
		const response = await fetch(url);
		
		if (!response.ok) {
			console.warn('Erreur API perturbations:', response.status);
			return [];
		}
		
		const data = await response.json();
		console.log('✅ Perturbations récupérées:', data);
		
		return parseDisruptionsData(data);
		
	} catch (error) {
		console.error('Error in fetchLineDisruptions:', error);
		return [];
	}
}

/**
 * Parse les données de perturbations depuis l'API Navitia
 */
function parseDisruptionsData(data: any): Disruption[] {
	const disruptions: Disruption[] = [];
	
	try {
		if (!data || !data.disruptions || data.disruptions.length === 0) {
			return disruptions;
		}
		
		// Map pour dédupliquer par disruption_id (garder la plus récente)
		const disruptionsMap = new Map<string, Disruption>();
		
		data.disruptions.forEach((disruption: any) => {
			const status = disruption.status || 'unknown';
			const severity = disruption.severity || {};
			const messages = disruption.messages || [];
			const applicationPeriods = disruption.application_periods || [];
			const tags = disruption.tags || [];
			const disruptionId = disruption.disruption_id;
			const updatedAt = disruption.updated_at;
			
			// Filtrer les perturbations avec le tag "Ascenseur"
			if (tags.includes('Ascenseur')) {
				return; // Skip cette perturbation
			}
			
			// Filtrer les perturbations avec le status "future"
			if (status === 'future') {
				return; // Skip cette perturbation
			}
			
			// Extraire les différents types de messages
			const pidsMessage = messages.find((msg: any) => 
				msg.channel && msg.channel.types?.includes('pids')
			);
			
			const titleMessage = messages.find((msg: any) => 
				msg.channel && msg.channel.types?.includes('title')
			);
			
			const webMessage = messages.find((msg: any) => 
				msg.channel && msg.channel.types?.includes('web')
			);
			
			// Vérifier qu'on a au moins un message pids ou title
			if (!pidsMessage && !titleMessage) {
				return; // Skip si pas de message principal
			}
			
			// Vérifier qu'il y a des périodes d'application et un message
			const hasApplicationPeriods = applicationPeriods.length > 0;
			
			// Vérifier que la perturbation est actuellement active (dans une période d'application)
			const now = new Date();
			const isCurrentlyActive = applicationPeriods.some((period: any) => {
				if (!period.begin || !period.end) return false;
				
				// Convertir les dates du format YYYYMMDDTHHMMSS en Date
				const parseNavitiaDate = (dateStr: string) => {
					const year = parseInt(dateStr.substring(0, 4));
					const month = parseInt(dateStr.substring(4, 6)) - 1; // mois 0-11
					const day = parseInt(dateStr.substring(6, 8));
					const hour = parseInt(dateStr.substring(9, 11));
					const minute = parseInt(dateStr.substring(11, 13));
					const second = parseInt(dateStr.substring(13, 15)) || 0;
					return new Date(year, month, day, hour, minute, second);
				};
				
				const begin = parseNavitiaDate(period.begin);
				const end = parseNavitiaDate(period.end);
				
				return now >= begin && now <= end;
			});
			
			if (status === 'active' && hasApplicationPeriods && isCurrentlyActive) {
				const disruptionData: Disruption = {
					disruptionId: disruptionId,
					status: status,
					severity: severity.name || 'Information',
					effect: severity.effect || 'UNKNOWN_EFFECT',
					priority: severity.priority || 4,
					color: severity.color || '',
					pidsText: pidsMessage?.text || '',
					titleText: titleMessage?.text || '',
					webText: webMessage?.text || '',
					applicationPeriods: applicationPeriods,
					updatedAt: updatedAt
				};
				
				// Si déjà présent, garder le plus récent (updated_at le plus récent)
				if (disruptionId) {
					const existing = disruptionsMap.get(disruptionId);
					if (!existing) {
						disruptionsMap.set(disruptionId, disruptionData);
					} else {
						// Garder celui avec la meilleure priorité (0 = le plus important)
						// Si même priorité, garder le plus récent (updated_at)
						const shouldReplace = 
							disruptionData.priority < existing.priority ||
							(disruptionData.priority === existing.priority && 
							 updatedAt && updatedAt > existing.updatedAt);
						
						if (shouldReplace) {
							disruptionsMap.set(disruptionId, disruptionData);
						}
					}
				} else {
					// Si pas d'ID, ajouter quand même (cas rare)
					disruptions.push(disruptionData);
				}
			}
		});
		
		// Convertir la Map en tableau
		disruptionsMap.forEach(disruption => disruptions.push(disruption));
		
		console.log(`✅ ${disruptions.length} perturbations actives parsées`);
		
		// Trier par priorité (croissant : 0 = plus important = en haut)
		// Si même priorité, trier par updated_at (plus récent en haut)
		disruptions.sort((a, b) => {
			// D'abord comparer les priorités (0 en premier)
			if (a.priority !== b.priority) {
				return a.priority - b.priority;
			}
			// Si même priorité, comparer les dates (plus récent en premier)
			if (a.updatedAt && b.updatedAt) {
				return b.updatedAt.localeCompare(a.updatedAt); // Ordre décroissant pour les dates
			}
			return 0;
		});
		
	} catch (error) {
		console.error('Erreur parsing perturbations:', error);
	}
	
	return disruptions;
}

/**
 * Génère un élément DOM pour afficher les perturbations
 */
function generateDisruptionsElement(disruptions: Disruption[]): HTMLElement | null {
	if (!disruptions || disruptions.length === 0) {
		return null;
	}
	
	const container = document.createElement('div');
	container.className = 'mt-3 p-2 bg-yellow-50 border border-yellow-300 rounded text-xs';
	
	const title = document.createElement('h5');
	title.className = 'm-0 mb-2 text-sm font-semibold text-yellow-800';
	title.textContent = `⚠️ Perturbations (${disruptions.length})`;
	container.appendChild(title);
	
	disruptions.forEach((disruption, index) => {
		const disruptionDiv = document.createElement('div');
		disruptionDiv.className = 'mb-2 pb-2 border-b border-gray-200 last:border-b-0 last:mb-0 last:pb-0';
		
		// Container pour le header (PIDS + Titre avec couleur + date)
		const headerDiv = document.createElement('div');
		headerDiv.className = 'flex justify-between items-start gap-2 cursor-pointer hover:opacity-80 transition-opacity';
		headerDiv.style.color = disruption.color || '#000000';
		
		// Partie gauche : Flèche + PIDS (gras) + Titre
		const leftDiv = document.createElement('div');
		leftDiv.className = 'flex-1 flex items-start gap-1';
		
		// Flèche pour indiquer l'état déroulé/enroulé
		const arrowSpan = document.createElement('span');
		arrowSpan.className = 'flex-shrink-0 transition-transform inline-flex items-center';
		arrowSpan.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
		arrowSpan.id = `arrow-${disruption.disruptionId || index}`;
		
		// Vérifier si cette perturbation doit être déroulée (état persistant dans cette session d'infobulle)
		// Utiliser une clé spécifique qui sera nettoyée à la fermeture de l'infobulle
		const detailsId = `disruption-details-${disruption.disruptionId || index}`;
		
		// Récupérer l'état depuis sessionStorage - par défaut fermé si pas de valeur
		const savedState = sessionStorage.getItem(detailsId);
		const wasExpanded = savedState === 'expanded';
		
		// Appliquer la rotation de la flèche selon l'état
		if (wasExpanded) {
			arrowSpan.style.transform = 'rotate(90deg)';
		}
		
		leftDiv.appendChild(arrowSpan);
		
		// Conteneur pour le texte (PIDS + Titre)
		const textDiv = document.createElement('div');
		
		// PIDS en gras
		if (disruption.pidsText) {
			const pidsSpan = document.createElement('span');
			pidsSpan.className = 'font-bold';
			// Mettre la première lettre en majuscule
			const pidsTextCapitalized = disruption.pidsText.charAt(0).toUpperCase() + disruption.pidsText.slice(1);
			pidsSpan.textContent = pidsTextCapitalized;
			textDiv.appendChild(pidsSpan);
			
			// Ajouter un espace si on a aussi le titre
			if (disruption.titleText) {
				textDiv.appendChild(document.createTextNode(' '));
			}
		}
		
		// Titre
		if (disruption.titleText) {
			const titleSpan = document.createElement('span');
			titleSpan.textContent = disruption.titleText;
			textDiv.appendChild(titleSpan);
		}
		
		leftDiv.appendChild(textDiv);
		
		// Date de mise à jour à droite
		const dateSpan = document.createElement('span');
		dateSpan.className = 'text-[10px] text-gray-500 flex-shrink-0';
		if (disruption.updatedAt) {
			// Format: YYYYMMDDTHHMMSS -> convertir en date lisible
			const dateStr = disruption.updatedAt;
			const year = dateStr.substring(0, 4);
			const month = dateStr.substring(4, 6);
			const day = dateStr.substring(6, 8);
			const hour = dateStr.substring(9, 11);
			const minute = dateStr.substring(11, 13);
			dateSpan.textContent = `${day}/${month}/${year} ${hour}:${minute}`;
		}
		
		headerDiv.appendChild(leftDiv);
		headerDiv.appendChild(dateSpan);
		
		// Détails déroulables
		const detailsDiv = document.createElement('div');
		detailsDiv.className = 'mt-2 text-xs text-gray-700';
		detailsDiv.id = detailsId;
		
		// Par défaut, toujours masqué (fermé) - sauf si explicitement marqué comme 'expanded' dans sessionStorage
		if (!wasExpanded) {
			detailsDiv.classList.add('hidden');
		}
		
		// Message web en HTML (si disponible)
		if (disruption.webText) {
			const webDiv = document.createElement('div');
			webDiv.className = 'prose prose-sm max-w-none';
			
			// Utiliser setHTML si disponible, sinon innerHTML
			if (typeof (webDiv as any).setHTML === 'function') {
				(webDiv as any).setHTML(disruption.webText);
			} else {
				webDiv.innerHTML = disruption.webText;
			}
			
			detailsDiv.appendChild(webDiv);
		}
		
		// Événement de clic pour dérouler/enrouler
		headerDiv.addEventListener('click', () => {
			const isHidden = detailsDiv.classList.contains('hidden');
			const arrow = document.getElementById(`arrow-${disruption.disruptionId || index}`);
			
			if (isHidden) {
				detailsDiv.classList.remove('hidden');
				if (arrow) {
					arrow.style.transform = 'rotate(90deg)';
				}
				// Sauvegarder l'état comme déroulé
				sessionStorage.setItem(detailsId, 'expanded');
			} else {
				detailsDiv.classList.add('hidden');
				if (arrow) {
					arrow.style.transform = 'rotate(0deg)';
				}
				// Sauvegarder l'état comme enroulé
				sessionStorage.setItem(detailsId, 'collapsed');
			}
		});
		
		disruptionDiv.appendChild(headerDiv);
		disruptionDiv.appendChild(detailsDiv);
		container.appendChild(disruptionDiv);
	});
	
	return container;
}

/**
 * Génère un élément DOM pour afficher les horaires dans une info-bulle
 */
export function generateSchedulesElement(schedules: Schedule[], routeType: string, disruptions: Disruption[] | null = null): HTMLElement {
	// Créer le conteneur principal
	const container = document.createElement('div');
	container.className = 'text-xs';
	
	// Afficher les perturbations en premier si présentes
	if (disruptions && disruptions.length > 0) {
		const disruptionsElement = generateDisruptionsElement(disruptions);
		if (disruptionsElement) {
			container.appendChild(disruptionsElement);
		}
	}
	
	if (!schedules || schedules.length === 0) {
		const noScheduleP = document.createElement('p');
		noScheduleP.className = 'text-xs text-gray-400 mt-2';
		noScheduleP.textContent = 'Aucun horaire disponible';
		container.appendChild(noScheduleP);
		return container;
	}
	
	// Déterminer si on affiche la colonne voie (uniquement pour RER, TER, Transilien)
	const showPlatform = routeType === 'RER' || routeType === 'TER' || routeType === 'Transilien';
	
	// Déterminer le nombre d'horaires à afficher selon le type de transport
	const maxSchedules = showPlatform ? MAX_SCHEDULES_RAIL : MAX_SCHEDULES_METRO_TRAM;
	
	// Titre
	const title = document.createElement('h5');
	title.className = 'm-0 mb-1.5 text-sm font-semibold';
	title.textContent = 'Prochains passages';
	container.appendChild(title);
	
	// Conteneur avec scroll si nécessaire
	const tableWrapper = document.createElement('div');
	if (showPlatform) {
		tableWrapper.className = 'max-h-[300px] overflow-y-auto';
	}
	
	// Créer la table
	const table = document.createElement('table');
	table.className = 'w-full border-collapse text-xs';
	
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
		if (!displayTime) return;
		const diffMinutes = Math.round((displayTime.getTime() - now.getTime()) / 60000);
		
		// Pour RER, TER et Transilien : toujours afficher l'heure originale
		// Pour Métro et Tram : afficher "X min" basé sur le temps réel (avec retard)
		let timeStr: string;
		if (routeType === 'RER' || routeType === 'TER' || routeType === 'Transilien') {
			timeStr = aimedTime!.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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
			const delayMinutes = Math.round((expectedTime.getTime() - aimedTime.getTime()) / 60000);
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
			trainIcon.src = '/train_at_station.svg';
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
			tdPlatform.textContent = schedule.platform === 'unknown' ? '--' : schedule.platform;
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
export function generateSchedulesHTML(schedules: Schedule[], routeType: string): string {
	const element = generateSchedulesElement(schedules, routeType);
	return element.outerHTML;
}
