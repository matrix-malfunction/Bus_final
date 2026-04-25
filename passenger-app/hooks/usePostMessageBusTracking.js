import { useEffect, useRef, useCallback } from 'react';
import { useBusStore } from '../store/busStore';

// Configuration
const BATCH_INTERVAL = 250; // ms - batch window
const MAX_BATCH_SIZE = 20; // Max buses per batch
const MOVEMENT_THRESHOLD = 0.00001; // ~1 meter

// Haversine distance
const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const usePostMessageBusTracking = (webViewRef, webViewReady, userLocation) => {
  const { buses } = useBusStore();
  
  // Batching refs
  const pendingUpdatesRef = useRef([]);
  const pendingRemovalsRef = useRef(new Set());
  const lastStateRef = useRef(new Map());
  const batchTimerRef = useRef(null);
  const seqNumRef = useRef(0);

  // Get priority based on distance
  const getPriority = useCallback((bus) => {
    if (!userLocation?.latitude) return 1;
    
    const dist = getDistanceMeters(
      userLocation.latitude,
      userLocation.longitude,
      Number(bus.lat ?? bus.latitude),
      Number(bus.lng ?? bus.longitude)
    );
    
    if (dist < 2000) return 0;
    if (dist < 5000) return 1;
    return 2;
  }, [userLocation]);

  // Build minimal payload
  const toPayload = useCallback((bus, priority) => ({
    i: bus.busId,           // id (short key)
    la: Number(bus.lat ?? bus.latitude),  // lat (short key)
    ln: Number(bus.lng ?? bus.longitude), // lng (short key)
    p: priority,            // priority (short key)
    s: Math.round(bus.calculatedSpeed || 0), // speed (optional)
  }), []);

  // Flush batch to WebView
  const flushBatch = useCallback(() => {
    if (!webViewRef.current || !webViewReady) return;
    if (pendingUpdatesRef.current.length === 0 && pendingRemovalsRef.current.size === 0) return;

    const batch = {
      t: 'u',                    // type: update (short)
      s: ++seqNumRef.current,    // sequence number
      u: pendingUpdatesRef.current,  // updates (short key)
      r: Array.from(pendingRemovalsRef.current), // removals
      ts: Date.now(),            // timestamp
    };

    // Use postMessage - MUCH faster than injectJavaScript
    webViewRef.current.postMessage(JSON.stringify(batch));

    console.log(
      `[POST] Batch #${batch.s}: +${batch.u.length} -${batch.r.length}, ` +
      `${JSON.stringify(batch).length} bytes`
    );

    // Clear pending
    pendingUpdatesRef.current = [];
    pendingRemovalsRef.current.clear();
    batchTimerRef.current = null;
  }, [webViewRef, webViewReady]);

  // Schedule batch
  const scheduleBatch = useCallback(() => {
    if (batchTimerRef.current) return; // Already scheduled
    
    batchTimerRef.current = setTimeout(() => {
      flushBatch();
    }, BATCH_INTERVAL);
  }, [flushBatch]);

  // Main diff effect
  useEffect(() => {
    if (!webViewReady) return;

    const currentMap = new Map();
    const priorityMap = new Map();

    // Build current state with priorities
    buses.forEach((bus) => {
      const id = bus.busId;
      const lat = Number(bus.lat ?? bus.latitude);
      const lng = Number(bus.lng ?? bus.longitude);
      
      if (!id || isNaN(lat) || isNaN(lng)) return;
      
      const priority = getPriority(bus);
      currentMap.set(id, { lat, lng, priority });
      priorityMap.set(id, priority);
    });

    // Limit to 50 buses by priority
    const sorted = Array.from(currentMap.entries())
      .sort(([,a], [,b]) => a.priority - b.priority)
      .slice(0, 50);
    
    const limitedMap = new Map(sorted);

    // Detect changes
    limitedMap.forEach((data, id) => {
      const prev = lastStateRef.current.get(id);
      
      if (!prev) {
        // New bus
        const bus = buses.find(b => b.busId === id);
        pendingUpdatesRef.current.push(toPayload(bus, data.priority));
        lastStateRef.current.set(id, { lat: data.lat, lng: data.lng });
      } else {
        const dLat = Math.abs(prev.lat - data.lat);
        const dLng = Math.abs(prev.lng - data.lng);
        
        if (dLat > MOVEMENT_THRESHOLD || dLng > MOVEMENT_THRESHOLD) {
          const bus = buses.find(b => b.busId === id);
          pendingUpdatesRef.current.push(toPayload(bus, data.priority));
          lastStateRef.current.set(id, { lat: data.lat, lng: data.lng });
        }
      }
    });

    // Detect removals
    lastStateRef.current.forEach((_, id) => {
      if (!limitedMap.has(id)) {
        pendingRemovalsRef.current.add(id);
        lastStateRef.current.delete(id);
      }
    });

    // Flush immediately if batch full, else schedule
    if (pendingUpdatesRef.current.length >= MAX_BATCH_SIZE) {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      flushBatch();
    } else if (pendingUpdatesRef.current.length > 0 || pendingRemovalsRef.current.size > 0) {
      scheduleBatch();
    }

  }, [buses, webViewReady, getPriority, toPayload, flushBatch, scheduleBatch]);

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
    pendingCount: pendingUpdatesRef.current.length + pendingRemovalsRef.current.size,
    lastSeq: seqNumRef.current,
  };
};
