/**
 * Bus API Client
 * Optimized client for backend communication with automatic fallback
 */

const API_BASE_URL = 'https://bus-tracking-backend-6htm.onrender.com/api';

// Default options for fetch
const defaultOptions = {
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
};

/**
 * Fetch with timeout and retry
 */
async function fetchWithRetry(url, options = {}, timeout = 5000, retries = 2) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.json();
    
  } catch (error) {
    clearTimeout(id);
    
    if (retries > 0 && error.name !== 'AbortError') {
      console.log(`[API] Retry ${retries} for ${url}`);
      await new Promise(r => setTimeout(r, 1000));
      return fetchWithRetry(url, options, timeout, retries - 1);
    }
    
    throw error;
  }
}

/**
 * Get buses near a location
 */
export async function getNearbyBuses(lat, lng, radius = 5000, limit = 50) {
  const url = `${API_BASE_URL}/buses/nearby?lat=${lat}&lng=${lng}&radius=${radius}&limit=${limit}`;
  
  const data = await fetchWithRetry(url);
  
  // Expand compact format to full field names
  return {
    meta: data.meta,
    buses: data.buses.map(expandBusData)
  };
}

/**
 * Get buses in bounding box
 */
export async function getBusesInBounds(north, south, east, west, zoom = 12, limit = 100) {
  const url = `${API_BASE_URL}/buses/bounds?north=${north}&south=${south}&east=${east}&west=${west}&zoom=${zoom}&limit=${limit}`;
  
  const data = await fetchWithRetry(url);
  
  return {
    meta: data.meta,
    buses: data.buses.map(expandBusData)
  };
}

/**
 * Get single bus details
 */
export async function getBusById(busId) {
  const url = `${API_BASE_URL}/buses/${busId}`;
  const data = await fetchWithRetry(url);
  return expandBusData(data.bus);
}

/**
 * Create real-time streaming connection
 */
export function createBusStream(lat, lng, radius = 5000, onUpdate, onError) {
  const url = `${API_BASE_URL.replace('http', 'http')}/buses/stream?lat=${lat}&lng=${lng}&radius=${radius}`;
  
  const eventSource = new EventSource(url);
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // Expand bus data
      if (data.buses) {
        data.buses = data.buses.map(expandBusData);
      }
      
      onUpdate(data);
    } catch (error) {
      console.error('[Stream] Parse error:', error);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('[Stream] Error:', error);
    if (onError) onError(error);
  };
  
  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

/**
 * Expand compact bus data to full field names
 * Supports: {lat, lng}, {la, ln}, GeoJSON
 */
export function expandBusData(data) {
  if (!data) return null;

  const rawLat =
    data.lat ??
    data.la ??
    data.latitude ??
    data.location?.coordinates?.[1];   // GeoJSON lat

  const rawLng =
    data.lng ??
    data.ln ??
    data.longitude ??
    data.location?.coordinates?.[0];   // GeoJSON lng

  const lat = Number(rawLat);
  const lng = Number(rawLng);

  if (
    rawLat === "" || rawLng === "" ||
    rawLat == null || rawLng == null ||
    isNaN(lat) || isNaN(lng)
  ) {
    return null;
  }

  return {
    busId: data.busId ?? data.i ?? data._id,
    lat,
    lng,
    speed: data.speed ?? data.s,
    heading: data.heading ?? data.h,
    route: data.route ?? data.r,
    timestamp: data.timestamp ?? data.lastUpdate
  };
}

/**
 * Health check
 */
export async function healthCheck() {
  const url = `${API_BASE_URL.replace('/api', '')}/health`;
  return fetchWithRetry(url, {}, 3000, 1);
}

/**
 * Batch fetch multiple areas (for prefetching)
 */
export async function prefetchBuses(areas) {
  // areas = [{ lat, lng, radius }, ...]
  
  const promises = areas.map(area => 
    getNearbyBuses(area.lat, area.lng, area.radius, 30)
      .catch(err => {
        console.warn(`[Prefetch] Failed for area:`, area, err.message);
        return { buses: [] };
      })
  );
  
  const results = await Promise.all(promises);
  
  // Merge and deduplicate
  const busMap = new Map();
  results.forEach(result => {
    result.buses.forEach(bus => {
      busMap.set(bus.busId, bus);
    });
  });
  
  return Array.from(busMap.values());
}

/**
 * Calculate distance between two points (haversine)
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => deg * (Math.PI / 180);
  
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Sort buses by distance from user
 */
export function sortByDistance(buses, userLat, userLng) {
  return buses
    .map(bus => ({
      ...bus,
      distance: calculateDistance(userLat, userLng, bus.lat, bus.lng)
    }))
    .sort((a, b) => a.distance - b.distance);
}

// Default export
export default {
  getNearbyBuses,
  getBusesInBounds,
  getBusById,
  createBusStream,
  healthCheck,
  prefetchBuses,
  calculateDistance,
  sortByDistance
};
