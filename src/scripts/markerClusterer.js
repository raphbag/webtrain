import { MarkerClusterer, SuperClusterAlgorithm, GridAlgorithm } from "@googlemaps/markerclusterer";

// Exposer MarkerClusterer et les algorithmes globalement
window.MarkerClusterer = MarkerClusterer;
window.SuperClusterAlgorithm = SuperClusterAlgorithm;
window.GridAlgorithm = GridAlgorithm;

export { MarkerClusterer, SuperClusterAlgorithm, GridAlgorithm };
