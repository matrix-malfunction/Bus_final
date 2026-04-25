import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useBusStore } from '../store/busStore';

// Throttle helper
const throttle = (fn, ms) => {
  let last = 0;
  let timeout;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, ms - (now - last));
    }
  };
};

// Constants
const MIN_MOVEMENT_THRESHOLD = 0.00001; // ~1 meter
const MAX_MARKERS = 50;
const REALTIME_BUSES = 10; // Always real-time for nearest 10
const HIGH_PRIORITY_RADIUS = 2000; // 2km - high priority zone
const MEDIUM_PRIORITY_RADIUS = 5000; // 5km - medium priority

// Haversine distance in meters
const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const usePriorityBusTracking = (webViewRef, webViewReady, userLocation) => {
  const { buses } = useBusStore();
  const prevBusesRef = useRef(new Map());
  const bridgeLatencyRef = useRef([]);
  const lastUpdateTimeRef = useRef(new Map()); // Track last update per bus

  // Priority throttles based on distance
  const getThrottleMs = (distance) => {
    if (distance < HIGH_PRIORITY_RADIUS) return 0; // Real-time (300ms base)
    if (distance < MEDIUM_PRIORITY_RADIUS) return 2000; // 2s for medium
    return 5000; // 5s for far
  };

  // Sort and filter buses by priority
  const getPriorityBuses = useCallback(() => {
    if (!userLocation?.latitude || !userLocation?.longitude) {
      // No user location - return first MAX_MARKERS
      return buses.slice(0, MAX_MARKERS).map((bus, index) => ({
        ...bus,
        priority: index < REALTIME_BUSES ? 0 : 1,
        distance: null,
        throttleMs: index < REALTIME_BUSES ? 0 : 5000,
      }));
    }

    // Calculate distances and sort
    const busesWithDistance = buses
      .map((bus) => {
        const lat = Number(bus.lat ?? bus.latitude);
        const lng = Number(bus.lng ?? bus.longitude);

        if (!bus.busId || isNaN(lat) || isNaN(lng)) return null;

        const distance = getDistanceMeters(
          userLocation.latitude,
          userLocation.longitude,
          lat,
          lng
        );

        return {
          ...bus,
          distance,
          priority: distance < HIGH_PRIORITY_RADIUS ? 0 : distance < MEDIUM_PRIORITY_RADIUS ? 1 : 2,
          throttleMs: getThrottleMs(distance),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    // Take top MAX_MARKERS
    return busesWithDistance.slice(0, MAX_MARKERS);
  }, [buses, userLocation]);

  // Minimal payload
  const toPayload = useCallback(
    (bus) => ({
      id: bus.busId,
      lat: Number(bus.lat ?? bus.latitude),
      lng: Number(bus.lng ?? bus.longitude),
      priority: bus.priority,
      distance: bus.distance ? Math.round(bus.distance) : null,
    }),
    []
  );

  // Throttled injection
  const throttledInject = useRef(
    throttle((payload) => {
      if (!webViewRef.current || !webViewReady) return;

      const json = JSON.stringify(payload);
      const sizeKB = (json.length / 1024).toFixed(2);
      const startTime = performance.now();

      console.log(
        `[BRIDGE] Payload: ${sizeKB}KB, +${payload.updated.length} -${payload.removed.length}, real-time: ${payload.realtimeCount || 0}`
      );

      webViewRef.current.injectJavaScript(`
        if (window.updateBusMarkers) {
          window.updateBusMarkers(${json});
        }
        true;
      `);

      const latency = performance.now() - startTime;
      bridgeLatencyRef.current.push(latency);
      if (bridgeLatencyRef.current.length > 10) {
        bridgeLatencyRef.current.shift();
      }

      const avgLatency =
        bridgeLatencyRef.current.reduce((a, b) => a + b, 0) /
        bridgeLatencyRef.current.length;
      if (avgLatency > 50) {
        console.warn(`[BRIDGE] Slow latency: ${avgLatency.toFixed(1)}ms avg`);
      }
    }, 300)
  ).current;

  // Main update effect with priority filtering
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;

    const priorityBuses = getPriorityBuses();
    const currentMap = new Map();
    const updated = [];
    const removed = [];
    let realtimeCount = 0;

    const now = Date.now();

    // Process each priority bus
    priorityBuses.forEach((bus) => {
      const id = bus.busId;
      const lat = Number(bus.lat ?? bus.latitude);
      const lng = Number(bus.lng ?? bus.longitude);

      currentMap.set(id, { id, lat, lng, bus });

      // Check throttle for this bus
      const lastUpdate = lastUpdateTimeRef.current.get(id) || 0;
      const timeSinceUpdate = now - lastUpdate;

      // Skip if throttled and not enough time passed
      if (timeSinceUpdate < bus.throttleMs) {
        return;
      }

      const prev = prevBusesRef.current.get(id);

      if (!prev) {
        // New bus - always add
        updated.push(toPayload(bus));
        prevBusesRef.current.set(id, { lat, lng, priority: bus.priority });
        lastUpdateTimeRef.current.set(id, now);
        if (bus.priority === 0) realtimeCount++;
      } else {
        // Check meaningful movement
        const dLat = Math.abs(prev.lat - lat);
        const dLng = Math.abs(prev.lng - lng);

        if (dLat > MIN_MOVEMENT_THRESHOLD || dLng > MIN_MOVEMENT_THRESHOLD) {
          updated.push(toPayload(bus));
          prevBusesRef.current.set(id, { lat, lng, priority: bus.priority });
          lastUpdateTimeRef.current.set(id, now);
          if (bus.priority === 0) realtimeCount++;
        }
      }
    });

    // Detect removed buses (not in priority list anymore)
    prevBusesRef.current.forEach((_, id) => {
      if (!currentMap.has(id)) {
        removed.push(id);
        prevBusesRef.current.delete(id);
        lastUpdateTimeRef.current.delete(id);
      }
    });

    // Skip if no changes
    if (updated.length === 0 && removed.length === 0) {
      return;
    }

    throttledInject({ updated, removed, realtimeCount });
  }, [buses, webViewReady, getPriorityBuses, throttledInject, toPayload]);

  // Cleanup
  useEffect(() => {
    return () => {
      prevBusesRef.current.clear();
      lastUpdateTimeRef.current.clear();
      bridgeLatencyRef.current = [];
    };
  }, []);

  const stats = useMemo(() => {
    const priorityBuses = getPriorityBuses();
    return {
      totalTracked: buses.length,
      activeMarkers: priorityBuses.length,
      realtimeCount: priorityBuses.filter((b) => b.priority === 0).length,
      throttledCount: priorityBuses.filter((b) => b.priority > 0).length,
      lastLatency: bridgeLatencyRef.current[bridgeLatencyRef.current.length - 1] || 0,
    };
  }, [buses, getPriorityBuses]);

  return stats;
};
