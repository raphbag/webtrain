import type { APIRoute } from 'astro';

export const prerender = false;

const SIRI_LITE_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-siri-lite-estimated-timetable';
const CACHE_TTL_MS = 30000;
const MAX_SCHEDULES = 20;
const PARIS_TIME_ZONE = 'Europe/Paris';
const RECENT_PAST_TOLERANCE_MS = 2 * 60 * 1000;

interface Schedule {
	destination?: string;
	origin?: string;
	aimedTime: string;
	expectedTime?: string;
	platform: string;
	isCancelled: boolean;
	journeyNote: string | null;
	vehicleAtStop: boolean;
	source: 'sncf-siri-lite';
	type: 'departure' | 'arrival';
}

let siriCache: { fetchedAt: number; xml: string } | null = null;

function decodeXmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'");
}

function normalizeText(value: string): string {
	return decodeXmlEntities(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildSearchTokens(value: string): string[] {
	const stopWords = new Set(['gare', 'station', 'paris', 'st', 'ste']);
	return normalizeText(value)
		.split(/[^a-z0-9]+/g)
		.filter((token) => token.length >= 4 && !stopWords.has(token));
}

function matchesStopName(stopPointName: string, searchedStopName: string | null): boolean {
	if (!searchedStopName) return false;

	const normalizedPoint = normalizeText(stopPointName);
	const normalizedSearch = normalizeText(searchedStopName);
	if (!normalizedPoint || !normalizedSearch) return false;

	if (
		normalizedPoint === normalizedSearch ||
		normalizedPoint.includes(normalizedSearch) ||
		normalizedSearch.includes(normalizedPoint)
	) {
		return true;
	}

	const tokens = buildSearchTokens(normalizedSearch);
	if (tokens.length === 0) {
		return false;
	}

	const matchedCount = tokens.filter((token) => normalizedPoint.includes(token)).length;
	return matchedCount === tokens.length || matchedCount > 0;
}

function extractTagValue(block: string, tagName: string): string | null {
	const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`);
	const match = block.match(regex);
	if (!match || !match[1]) return null;
	return decodeXmlEntities(match[1].trim());
}

function buildLineTokens(lineCode: string | null, lineName: string | null): string[] {
	const tokens = new Set<string>();

	if (lineCode) {
		tokens.add(normalizeText(lineCode));
	}

	if (lineName) {
		const normalized = normalizeText(lineName);
		tokens.add(normalized);
		const withoutPrefix = normalized
			.replace(/^sncf\s+/, '')
			.replace(/^train\s+/, '')
			.replace(/^rer\s+/, '')
			.replace(/^ter\s+/, '');

		if (withoutPrefix) {
			tokens.add(withoutPrefix);
			const lastToken = withoutPrefix.split(' ').pop();
			if (lastToken && lastToken.length <= 4) {
				tokens.add(lastToken);
			}
		}
	}

	return Array.from(tokens).filter(Boolean);
}

function parseStopCodeUics(stopCodeUic: string | null): string[] {
	if (!stopCodeUic) return [];
	return Array.from(
		new Set(
			stopCodeUic
				.split(',')
				.map((value) => normalizeText(value))
				.filter(Boolean)
		)
	);
}

function toParisDateKey(value: string | Date): string | null {
	const parsedDate = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsedDate.getTime())) {
		return null;
	}

	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: PARIS_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	return formatter.format(parsedDate);
}

function getScheduleTimestamp(schedule: Pick<Schedule, 'expectedTime' | 'aimedTime'>): number | null {
	const timestamp = new Date(schedule.expectedTime || schedule.aimedTime).getTime();
	return Number.isNaN(timestamp) ? null : timestamp;
}

function sanitizeMissionLabel(value: string | null): string | null {
	if (!value) return null;
	const cleaned = value.trim();
	if (!cleaned) return null;
	if (/^[A-Z]{2,8}:(Line|VehicleJourney)::/i.test(cleaned)) {
		return null;
	}
	return cleaned;
}

function extractMissionLabel(journeyBlock: string, publishedLine: string): string | null {
	const trainNumber = sanitizeMissionLabel(extractTagValue(journeyBlock, 'TrainNumberRef'));
	if (trainNumber) return trainNumber;

	const vehicleJourneyName = sanitizeMissionLabel(extractTagValue(journeyBlock, 'VehicleJourneyName'));
	if (vehicleJourneyName) return vehicleJourneyName;

	return sanitizeMissionLabel(publishedLine);
}

function parseSchedulesFromXml(
	xml: string,
	stopCodeUics: string[],
	stopName: string | null,
	lineCode: string | null,
	lineName: string | null,
	limit: number
): Schedule[] {
	const schedules: Schedule[] = [];
	const lineTokens = buildLineTokens(lineCode, lineName);
	const normalizedStopName = stopName ? normalizeText(stopName) : null;
	const journeyRegex = /<EstimatedVehicleJourney>([\s\S]*?)<\/EstimatedVehicleJourney>/g;
	let journeyMatch = journeyRegex.exec(xml);

	while (journeyMatch) {
		const journeyBlock = journeyMatch[1];
		const lineRef = extractTagValue(journeyBlock, 'LineRef') || '';
		const publishedLine = extractTagValue(journeyBlock, 'PublishedLineName') || '';
		const productCategory = extractTagValue(journeyBlock, 'ProductCategoryRef') || '';

		// Filtre équivalent à Nativia: physical_mode:Train ou physical_mode:LongDistanceTrain
		// On exclut explicitement les RER et Transilien (gérés par IDFM)
		if (
			productCategory.includes('RER_') ||
			productCategory.includes('TRANSILIEN') ||
			productCategory.includes('TRAMTRAIN') ||
			productCategory.includes('BUS') ||
			productCategory.includes('CAR')
		) {
			journeyMatch = journeyRegex.exec(xml);
			continue;
		}

		const destinationName = extractTagValue(journeyBlock, 'DestinationName') || 'Destination inconnue';
		const originName = extractTagValue(journeyBlock, 'OriginName') || 'Origine inconnue';

		const lineCandidate = normalizeText(`${lineRef} ${publishedLine} ${productCategory}`);
		if (lineTokens.length > 0 && !lineTokens.some((token) => lineCandidate.includes(token))) {
			journeyMatch = journeyRegex.exec(xml);
			continue;
		}

		const callRegex = /<(RecordedCall|EstimatedCall)>([\s\S]*?)<\/\1>/g;
		let callMatch = callRegex.exec(journeyBlock);

		while (callMatch) {
			const callBlock = callMatch[2];
			const stopPointRef = extractTagValue(callBlock, 'StopPointRef') || '';
			const stopPointName = extractTagValue(callBlock, 'StopPointName') || '';
			const stopPointRefNormalized = normalizeText(stopPointRef);
			const uicMatch =
				stopCodeUics.length > 0
					? stopCodeUics.some(
							(stopCodeUic) =>
								stopPointRef.includes(stopCodeUic) || stopPointRefNormalized.includes(stopCodeUic)
						)
					: false;
			const nameMatch = normalizedStopName ? matchesStopName(stopPointName, normalizedStopName) : false;

			if (!uicMatch && !nameMatch) {
				callMatch = callRegex.exec(journeyBlock);
				continue;
			}

			const aimedDepartureTime = extractTagValue(callBlock, 'AimedDepartureTime');
			const expectedDepartureTime = extractTagValue(callBlock, 'ExpectedDepartureTime');
			const aimedArrivalTime = extractTagValue(callBlock, 'AimedArrivalTime');
			const expectedArrivalTime = extractTagValue(callBlock, 'ExpectedArrivalTime');

			if (!aimedDepartureTime && !expectedDepartureTime && !aimedArrivalTime && !expectedArrivalTime) {
				callMatch = callRegex.exec(journeyBlock);
				continue;
			}

			const departurePlatform = extractTagValue(callBlock, 'DeparturePlatformName') || '-';
			const arrivalPlatform = extractTagValue(callBlock, 'ArrivalPlatformName') || '-';
			
			const departureStatus = (extractTagValue(callBlock, 'DepartureStatus') || '').toLowerCase();
			const arrivalStatus = (extractTagValue(callBlock, 'ArrivalStatus') || '').toLowerCase();

			if (aimedDepartureTime || expectedDepartureTime) {
				schedules.push({
					type: 'departure',
					destination: destinationName,
					aimedTime: aimedDepartureTime || expectedDepartureTime!,
					expectedTime: expectedDepartureTime || aimedDepartureTime || undefined,
					platform: departurePlatform,
					isCancelled: departureStatus === 'cancelled',
					journeyNote: extractMissionLabel(journeyBlock, publishedLine),
					vehicleAtStop: false,
					source: 'sncf-siri-lite'
				});
			}

			if (aimedArrivalTime || expectedArrivalTime) {
				schedules.push({
					type: 'arrival',
					origin: originName,
					aimedTime: aimedArrivalTime || expectedArrivalTime!,
					expectedTime: expectedArrivalTime || aimedArrivalTime || undefined,
					platform: arrivalPlatform,
					isCancelled: arrivalStatus === 'cancelled',
					journeyNote: extractMissionLabel(journeyBlock, publishedLine),
					vehicleAtStop: false,
					source: 'sncf-siri-lite'
				});
			}

			callMatch = callRegex.exec(journeyBlock);
		}

		journeyMatch = journeyRegex.exec(xml);
	}

	const uniqueSchedules = new Map<string, Schedule>();
	for (const schedule of schedules) {
		const uniqueKey = [
			schedule.type,
			schedule.destination || schedule.origin || '',
			schedule.aimedTime,
			schedule.expectedTime || '',
			schedule.platform,
			schedule.journeyNote || '',
			schedule.isCancelled ? '1' : '0'
		].join('|');
		if (!uniqueSchedules.has(uniqueKey)) {
			uniqueSchedules.set(uniqueKey, schedule);
		}
	}

	const sortedSchedules = Array.from(uniqueSchedules.values())
		.sort((a, b) => {
			const timeA = new Date(a.expectedTime || a.aimedTime).getTime();
			const timeB = new Date(b.expectedTime || b.aimedTime).getTime();
			return timeA - timeB;
		});

	const parisToday = toParisDateKey(new Date());
	const todaySchedules =
		parisToday === null
			? []
			: sortedSchedules.filter((schedule) => {
					const scheduleDate = toParisDateKey(schedule.expectedTime || schedule.aimedTime);
					return scheduleDate === parisToday;
				});

	const now = Date.now();
	const keepUpcoming = (list: Schedule[]) =>
		list.filter((schedule) => {
			const timestamp = getScheduleTimestamp(schedule);
			return timestamp !== null && timestamp >= now - RECENT_PAST_TOLERANCE_MS;
		});

	const upcomingTodaySchedules = keepUpcoming(todaySchedules);
	if (upcomingTodaySchedules.length > 0) {
		return upcomingTodaySchedules.slice(0, limit);
	}

	const upcomingAllSchedules = keepUpcoming(sortedSchedules);
	if (upcomingAllSchedules.length > 0) {
		return upcomingAllSchedules.slice(0, limit);
	}

	return [];
}

async function fetchSiriXml(): Promise<string> {
	if (siriCache && Date.now() - siriCache.fetchedAt <= CACHE_TTL_MS) {
		return siriCache.xml;
	}

	const requestInit: RequestInit & {
		cf?: {
			cacheEverything?: boolean;
			cacheTtl?: number;
		};
	} = {
		headers: {
			Accept: 'application/xml,text/xml'
		},
		cf: {
			cacheEverything: true,
			cacheTtl: 120
		}
	};

	const response = await fetch(SIRI_LITE_URL, requestInit);

	if (!response.ok) {
		throw new Response(JSON.stringify({ error: 'Erreur API SIRI Lite' }), {
			status: response.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const xml = await response.text();
	siriCache = { fetchedAt: Date.now(), xml };
	return xml;
}

export const GET: APIRoute = async ({ request }) => {
	try {
		const url = new URL(request.url);
		const stopCodeUic = url.searchParams.get('stopCodeUic');
		const stopCodeUics = parseStopCodeUics(stopCodeUic);
		const stopName = url.searchParams.get('stopName');
		const lineCode = url.searchParams.get('lineCode');
		const lineName = url.searchParams.get('lineName');
		const limit = Math.min(
			Math.max(Number.parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1),
			MAX_SCHEDULES
		);

		if (stopCodeUics.length === 0 && !stopName) {
			return new Response(JSON.stringify({ error: 'stopCodeUic ou stopName requis' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const xml = await fetchSiriXml();
		let schedules = parseSchedulesFromXml(xml, stopCodeUics, stopName, lineCode, lineName, limit);

		if (schedules.length === 0 && (lineCode || lineName)) {
			schedules = parseSchedulesFromXml(xml, stopCodeUics, stopName, null, null, limit);
		}

		return new Response(
			JSON.stringify({
				source: 'sncf-siri-lite',
				stopCodeUic,
				stopName,
				schedules
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-cache'
				}
			}
		);
	} catch (error) {
		if (error instanceof Response) {
			return error;
		}

		return new Response(JSON.stringify({ error: 'Erreur serveur' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
