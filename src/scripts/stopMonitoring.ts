/**
 * Module pour gérer les appels aux endpoints serveur pour les horaires et perturbations
 */

declare global {
	interface Window {
		showToast?: (message: string, type?: string) => void;
	}
}

// Configuration de l'affichage des horaires
const MAX_SCHEDULES_METRO_TRAM = 5; // Nombre d'horaires affichés pour Métro/Tram
const MAX_SCHEDULES_RAIL = 10; // Nombre d'horaires affichés pour RER/Grandes lignes/Transilien

interface Schedule {
	destination?: string;
	origin?: string;
	aimedTime: string;
	expectedTime?: string;
	platform: string;
	isCancelled: boolean;
	journeyNote: string | null;
	vehicleAtStop: boolean;
	vehicleJourneyRef?: string;
	type?: 'departure' | 'arrival';
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
export async function fetchStopSchedules(monitoringRef: string, lineRef: string, routeType: string, stopName: string | null = null, routeName: string | null = null, dataSource: string = 'idfm', stopCodeUic: string | null = null): Promise<Schedule[]> {
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
		console.log('  Source de données:', dataSource);
		
		let url = `/api/${dataSource}/horaires.json?monitoringRef=${encodeURIComponent(cleanedMonitoringRef)}`;
		if (cleanedLineRef) {
			url += `&lineRef=${encodeURIComponent(cleanedLineRef)}&lineCode=${encodeURIComponent(cleanedLineRef)}`;
		}
		if (stopCodeUic) {
			url += `&stopCodeUic=${encodeURIComponent(stopCodeUic)}`;
		}
		if (stopName) {
			url += `&stopName=${encodeURIComponent(stopName)}`;
		}
		if (routeName) {
			url += `&lineName=${encodeURIComponent(routeName)}`;
		}
		
		const response = await fetch(url);
		
		if (!response.ok) {
			throw new Error(`Erreur API: ${response.status}`);
		}
		
		const data = (await response.json()) as any;
		
		// Si la source est SNCF, les données sont déjà formatées et parsées par l'API Route
		if (dataSource === 'sncf' && data.schedules) {
			console.log('✅ Horaires récupérés (SNCF):', data.schedules.length, 'passages trouvés');
			return data.schedules;
		}
		
		console.log('✅ Horaires récupérés:', data.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit?.length || 0, 'passages trouvés');
		return parseSchedulesData(data, cleanedLineRef);
		
	} catch (error) {
		console.error('Error in fetchStopSchedules:', error);
		if (typeof window !== 'undefined' && window.showToast) {
			window.showToast('Impossible de récupérer les horaires.', 'error');
		}
		return [];
	}
}

/**
 * Parse les données de l'API pour extraire les horaires
 */
function parseSchedulesData(data: any, requestedLineRef: string | null = null): Schedule[] {
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
			
			// Filtrer par LineRef pour ne garder que les horaires de la ligne demandée
			if (requestedLineRef) {
				const visitLineRef = journey.LineRef?.value || journey.LineRef || '';
				// Le LineRef de l'API est au format STIF:Line::C01371: 
				// Le requestedLineRef est au format C01371
				if (!visitLineRef.includes(requestedLineRef)) {
					return; // Ignorer cet horaire, il appartient à une autre ligne
				}
			}
			
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
			
			let vehicleJourneyRef: string | undefined;
			const siriId = journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef?.value || journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || journey.VehicleJourneyRef?.value || journey.VehicleJourneyRef;
			if (siriId && typeof siriId === 'string' && siriId.includes('SNCF')) {
				const match = siriId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
				if (match) {
					vehicleJourneyRef = match[0];
				}
			}
			
			if (aimedTime || expectedTime) {
				schedules.push({
					destination: destinationName,
					aimedTime: aimedTime,
					expectedTime: expectedTime,
					platform: platform,
					isCancelled: isCancelled,
					journeyNote: journeyNote,
					vehicleAtStop: vehicleAtStop,
					vehicleJourneyRef: vehicleJourneyRef,
					type: 'departure' // Par défaut IDFM c'est presque toujours des départs
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
export async function fetchLineDisruptions(lineRef: string, idRefZdA: string | null = null, routeType: string | null = null, dataSource: string = 'idfm', routeName: string | null = null): Promise<Disruption[]> {
	try {
		const cleanedLineRef = cleanLineRef(lineRef);
		
		if (!cleanedLineRef) {
			console.warn('LineRef invalide:', lineRef);
			return [];
		}
		
		console.log('📡 Récupération perturbations depuis le serveur');
		
		let url = `/api/${dataSource}/perturbations.json?lineRef=${encodeURIComponent(cleanedLineRef)}`;
		if (idRefZdA) {
			url += `&idRefZdA=${encodeURIComponent(idRefZdA)}`;
		}
		if (routeType) {
			url += `&routeType=${encodeURIComponent(routeType)}`;
		}
		if (routeName) {
			url += `&lineName=${encodeURIComponent(routeName)}`;
		}
		
		console.log('📡 URL:', url);
		
		const response = await fetch(url);
		
		if (!response.ok) {
			console.warn('Erreur API perturbations:', response.status);
			return [];
		}
		
		const data = (await response.json()) as any;
		console.log('✅ Perturbations récupérées:', data);
		
		return parseDisruptionsData(data);
		
	} catch (error) {
		console.error('Error in fetchLineDisruptions:', error);
		if (typeof window !== 'undefined' && window.showToast) {
			window.showToast('Impossible de récupérer les perturbations.', 'error');
		}
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
	container.className = 'mt-1 rounded-xl border border-orange-300/50 bg-orange-100/80 p-2 text-xs shadow-sm';
	
	const title = document.createElement('h5');
	title.className = 'm-0 mb-2 flex items-center gap-1 text-sm font-semibold tracking-tight text-amber-900';
	title.textContent = `⚠️ Perturbations (${disruptions.length})`;
	container.appendChild(title);
	
	disruptions.forEach((disruption) => {
		const disruptionDiv = document.createElement('div');
		disruptionDiv.className = 'mb-2 rounded-lg border border-orange-200/80 bg-white/80 shadow-[0_1px_2px_rgba(0,0,0,0.06)] last:mb-0';
		
		// Container pour le header (PIDS + Titre avec couleur)
		const headerDiv = document.createElement('div');
		headerDiv.className = 'flex items-start gap-2 rounded-md p-1.5 transition-colors hover:bg-amber-50 cursor-pointer';
		headerDiv.style.color = disruption.color || '#000000';
		
		// Partie gauche : Flèche + PIDS (gras) + Titre
		const leftDiv = document.createElement('div');
		leftDiv.className = 'flex flex-1 items-start gap-1.5';
		
		const disruptionStateKey = disruption.disruptionId
			? `id-${disruption.disruptionId}`
			: `content-${(disruption.pidsText || '').trim().toLowerCase()}|${(disruption.titleText || '').trim().toLowerCase()}`;

		// Flèche pour indiquer l'état déroulé/enroulé
		const arrowSpan = document.createElement('span');
		arrowSpan.className = 'shrink-0 transition-transform inline-flex items-center';
		arrowSpan.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
		
		// Vérifier si cette perturbation doit être déroulée (état persistant dans cette session d'infobulle)
		// Utiliser une clé spécifique qui sera nettoyée à la fermeture de l'infobulle
		const detailsId = `disruption-details-${disruptionStateKey}`;
		
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
		textDiv.className = 'font-normal';
		
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
		
		headerDiv.appendChild(leftDiv);
		
		// Détails déroulables
		const detailsDiv = document.createElement('div');
		detailsDiv.className = 'overflow-hidden text-xs text-slate-700 transition-[max-height,opacity] duration-300 ease-in-out';
		detailsDiv.id = detailsId;
		detailsDiv.style.maxHeight = '0px';
		detailsDiv.style.opacity = '0';
		detailsDiv.dataset.expanded = 'false';

		const detailsInner = document.createElement('div');
		detailsInner.className = 'border-t border-amber-200/80';
		detailsDiv.appendChild(detailsInner);

		if (disruption.updatedAt) {
			const dateStr = disruption.updatedAt;
			const year = dateStr.substring(0, 4);
			const month = dateStr.substring(4, 6);
			const day = dateStr.substring(6, 8);
			const hour = dateStr.substring(9, 11);
			const minute = dateStr.substring(11, 13);

			const updatedAtDiv = document.createElement('div');
			updatedAtDiv.className = 'text-[10px] font-medium text-slate-500 m-2';
			updatedAtDiv.textContent = `Dernière mise à jour : ${day}/${month}/${year} ${hour}:${minute}`;
			detailsInner.appendChild(updatedAtDiv);
		}
		
		// Message web en HTML (si disponible)
		if (disruption.webText) {
			const webDiv = document.createElement('div');
			webDiv.className = ' m-2 prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-a:text-blue-700 prose-a:no-underline hover:prose-a:underline';
			
			// Utiliser setHTML si disponible, sinon innerHTML
			if (typeof (webDiv as any).setHTML === 'function') {
				(webDiv as any).setHTML(disruption.webText);
			} else {
				webDiv.innerHTML = disruption.webText;
			}
			
			detailsInner.appendChild(webDiv);
		}

		if (wasExpanded) {
			detailsDiv.dataset.expanded = 'true';
			detailsDiv.style.opacity = '1';
			detailsDiv.style.maxHeight = 'none';
			arrowSpan.style.transform = 'rotate(90deg)';
		}
		
		const setDetailsExpanded = (expanded: boolean, persistState = true) => {
			if (expanded) {
				detailsDiv.dataset.expanded = 'true';
				detailsDiv.style.opacity = '1';
				detailsDiv.style.maxHeight = `${detailsDiv.scrollHeight}px`;
				arrowSpan.style.transform = 'rotate(90deg)';
				if (persistState) {
					sessionStorage.setItem(detailsId, 'expanded');
				}
			} else {
				detailsDiv.dataset.expanded = 'false';
				detailsDiv.style.maxHeight = `${detailsDiv.scrollHeight}px`;
				requestAnimationFrame(() => {
					detailsDiv.style.opacity = '0';
					detailsDiv.style.maxHeight = '0px';
				});
				arrowSpan.style.transform = 'rotate(0deg)';
				if (persistState) {
					sessionStorage.setItem(detailsId, 'collapsed');
				}
			}
		};

		// Événement de clic pour dérouler/enrouler
		headerDiv.addEventListener('click', () => {
			const isExpanded = detailsDiv.dataset.expanded === 'true';
			setDetailsExpanded(!isExpanded);
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
function createSchedulesTable(schedules: Schedule[], maxSchedules: number, showPlatform: boolean, routeType: string, tableType: 'departure' | 'arrival'): HTMLElement {
	const tableWrapper = document.createElement('div');
	tableWrapper.className = 'overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-[0_1px_2px_rgba(0,0,0,0.06)]';
	if (showPlatform) {
		tableWrapper.className += ' max-h-[300px] overflow-y-auto';
	}
	
	if (schedules.length === 0) {
		const noData = document.createElement('div');
		noData.className = 'p-3 text-center text-xs text-slate-500';
		noData.textContent = `Aucun ${tableType === 'departure' ? 'départ' : 'arrivée'} prévu`;
		tableWrapper.appendChild(noData);
		return tableWrapper;
	}
	
	const table = document.createElement('table');
	table.className = 'w-full border-separate border-spacing-0 text-xs';
	
	const thead = document.createElement('thead');
	const headerRow = document.createElement('tr');
	headerRow.className = 'bg-slate-100/90';
	
	const destOrOrigin = tableType === 'departure' ? 'Direction' : 'Provenance';
	const headers = ['Heure', destOrOrigin];
	if (showPlatform) headers.push('Voie');
	
	headers.forEach((text, index) => {
		const th = document.createElement('th');
		th.className = 'border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600';
		if (showPlatform) {
			th.className += ' sticky top-0 bg-slate-100/95';
		}
		if (index === 2) th.className = th.className.replace('text-left', 'text-center');
		th.textContent = text;
		headerRow.appendChild(th);
	});
	
	thead.appendChild(headerRow);
	table.appendChild(thead);
	
	const tbody = document.createElement('tbody');
	
	schedules.slice(0, maxSchedules).forEach(schedule => {
		const now = new Date();
		const aimedTime = schedule.aimedTime ? new Date(schedule.aimedTime) : null;
		const expectedTime = schedule.expectedTime ? new Date(schedule.expectedTime) : null;
		const isCancelled = schedule.isCancelled || false;
		const journeyNote = schedule.journeyNote || null;
		const vehicleAtStop = schedule.vehicleAtStop || false;
		const aimedHourMin = aimedTime ? aimedTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
		const expectedHourMin = expectedTime ? expectedTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
		const isDelayed = Boolean(expectedTime && aimedTime && expectedTime > aimedTime && aimedHourMin !== expectedHourMin);
		
		const displayTime = expectedTime || aimedTime;
		if (!displayTime) return;
		const diffMinutes = Math.round((displayTime.getTime() - now.getTime()) / 60000);
		
		let timeStr: string;
		if (routeType === 'RER' || routeType === 'Grandes lignes' || routeType === 'Transilien') {
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
		
		const tr = document.createElement('tr');
		tr.className = 'transition-colors odd:bg-white even:bg-slate-50/60 hover:bg-slate-100/80';
		if (isCancelled) {
			tr.className += ' text-red-600';
		}
		
		if (schedule.vehicleJourneyRef) {
			tr.className += ' cursor-pointer hover:bg-blue-50/80';
			tr.onclick = () => {
				renderJourneyDetails(schedule.vehicleJourneyRef!, schedule, tableWrapper);
			};
		}
		
		const tdTime = document.createElement('td');
		tdTime.className = 'whitespace-nowrap px-2 py-1.5';
		if (isCancelled) tdTime.className += ' line-through text-red-600';
		
		const timeContainer = document.createElement('div');
		timeContainer.className = 'flex items-center gap-1';
		
		const timeSpan = document.createElement('span');
		timeSpan.className = 'font-medium tabular-nums';
		const isTrain = routeType === 'RER' || routeType === 'Grandes lignes' || routeType === 'Transilien';
		
		if (isDelayed && isTrain) timeSpan.className += ' line-through text-slate-500';
		timeSpan.textContent = timeStr;
		timeContainer.appendChild(timeSpan);
		
		if (isTrain && isDelayed && expectedTime && aimedTime) {
			const expectedTimeStr = expectedTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
			const delaySpan = document.createElement('span');
			delaySpan.className = 'rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700';
			delaySpan.textContent = expectedTimeStr;
			timeContainer.appendChild(delaySpan);
		}
		
		if (vehicleAtStop) {
			const trainIcon = document.createElement('img');
			trainIcon.src = '/train_at_station.svg';
			trainIcon.alt = 'Train à quai';
			trainIcon.className = 'h-3.5 w-3.5';
			trainIcon.title = 'Train à quai';
			timeContainer.appendChild(trainIcon);
		}
		
		tdTime.appendChild(timeContainer);
		tr.appendChild(tdTime);
		
		const tdDest = document.createElement('td');
		tdDest.className = 'px-2 py-1.5';
		if (isCancelled) tdDest.className += ' line-through text-red-600';
		
		const destContainer = document.createElement('div');
		destContainer.className = 'flex items-center gap-2';
		
		const destSpan = document.createElement('span');
		destSpan.textContent = tableType === 'departure' ? (schedule.destination || 'Inconnu') : (schedule.origin || 'Inconnu');
		destContainer.appendChild(destSpan);
		
		if (journeyNote) {
			const noteSpan = document.createElement('span');
			noteSpan.className = 'rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] italic text-blue-700';
			noteSpan.textContent = `${journeyNote}`;
			destContainer.appendChild(noteSpan);
		}
		
		tdDest.appendChild(destContainer);
		tr.appendChild(tdDest);
		
		if (showPlatform) {
			const tdPlatform = document.createElement('td');
			tdPlatform.className = 'px-2 py-1.5 text-center font-medium tabular-nums';
			if (isCancelled) tdPlatform.className += ' line-through text-red-600';
			tdPlatform.textContent = schedule.platform === 'unknown' ? '--' : schedule.platform;
			tr.appendChild(tdPlatform);
		}
		
		tbody.appendChild(tr);
	});
	
	table.appendChild(tbody);
	tableWrapper.appendChild(table);
	
	return tableWrapper;
}

export function generateSchedulesElement(schedules: Schedule[], routeType: string, disruptions: Disruption[] | null = null): HTMLElement {
	const container = document.createElement('div');
	container.className = 'space-y-2 text-xs text-slate-800';
	
	if (disruptions && disruptions.length > 0) {
		const disruptionsElement = generateDisruptionsElement(disruptions);
		if (disruptionsElement) {
			container.appendChild(disruptionsElement);
		}
	}
	
	if (!schedules || schedules.length === 0) {
		const noScheduleP = document.createElement('p');
		noScheduleP.className = 'mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-500';
		noScheduleP.textContent = 'Aucun horaire disponible';
		container.appendChild(noScheduleP);
		return container;
	}
	
	const showPlatform = routeType === 'RER' || routeType === 'Grandes lignes' || routeType === 'Transilien';
	const maxSchedules = showPlatform ? MAX_SCHEDULES_RAIL : MAX_SCHEDULES_METRO_TRAM;
	
	const departures = schedules.filter(s => s.type === 'departure' || !s.type);
	const arrivals = schedules.filter(s => s.type === 'arrival');
	
	const title = document.createElement('h5');
	title.className = 'm-0 mb-1 text-sm font-semibold tracking-tight text-slate-900';
	title.textContent = 'Prochains passages';
	container.appendChild(title);
	
	if (arrivals.length === 0) {
		container.appendChild(createSchedulesTable(departures, maxSchedules, showPlatform, routeType, 'departure'));
	} else {
		// Create Tabs
		const tabsContainer = document.createElement('div');
		tabsContainer.className = 'mt-1';
		
		const tabHeader = document.createElement('div');
		tabHeader.className = 'flex space-x-1 rounded-t-lg bg-slate-200/60 p-1';
		
		const btnDepartures = document.createElement('button');
		btnDepartures.className = 'flex-1 rounded-md bg-white py-1 px-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/5 transition-all cursor-pointer';
		btnDepartures.textContent = 'Départs';
		
		const btnArrivals = document.createElement('button');
		btnArrivals.className = 'flex-1 rounded-md py-1 px-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-all cursor-pointer';
		btnArrivals.textContent = 'Arrivées';
		
		tabHeader.appendChild(btnDepartures);
		tabHeader.appendChild(btnArrivals);
		tabsContainer.appendChild(tabHeader);
		
		const tabContent = document.createElement('div');
		
		const departuresTable = createSchedulesTable(departures, maxSchedules, showPlatform, routeType, 'departure');
		// Remove rounded borders from top if we have tabs
		departuresTable.className = departuresTable.className.replace('rounded-xl', 'rounded-b-lg');
		
		const arrivalsTable = createSchedulesTable(arrivals, maxSchedules, showPlatform, routeType, 'arrival');
		arrivalsTable.className = arrivalsTable.className.replace('rounded-xl', 'rounded-b-lg');
		
		tabContent.appendChild(departuresTable);
		tabContent.appendChild(arrivalsTable);
		tabsContainer.appendChild(tabContent);
		
		// Restaurer l'onglet actif depuis le sessionStorage
		const activeTab = sessionStorage.getItem('activeSchedulesTab') || 'departure';
		
		if (activeTab === 'arrival') {
			btnArrivals.className = 'flex-1 rounded-md bg-white py-1 px-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/5 transition-all cursor-pointer';
			btnDepartures.className = 'flex-1 rounded-md py-1 px-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-all cursor-pointer';
			arrivalsTable.style.display = 'block';
			departuresTable.style.display = 'none';
		} else {
			btnDepartures.className = 'flex-1 rounded-md bg-white py-1 px-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/5 transition-all cursor-pointer';
			btnArrivals.className = 'flex-1 rounded-md py-1 px-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-all cursor-pointer';
			departuresTable.style.display = 'block';
			arrivalsTable.style.display = 'none';
		}
		
		// Tab switching logic
		btnDepartures.addEventListener('click', () => {
			sessionStorage.setItem('activeSchedulesTab', 'departure');
			btnDepartures.className = 'flex-1 rounded-md bg-white py-1 px-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/5 transition-all cursor-pointer';
			btnArrivals.className = 'flex-1 rounded-md py-1 px-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-all cursor-pointer';
			departuresTable.style.display = 'block';
			arrivalsTable.style.display = 'none';
		});
		
		btnArrivals.addEventListener('click', () => {
			sessionStorage.setItem('activeSchedulesTab', 'arrival');
			btnArrivals.className = 'flex-1 rounded-md bg-white py-1 px-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/5 transition-all cursor-pointer';
			btnDepartures.className = 'flex-1 rounded-md py-1 px-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-all cursor-pointer';
			arrivalsTable.style.display = 'block';
			departuresTable.style.display = 'none';
		});
		
		container.appendChild(tabsContainer);
	}
	
	return container;
}

/**
 * Version legacy qui retourne du HTML en string (pour compatibilité)
 */
export function generateSchedulesHTML(schedules: Schedule[], routeType: string): string {
	const element = generateSchedulesElement(schedules, routeType);
	return element.outerHTML;
}

async function renderJourneyDetails(uuid: string, schedule: Schedule, tableWrapper: HTMLElement) {
	const tableElement = tableWrapper.querySelector('table');
	if (!tableElement) return;
	
	tableElement.style.display = 'none';
	
	const timelineWrapper = document.createElement("div");
	timelineWrapper.className = "journey-timeline-wrapper relative";
	
	timelineWrapper.innerHTML = `
		<div class="p-3 text-center text-xs text-slate-500">
			<div class="mb-2 animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
			Chargement du trajet...
		</div>
	`;
	tableWrapper.appendChild(timelineWrapper);
	
	try {
		const res = await fetch(`/api/idfm/trajet.json?id=${uuid}`);
		if (!res.ok) throw new Error("API Error");
		const data = (await res.json()) as any;
		
		if (!data.stops || data.stops.length === 0) {
			throw new Error("No stops");
		}
		
		timelineWrapper.innerHTML = "";
		
		const container = document.createElement("div");
		container.className = "flex flex-col bg-white";
		
		const backBtn = document.createElement("button");
		backBtn.className = "sticky top-0 z-20 flex w-full items-center gap-1.5 border-b border-slate-200 bg-slate-50/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-slate-100 cursor-pointer";
		backBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg> Retour aux horaires`;
		backBtn.onclick = () => {
			timelineWrapper.remove();
			tableElement.style.display = 'table';
		};
		container.appendChild(backBtn);
		
		const timelineHeader = document.createElement("div");
		timelineHeader.className = "bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 border-b border-slate-200";
		timelineHeader.innerHTML = `Trajet ${schedule.journeyNote ? `<span class="bg-blue-100 text-blue-800 px-1 py-0.5 rounded">${schedule.journeyNote}</span>` : ""} vers <b>${schedule.destination}</b>`;
		container.appendChild(timelineHeader);
		
		const timelineList = document.createElement("div");
		timelineList.className = "flex flex-col py-3 timeline-list-container";
		
		const renderListContent = (data: any) => {
			timelineList.innerHTML = "";
			const nowStr = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/:/g, "");
			
			// Find the index of the first stop that is in the future
			let firstFutureIdx = data.stops.findIndex((stop: any) => {
				const timeToUse = stop.expectedDepartureTime || stop.expectedArrivalTime || stop.aimedDepartureTime || stop.aimedArrivalTime;
				return timeToUse >= nowStr;
			});
			if (firstFutureIdx === -1) firstFutureIdx = data.stops.length - 1; // Train is at the end or past end
			
			data.stops.forEach((stop: any, index: number) => {
				const item = document.createElement("div");
				item.className = "flex items-stretch min-h-[36px] group";
				
				const formatT = (t: string) => t && t.length >= 4 ? t.substring(0, 2) + ":" + t.substring(2, 4) : "--:--";
				const expTime = stop.expectedDepartureTime || stop.expectedArrivalTime;
				const aimTime = stop.aimedDepartureTime || stop.aimedArrivalTime;
				
				const isPast = index < firstFutureIdx;
				const isCurrent = index === firstFutureIdx;
				const isCancelled = stop.status === "cancelled";
				const hasDelay = expTime && aimTime && expTime !== aimTime;

				// Column 1: Time
				const timeDiv = document.createElement("div");
				timeDiv.className = "w-[48px] shrink-0 text-right pr-3 flex flex-col justify-center tabular-nums leading-none";
				
				if (isCancelled) {
					timeDiv.innerHTML = `<span class="line-through text-slate-400 text-[11px]">${formatT(aimTime)}</span>`;
				} else if (hasDelay) {
					timeDiv.innerHTML = `<span class="line-through text-slate-400 text-[10px] mb-0.5">${formatT(aimTime)}</span><span class="text-orange-600 font-bold text-[11px]">${formatT(expTime)}</span>`;
				} else {
					timeDiv.innerHTML = `<span class="text-[11px] ${isPast ? 'text-slate-400' : (isCurrent ? 'text-blue-700 font-bold' : 'text-slate-700 font-semibold')}">${formatT(aimTime)}</span>`;
				}

				// Column 2: Track line and dot
				const trackDiv = document.createElement("div");
				trackDiv.className = "w-4 shrink-0 relative flex flex-col items-center justify-center";
				
				const isFirst = index === 0;
				const isLast = index === data.stops.length - 1;
				
				// Line segments
				if (!isFirst) {
					const topHalf = document.createElement("div");
					const topColor = index <= firstFutureIdx ? "bg-slate-300" : "bg-blue-600";
					topHalf.className = `absolute top-0 w-1.5 h-1/2 ${topColor}`;
					trackDiv.appendChild(topHalf);
				}
				
				if (!isLast) {
					const bottomHalf = document.createElement("div");
					const bottomColor = isPast ? "bg-slate-300" : "bg-blue-600";
					bottomHalf.className = `absolute bottom-0 w-1.5 h-1/2 ${bottomColor}`;
					trackDiv.appendChild(bottomHalf);
				}
				
				// Dot
				const dot = document.createElement("div");
				let dotClass = "h-2 w-2 rounded-full border-[1.5px] border-slate-300 bg-white z-10 ring-[2px] ring-white";
				
				if (isCancelled) {
					dotClass = "h-2.5 w-2.5 rounded-full border-[2px] border-orange-500 bg-white z-10 ring-[2px] ring-white";
				} else if (isCurrent) {
					dotClass = "h-3.5 w-3.5 rounded-full border-[3px] border-blue-600 bg-white z-10 ring-[3px] ring-white shadow-[0_0_0_6px_rgba(37,99,235,0.15)]";
				} else if (!isPast) {
					dotClass = "h-2.5 w-2.5 rounded-full border-[2.5px] border-blue-600 bg-white z-10 ring-[2px] ring-white";
				}
				dot.className = dotClass;
				trackDiv.appendChild(dot);
				
				// Column 3: Name
				const nameDiv = document.createElement("div");
				nameDiv.className = `flex-1 pl-3 flex flex-col justify-center py-1.5`;
				
				let nameHtml = `<span class="text-[12px] leading-snug tracking-tight ${isPast ? 'text-slate-500' : (isCurrent ? 'text-slate-900 font-bold' : 'text-slate-800 font-semibold')} ${isCancelled ? 'line-through opacity-70' : ''}">${stop.name}</span>`;
				if (isCancelled) {
					nameHtml += `<span class="text-[9px] text-orange-600 font-bold uppercase tracking-wider mt-0.5">Supprimé</span>`;
				}
				nameDiv.innerHTML = nameHtml;
				
				item.appendChild(timeDiv);
				item.appendChild(trackDiv);
				item.appendChild(nameDiv);
				
				timelineList.appendChild(item);
			});
		};
		
		renderListContent(data);
		
		container.appendChild(timelineList);
		timelineWrapper.appendChild(container);
		
		// Add refresh function to wrapper
		(timelineWrapper as any).refresh = async () => {
			try {
				const res = await fetch(`/api/idfm/trajet.json?id=${uuid}`);
				if (!res.ok) return;
				const newData = (await res.json()) as any;
				if (!newData.stops || newData.stops.length === 0) return;
				renderListContent(newData);
			} catch (err) {
				console.error("Silent refresh failed", err);
			}
		};
		
	} catch (err) {
		timelineWrapper.innerHTML = `
			<div class="p-3 text-center text-xs text-red-500">
				Impossible de charger les détails du trajet.
				<button class="mt-2 block w-full rounded bg-slate-100 px-2 py-1 text-slate-700 underline cursor-pointer">Retour</button>
			</div>
		`;
		timelineWrapper.querySelector('button')?.addEventListener('click', () => {
			timelineWrapper.remove();
			tableElement.style.display = 'table';
		});
	}
}

