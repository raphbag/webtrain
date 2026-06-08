import type { APIRoute } from 'astro';
import { env } from "cloudflare:workers";

export const prerender = false;

const SNCF_API_BASE_URL = 'https://api.sncf.com/v1';
const SNCF_COVERAGE = 'sncf';
const SNCF_LINES_PAGE_SIZE = 200;
const LINE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface SncfLineSummary {
	id: string;
	code: string;
	name: string;
}

let lineCache: { fetchedAt: number; lines: SncfLineSummary[] } | null = null;

function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildAuthHeaders(): Record<string, string> | null {
	const username = env.SNCF_API_USERNAME;
	const password = env.SNCF_API_PASSWORD ?? '';

	if (!username) {
		return null;
	}

	return {
		Authorization: `Basic ${btoa(`${username}:${password}`)}`,
		Accept: 'application/json'
	};
}

function buildEmptyDisruptionsPayload(
	lineCode: string | null,
	lineName: string | null,
	warning: string
) {
	return {
		lineCode,
		lineName,
		disruptions: [],
		traffic_reports: [],
		warning
	};
}

async function fetchAllSncfLines(headers: Record<string, string>): Promise<SncfLineSummary[]> {
	if (lineCache && Date.now() - lineCache.fetchedAt <= LINE_CACHE_TTL_MS) {
		return lineCache.lines;
	}

	const firstResponse = await fetch(
		`${SNCF_API_BASE_URL}/coverage/${SNCF_COVERAGE}/lines?count=${SNCF_LINES_PAGE_SIZE}&start_page=0`,
		{ headers }
	);

	if (!firstResponse.ok) {
		throw new Response(JSON.stringify({ error: 'Erreur API SNCF (lines)' }), {
			status: firstResponse.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const firstData = await firstResponse.json() as { pagination?: { total_result?: number }; lines?: any[] };
	const totalResult = Number.parseInt(String(firstData?.pagination?.total_result || 0), 10) || 0;
	const totalPages = Math.max(1, Math.ceil(totalResult / SNCF_LINES_PAGE_SIZE));
	const allLines: any[] = Array.isArray(firstData?.lines) ? firstData.lines : [];

	if (totalPages > 1) {
		for (let page = 1; page < totalPages; page++) {
			const response = await fetch(
				`${SNCF_API_BASE_URL}/coverage/${SNCF_COVERAGE}/lines?count=${SNCF_LINES_PAGE_SIZE}&start_page=${page}`,
				{ headers }
			);
			if (!response.ok) {
				continue;
			}
			const data = await response.json() as { lines?: any[] };
			if (Array.isArray(data?.lines)) {
				allLines.push(...data.lines);
			}
		}
	}

	const summarized = allLines
		.filter((line) => line?.id && line?.code)
		.map((line) => ({
			id: String(line.id),
			code: String(line.code),
			name: String(line.name || line.code)
		}));

	lineCache = {
		fetchedAt: Date.now(),
		lines: summarized
	};

	return summarized;
}

function resolveLineId(lines: SncfLineSummary[], lineCode: string | null, lineName: string | null): string | null {
	if (lineCode) {
		const normalizedCode = normalizeText(lineCode);
		const exactByCode = lines.find((line) => normalizeText(line.code) === normalizedCode);
		if (exactByCode) return exactByCode.id;
	}

	if (lineName) {
		const normalizedName = normalizeText(lineName);
		const exactByName = lines.find((line) => normalizeText(line.name) === normalizedName);
		if (exactByName) return exactByName.id;

		const includesByName = lines.find((line) => normalizeText(line.name).includes(normalizedName));
		if (includesByName) return includesByName.id;
	}

	return null;
}

function formatSncfDisruptionsForUi(data: any): any {
	const disruptions = Array.isArray(data?.disruptions) ? data.disruptions : [];
	const activeDisruptions = disruptions.filter((d: any) => d.status === 'active');
	const enrichedDisruptions = activeDisruptions.map((disruption: any) => {
		const severity = disruption?.severity || {};
		const firstImpactedObject = disruption?.impacted_objects?.[0]?.pt_object;
		const fallbackText =
			disruption?.cause ||
			severity?.name ||
			firstImpactedObject?.name ||
			firstImpactedObject?.trip?.name ||
			'Perturbation SNCF';
		const existingMessages = Array.isArray(disruption?.messages) ? disruption.messages : [];

		if (existingMessages.length > 0) {
			return disruption;
		}

		return {
			...disruption,
			messages: [
				{
					text: fallbackText,
					channel: { types: ['pids'] }
				},
				{
					text: fallbackText,
					channel: { types: ['title'] }
				},
				{
					text: fallbackText,
					channel: { types: ['web'] }
				}
			],
			tags: Array.isArray(disruption?.tags) ? disruption.tags : []
		};
	});

	return {
		...data,
		disruptions: enrichedDisruptions
	};
}

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const lineCode = url.searchParams.get('lineCode') || url.searchParams.get('lineRef');
	const lineName = url.searchParams.get('lineName');

	try {
		if (!lineCode && !lineName) {
			return new Response(JSON.stringify({ error: 'lineCode ou lineName requis' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const headers = buildAuthHeaders();
		if (!headers) {
			return new Response(
				JSON.stringify(
					buildEmptyDisruptionsPayload(
						lineCode,
						lineName,
						'SNCF_API_USERNAME manquant: perturbations SNCF indisponibles'
					)
				),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache'
					}
				}
			);
		}

		const lines = await fetchAllSncfLines(headers);
		const lineId = resolveLineId(lines, lineCode, lineName);

		if (!lineId) {
			return new Response(
				JSON.stringify({
					lineCode,
					lineName,
					disruptions: [],
					traffic_reports: []
				}),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache'
					}
				}
			);
		}

		const trafficReportsResponse = await fetch(
			`${SNCF_API_BASE_URL}/coverage/${SNCF_COVERAGE}/lines/${encodeURIComponent(lineId)}/traffic_reports?count=100`,
			{ headers }
		);

		if (!trafficReportsResponse.ok) {
			return new Response(
				JSON.stringify(
					buildEmptyDisruptionsPayload(
						lineCode,
						lineName,
						`Erreur API SNCF (traffic_reports): ${trafficReportsResponse.status}`
					)
				),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache'
					}
				}
			);
		}

		const data = await trafficReportsResponse.json();
		const formattedData = formatSncfDisruptionsForUi(data);
		return new Response(JSON.stringify(formattedData), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache'
			}
		});
	} catch (error) {
		const warning = error instanceof Response
			? `Erreur SNCF: ${error.status}`
			: 'Erreur serveur SNCF';

		return new Response(
			JSON.stringify(buildEmptyDisruptionsPayload(lineCode, lineName, warning)),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-cache'
				}
			}
		);
	}
};