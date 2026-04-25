import { useEffect, useRef, useCallback } from 'react';
import { useBusStore } from '../store/busStore';

// Backpressure configuration
const MAX_QUEUE_SIZE = 2; // Max 2 batches in queue
const BRIDGE_TIMEOUT = 100; // ms - consider bridge stuck if no response
const DROP_STALE_AFTER = 500; // ms - drop updates older than this

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

export const useBackpressureBusTracking = (webViewRef, webViewReady, userLocation) => {
  const { buses } = useBusStore();
  
  // Backpressure state
  const isProcessingRef = useRef(false);
  const updateQueueRef = useRef([]);
  const lastSentStateRef = useRef(new Map());
  const pendingAckRef = useRef(null);
  const droppedCountRef = useRef(0);
  const statsRef = useRef({
    totalSent: 0,
    totalDropped: 0,
    avgQueueDepth: 0,
    maxQueueDepth: 0,
  });

  // Priority calculation
  const getPriority = useCallback((bus) => {
    if (!userLocation?.latitude || !userLocation?.longitude) return 1;
    
    const distance = getDistanceMeters(
      userLocation.latitude,
      userLocation.longitude,
      Number(bus.lat ?? bus.latitude),
      Number(bus.lng ?? bus.longitude)
    );
    
    if (distance < 2000) return 0; // High: <2km
    if (distance < 5000) return 1; // Medium: <5km
    return 2; // Low: >5km
  }, [userLocation]);

  // Create minimal payload
  const toPayload = useCallback((bus) => ({
    id: bus.busId,
    lat: Number(bus.lat ?? bus.latitude),
    lng: Number(bus.lng ?? bus.longitude),
    priority: getPriority(bus),
  }), [getPriority]);

  // Build current state diff
  const buildDiff = useCallback(() => {
    const currentMap = new Map();
    const updated = [];
    const removed = [];
    const now = Date.now();

    // Build current state
    buses.forEach((bus) => {
      const id = bus.busId;
      const lat = Number(bus.lat ?? bus.latitude);
      const lng = Number(bus.lng ?? bus.longitude);

      if (!id || isNaN(lat) || isNaN(lng)) return;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

      currentMap.set(id, { id, lat, lng, priority: getPriority(bus) });
    });

    // Max 50 markers - sort by priority then take top
    const sortedBuses = Array.from(currentMap.values())
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 50);
    
    const limitedMap = new Map(sortedBuses.map(b => [b.id, b]));

    // Detect changes
    limitedMap.forEach((data, id) => {
      const prev = lastSentStateRef.current.get(id);
      
      if (!prev) {
        updated.push(toPayload(buses.find(b => b.busId === id)));
      } else {
        const dLat = Math.abs(prev.lat - data.lat);
        const dLng = Math.abs(prev.lng - data.lng);
        
        // Movement threshold ~1m
        if (dLat > 0.00001 || dLng > 0.00001) {
          updated.push(toPayload(buses.find(b => b.busId === id)));
        }
      }
    });

    // Detect removed
    lastSentStateRef.current.forEach((_, id) => {
      if (!limitedMap.has(id)) {
        removed.push(id);
      }
    });

    return { updated, removed, timestamp: now, busCount: limitedMap.size };
  }, [buses, getPriority, toPayload]);

  // Send to WebView with backpressure
  const sendToWebView = useCallback((batch) => {
    if (!webViewRef.current || !webViewReady) return false;

    const json = JSON.stringify(batch);
    const sizeKB = (json.length / 1024).toFixed(2);

    console.log(
      `[BRIDGE] Sending: ${batch.updated.length} updated, ${batch.removed.length} removed, ${sizeKB}KB, queue: ${updateQueueRef.current.length}`
    );

    // Mark as processing
    isProcessingRef.current = true;
    pendingAckRef.current = batch.timestamp;

    // Send with ACK mechanism
    webViewRef.current.injectJavaScript(`
      (function() {
        const start = performance.now();
        window.__lastBatchId = ${batch.timestamp};
        
        if (window.updateBusMarkers) {
          window.updateBusMarkers(${json});
        }
        
        // Return processing time for latency tracking
        return JSON.stringify({
          ack: ${batch.timestamp},
          processingTime: Math.round(performance.now() - start)
        });
      })()
    `);

    // Update last sent state
    batch.updated.forEach((bus) => {
      lastSentStateRef.current.set(bus.id, { lat: bus.lat, lng: bus.lng });
    });
    batch.removed.forEach((id) => lastSentStateRef.current.delete(id));

    statsRef.current.totalSent++;
    
    return true;
  }, [webViewRef, webViewReady]);

  // Process queue with backpressure
  const processQueue = useCallback(() => {
    // Drop if currently processing
    if (isProcessingRef.current) {
      return;
    }

    // Get latest batch from queue (discard older ones - keep only last 2)
    while (updateQueueRef.current.length > MAX_QUEUE_SIZE) {
      const dropped = updateQueueRef.current.shift();
      droppedCountRef.current++;
      statsRef.current.totalDropped++;
      console.log(`[BACKPRESSURE] Dropped stale batch (age: ${Date.now() - dropped.timestamp}ms)`);
    }

    if (updateQueueRef.current.length === 0) return;

    // Take oldest batch (FIFO, but we keep only latest 2)
    const batch = updateQueueRef.current.shift();
    
    // Check if batch is too old
    const age = Date.now() - batch.timestamp;
    if (age > DROP_STALE_AFTER) {
      console.log(`[BACKPRESSURE] Skipped stale batch (age: ${age}ms)`);
      statsRef.current.totalDropped++;
      processQueue(); // Try next
      return;
    }

    sendToWebView(batch);
  }, [sendToWebView]);

  // Ack handler from WebView
  const handleAck = useCallback((ackId) => {
    if (pendingAckRef.current === ackId) {
      isProcessingRef.current = false;
      pendingAckRef.current = null;
      
      // Process next in queue
      processQueue();
    }
  }, [processQueue]);

  // Main update effect
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;

    const diff = buildDiff();
    
    // Skip if no changes
    if (diff.updated.length === 0 && diff.removed.length === 0) {
      return;
    }

    // Add to queue
    updateQueueRef.current.push(diff);

    // Track max queue depth
    const depth = updateQueueRef.current.length;
    if (depth > statsRef.current.maxQueueDepth) {
      statsRef.current.maxQueueDepth = depth;
    }

    // If queue exceeds max, drop oldest (keep newest)
    if (updateQueueRef.current.length > MAX_QUEUE_SIZE) {
      const dropped = updateQueueRef.current.shift();
      droppedCountRef.current++;
      statsRef.current.totalDropped++;
      console.log(`[BACKPRESSURE] Queue full, dropped oldest batch`);
    }

    // Try to process immediately if not busy
    processQueue();

  }, [buses, webViewReady, buildDiff, processQueue]);

  // Watchdog: Reset stuck processing state
  useEffect(() => {
    const interval = setInterval(() => {
      if (isProcessingRef.current && pendingAckRef.current) {
        const stuckTime = Date.now() - pendingAckRef.current;
        if (stuckTime > 1000) {
          console.warn(`[BACKPRESSURE] Bridge stuck for ${stuckTime}ms, resetting`);
          isProcessingRef.current = false;
          pendingAckRef.current = null;
          processQueue();
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [processQueue]);

  // Cleanup
  useEffect(() => {
    return () => {
      updateQueueRef.current = [];
      lastSentStateRef.current.clear();
      isProcessingRef.current = false;
    };
  }, []);

  // Stats
  const stats = {
    queueDepth: updateQueueRef.current.length,
    isProcessing: isProcessingRef.current,
    droppedBatches: droppedCountRef.current,
    totalSent: statsRef.current.totalSent,
    maxQueueDepth: statsRef.current.maxQueueDepth,
    activeBuses: buses.length,
    handleAck,
  };

  return stats;
};
