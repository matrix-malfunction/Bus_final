import { useEffect, useRef, useCallback, useState } from 'react';
import { useBusStore } from '../store/busStore';

/**
 * Viewport-based bus tracking with culling
 * Only sends buses that are (or will be) visible in the map viewport
 */

// Movement threshold (~2 meters)
const MIN_MOVEMENT_THRESHOLD = 0.00002;
// Time threshold (300ms)
const MIN_TIME_THRESHOLD = 300;
// Max buses to track
const MAX_TRACKED_BUSES = 100;

// Haversine distance in meters
const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Check if point is in bounds (with 50% buffer for smooth panning)
const isInBounds = (lat, lng, bounds, buffer = 0.5) => {
  if (!bounds) return true;
  
  const latRange = bounds.north - bounds.south;
  const lngRange = bounds.east - bounds.west;
  
  const bufferedNorth = bounds.north + latRange * buffer;
  const bufferedSouth = bounds.south - latRange * buffer;
  const bufferedEast = bounds.east + lngRange * buffer;
  const bufferedWest = bounds.west - lngRange * buffer;
  
  return lat <= bufferedNorth && 
         lat >= bufferedSouth && 
         lng <= bufferedEast && 
         lng >= bufferedWest;
};

export const useViewportBusTracking = (
  webViewRef, 
  webViewReady, 
  userLocation,
  viewportBounds // { north, south, east, west }
) => {
  const { buses } = useBusStore();
  const [stats, setStats] = useState({
    totalBuses: 0,
    inViewport: 0,
    inBuffer: 0,
    offscreen: 0,
    sent: 0,
  });

  // Refs for tracking
  const lastStateRef = useRef(new Map()); // busId -> { lat, lng, lastUpdate }
  const pendingUpdatesRef = useRef([]);
  const batchTimerRef = useRef(null);
  const seqRef = useRef(0);

  // Get priority based on distance from user
  const getPriority = useCallback((bus) => {
    if (!userLocation?.latitude) return 1;
    
    const dist = getDistanceMeters(
      userLocation.latitude,
      userLocation.longitude,
      Number(bus.lat ?? bus.latitude),
      Number(bus.lng ?? bus.longitude)
    );
    
    if (dist < 2000) return 0; // High: <2km
    if (dist < 5000) return 1; // Medium: <5km
    return 2; // Low: >5km
  }, [userLocation]);

  // Flush batch to WebView
  const flushBatch = useCallback(() => {
    if (!webViewRef.current || !webViewReady) return;
    if (pendingUpdatesRef.current.length === 0) return;

    const batch = {
      t: 'u',
      s: ++seqRef.current,
      u: pendingUpdatesRef.current,
      ts: Date.now(),
    };

    // Use postMessage (preferred) or injectJavaScript
    if (webViewRef.current.postMessage) {
      webViewRef.current.postMessage(JSON.stringify(batch));
    } else {
      webViewRef.current.injectJavaScript(
        `window.postMessage(${JSON.stringify(batch)}, '*'); true;`
      );
    }

    console.log(
      `[VIEWPORT] Batch #${batch.s}: ${batch.u.length} buses, ` +
      `${JSON.stringify(batch).length} bytes`
    );

    pendingUpdatesRef.current = [];
    batchTimerRef.current = null;
  }, [webViewRef, webViewReady]);

  // Schedule batch (250ms window)
  const scheduleBatch = useCallback(() => {
    if (batchTimerRef.current) return;
    
    batchTimerRef.current = setTimeout(() => {
      flushBatch();
    }, 250);
  }, [flushBatch]);

  // Main filtering and batching effect
  useEffect(() => {
    if (!webViewReady) return;

    const now = Date.now();
    const currentMap = new Map();
    const toSend = [];

    let inViewport = 0;
    let inBuffer = 0;
    let offscreen = 0;

    // Process all buses
    buses.forEach((bus) => {
      const id = bus.busId;
      const lat = Number(bus.lat ?? bus.latitude);
      const lng = Number(bus.lng ?? bus.longitude);
      
      if (!id || isNaN(lat) || isNaN(lng)) return;

      const priority = getPriority(bus);
      const distanceFromUser = userLocation ? 
        getDistanceMeters(userLocation.latitude, userLocation.longitude, lat, lng) : 
        Infinity;

      // Check viewport location
      const inView = isInBounds(lat, lng, viewportBounds, 0);
      const inBufferedArea = isInBounds(lat, lng, viewportBounds, 0.5);

      // Categorize
      if (inView) inViewport++;
      else if (inBufferedArea) inBuffer++;
      else offscreen++;

      // Decide whether to include this bus
      let shouldInclude = false;

      // Always include if in viewport
      if (inView) {
        shouldInclude = true;
      }
      // Include if in buffer zone AND high priority (near user)
      else if (inBufferedArea && priority === 0) {
        shouldInclude = true;
      }
      // Include if high priority even if offscreen (user might pan there)
      else if (priority === 0 && distanceFromUser < 1000) {
        shouldInclude = true;
      }

      if (!shouldInclude) return;

      // Check for meaningful change
      const prev = lastStateRef.current.get(id);
      
      if (!prev) {
        // New bus - include
        toSend.push({
          i: id,
          la: lat,
          ln: lng,
          p: priority,
        });
        lastStateRef.current.set(id, { lat, lng, lastUpdate: now });
      } else {
        // Check movement
        const dLat = Math.abs(prev.lat - lat);
        const dLng = Math.abs(prev.lng - lng);

        if (dLat > MIN_MOVEMENT_THRESHOLD || dLng > MIN_MOVEMENT_THRESHOLD) {
          // Check time throttle
          const timeSinceUpdate = now - prev.lastUpdate;
          
          if (timeSinceUpdate >= MIN_TIME_THRESHOLD) {
            toSend.push({
              i: id,
              la: lat,
              ln: lng,
              p: priority,
            });
            lastStateRef.current.set(id, { lat, lng, lastUpdate: now });
          } else {
            // Update stored position but don't send yet (merging)
            lastStateRef.current.set(id, { lat, lng, lastUpdate: prev.lastUpdate });
          }
        }
      }

      currentMap.set(id, true);
    });

    // Remove buses that no longer exist
    const toRemove = [];
    lastStateRef.current.forEach((_, id) => {
      if (!currentMap.has(id)) {
        toRemove.push(id);
        lastStateRef.current.delete(id);
      }
    });

    // Update stats
    setStats({
      totalBuses: buses.length,
      inViewport,
      inBuffer,
      offscreen,
      sent: toSend.length,
    });

    // Add to pending batch
    if (toSend.length > 0 || toRemove.length > 0) {
      pendingUpdatesRef.current.push(...toSend);
      
      // Flush immediately if batch is large
      if (pendingUpdatesRef.current.length >= 20) {
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
          batchTimerRef.current = null;
        }
        flushBatch();
      } else {
        scheduleBatch();
      }
    }

  }, [buses, viewportBounds, webViewReady, getPriority, flushBatch, scheduleBatch]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
      lastStateRef.current.clear();
    };
  }, []);

  return {
    stats,
    lastSeq: seqRef.current,
  };
};

export default useViewportBusTracking;
