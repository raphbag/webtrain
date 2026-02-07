import { MarkerClusterer, SuperClusterAlgorithm, GridAlgorithm } from "@googlemaps/markerclusterer";

// Exposer MarkerClusterer et les algorithmes globalement
declare global {
	interface Window {
		MarkerClusterer: typeof MarkerClusterer;
		SuperClusterAlgorithm: typeof SuperClusterAlgorithm;
		GridAlgorithm: typeof GridAlgorithm;
	}
}

window.MarkerClusterer = MarkerClusterer;
window.SuperClusterAlgorithm = SuperClusterAlgorithm;
window.GridAlgorithm = GridAlgorithm;

export { MarkerClusterer, SuperClusterAlgorithm, GridAlgorithm };
