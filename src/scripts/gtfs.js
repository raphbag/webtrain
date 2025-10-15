/**
 * Script pour récupérer et afficher les données GTFS depuis l'API PRIM Île-de-France Mobilité
 */

const API_KEY = 'SvPHVJ5fPXkfJPKsu6958pwLCh5Oidhq';
const API_BASE_URL = 'https://prim.iledefrance-mobilites.fr/marketplace';

/**
 * Récupère les lignes de transport depuis l'API
 */
export async function fetchTransitLines() {
  try {
    // L'API PRIM nécessite une authentification avec la clé API
    const response = await fetch(`${API_BASE_URL}/v2/navitia/lines`, {
      headers: {
        'apikey': API_KEY
      }
    });
    
    if (!response.ok) {
      throw new Error(`Erreur API: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erreur lors de la récupération des lignes:', error);
    return null;
  }
}

/**
 * Récupère les détails d'une ligne spécifique avec ses tracés
 */
export async function fetchLineShape(lineId) {
  try {
    const response = await fetch(`${API_BASE_URL}/navitia/lines/${lineId}`, {
      headers: {
        'apikey': API_KEY
      }
    });
    
    if (!response.ok) {
      throw new Error(`Erreur API: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Erreur lors de la récupération de la ligne ${lineId}:`, error);
    return null;
  }
}

/**
 * Dessine une ligne de transport sur la carte Google Maps
 */
export function drawTransitLine(map, coordinates, lineColor, lineName) {
  // Convertir les coordonnées en format Google Maps
  const path = coordinates.map(coord => ({
    lat: coord.lat,
    lng: coord.lng
  }));

  // Créer une polyline pour représenter la ligne
  const polyline = new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: lineColor || '#FF0000',
    strokeOpacity: 0.8,
    strokeWeight: 4,
    map: map
  });

  // Ajouter un écouteur d'événement pour afficher des infos au clic
  polyline.addListener('click', (event) => {
    const infoWindow = new google.maps.InfoWindow({
      content: `<div style="padding: 8px;"><strong>${lineName}</strong></div>`,
      position: event.latLng
    });
    infoWindow.open(map);
  });

  return polyline;
}

/**
 * Dessine plusieurs lignes de transport sur la carte
 */
export async function drawAllTransitLines(map) {
  const lines = await fetchTransitLines();
  
  if (!lines || !lines.lines) {
    console.error('Aucune ligne de transport trouvée');
    return [];
  }

  const polylines = [];
  
  // Limiter le nombre de lignes pour des raisons de performance (optionnel)
  const linesToDraw = lines.lines.slice(0, 50);
  
  for (const line of linesToDraw) {
    const lineDetails = await fetchLineShape(line.id);
    
    if (lineDetails && lineDetails.geojson) {
      // Extraire les coordonnées de la géométrie
      const coordinates = parseGeoJSON(lineDetails.geojson);
      
      if (coordinates.length > 0) {
        const polyline = drawTransitLine(
          map,
          coordinates,
          line.color || '#' + Math.floor(Math.random()*16777215).toString(16),
          line.name || 'Ligne ' + line.code
        );
        polylines.push(polyline);
      }
    }
    
    // Petite pause pour ne pas surcharger l'API
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return polylines;
}

/**
 * Parse une géométrie GeoJSON pour extraire les coordonnées
 */
function parseGeoJSON(geojson) {
  const coordinates = [];
  
  if (geojson.type === 'LineString') {
    geojson.coordinates.forEach(coord => {
      coordinates.push({
        lng: coord[0],
        lat: coord[1]
      });
    });
  } else if (geojson.type === 'MultiLineString') {
    geojson.coordinates.forEach(lineString => {
      lineString.forEach(coord => {
        coordinates.push({
          lng: coord[0],
          lat: coord[1]
        });
      });
    });
  }
  
  return coordinates;
}
