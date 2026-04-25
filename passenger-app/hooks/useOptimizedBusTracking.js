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

// Movement threshold (~1 meter)
const MIN_MOVEMENT_THRESHOLD = 0.00001;

export const useOptimizedBusTracking = (webViewRef, webViewReady) => {
  const { buses } = useBusStore();
  const prevBusesRef = useRef(new Map());
  const bridgeLatencyRef = useRef([]);

  // Minimal payload - only essential fields
  const toPayload = useCallback((bus) => ({
    id: bus.busId,
    lat: Number(bus.lat ?? bus.latitude),
    lng: Number(bus.lng ?? bus.longitude),
    speed: bus.calculatedSpeed,
    eta: bus.calculatedEtaMinutes
  }), []);

  // Throttled injection with latency tracking
  const throttledInject = useRef(
    throttle((payload) => {
      if (!webViewRef.current || !webViewReady) return;

      const json = JSON.stringify(payload);
      const sizeKB = (json.length / 1024).toFixed(2);
      const startTime = performance.now();

      console.log(`[BRIDGE] Payload: ${sizeKB}KB, +${payload.updated.length} -${payload.removed.length}`);

      webViewRef.current.injectJavaScript(`
        (function() {
          const start = performance.now();
          if (window.updateBusMarkers) {
            window.updateBusMarkers(${json});
          }
          return performance.now() - start;
        })()
      `);

      // Track bridge latency
      const latency = performance.now() - startTime;
      bridgeLatencyRef.current.push(latency);
      if (bridgeLatencyRef.current.length > 10) {
        bridgeLatencyRef.current.shift();
      }

      const avgLatency = bridgeLatencyRef.current.reduce((a, b) => a + b, 0) / bridgeLatencyRef.current.length;
      if (avgLatency > 50) {
        console.warn(`[BRIDGE] Slow latency: ${avgLatency.toFixed(1)}ms avg`);
      }
    }, 300) // 300ms throttle
  ).current;

  // Optimized diff-based update effect
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;

    const currentMap = new Map();
    const updated = [];
    const removed = [];

    // Build current state (validate + filter)
    buses.forEach(bus => {
      const id = bus.busId;
      const lat = Number(bus.lat ?? bus.latitude);
      const lng = Number(bus.lng ?? bus.longitude);

      if (!id || isNaN(lat) || isNaN(lng)) return;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

      currentMap.set(id, { id, lat, lng, bus });
    });

    // Detect meaningful changes only
    currentMap.forEach((data, id) => {
      const prev = prevBusesRef.current.get(id);

      if (!prev) {
        // New bus
        updated.push(toPayload(data.bus));
        prevBusesRef.current.set(id, { lat: data.lat, lng: data.lng });
      } else {
        const dLat = Math.abs(prev.lat - data.lat);
        const dLng = Math.abs(prev.lng - data.lng);

        // Only update if moved > ~1 meter
        if (dLat > MIN_MOVEMENT_THRESHOLD || dLng > MIN_MOVEMENT_THRESHOLD) {
          updated.push(toPayload(data.bus));
          prevBusesRef.current.set(id, { lat: data.lat, lng: data.lng });
        }
      }
    });

    // Detect removed buses
    prevBusesRef.current.forEach((_, id) => {
      if (!currentMap.has(id)) {
        removed.push(id);
        prevBusesRef.current.delete(id);
      }
    });

    // Skip if no changes
    if (updated.length === 0 && removed.length === 0) {
      return;
    }

    // Send throttled update
    throttledInject({ updated, removed });

  }, [buses, webViewReady, throttledInject, toPayload]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      prevBusesRef.current.clear();
      bridgeLatencyRef.current = [];
    };
  }, []);

  return {
    activeCount: buses.length,
    lastLatency: bridgeLatencyRef.current[bridgeLatencyRef.current.length - 1] || 0
  };
};
