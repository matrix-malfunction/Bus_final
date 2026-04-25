import { useEffect, useRef, useCallback, useState } from 'react';
import { useBusStore } from '../store/busStore';

/**
 * Adaptive bus tracking with dynamic throttling
 * Adjusts update frequency based on system load, bus count, and performance metrics
 */

// Adaptive configuration
const CONFIG = {
  // Base intervals (ms)
  MIN_INTERVAL: 100,    // Fastest: 100ms (10 updates/sec) - for <10 buses
  DEFAULT_INTERVAL: 250, // Normal: 250ms (4 updates/sec) - for 10-50 buses
  SLOW_INTERVAL: 500,   // Slow: 500ms (2 updates/sec) - for 50-80 buses
  VERY_SLOW_INTERVAL: 1000, // Very slow: 1s (1 update/sec) - for 80+ buses
  
  // Performance thresholds
  FPS_THRESHOLD_GOOD: 55,
  FPS_THRESHOLD_WARNING: 40,
  FPS_THRESHOLD_CRITICAL: 30,
  
  LATENCY_THRESHOLD_GOOD: 30,
  LATENCY_THRESHOLD_WARNING: 80,
  LATENCY_THRESHOLD_CRITICAL: 150,
  
  // Bus count thresholds
  BUS_COUNT_LOW: 10,
  BUS_COUNT_MEDIUM: 50,
  BUS_COUNT_HIGH: 80,
  BUS_COUNT_CRITICAL: 100,
  
  // Adjustment rates
  INCREASE_INTERVAL_STEP: 50,  // Add 50ms when stressed
  DECREASE_INTERVAL_STEP: 25,  // Remove 25ms when idle
  MAX_INTERVAL: 2000,          // Never go above 2s
  MIN_INTERVAL: 100,           // Never go below 100ms
  
  // Idle detection
  IDLE_TIME_THRESHOLD: 3000, // 3 seconds no updates = idle
};

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

export const useAdaptiveBusTracking = (
  webViewRef,
  webViewReady,
  userLocation,
  onMetricsUpdate // Callback to report metrics
) => {
  const { buses } = useBusStore();
  
  // Adaptive state
  const [adaptiveState, setAdaptiveState] = useState({
    currentInterval: CONFIG.DEFAULT_INTERVAL,
    targetInterval: CONFIG.DEFAULT_INTERVAL,
    systemLoad: 'NORMAL', // NORMAL | STRESSED | CRITICAL | IDLE
    busCount: 0,
    fps: 60,
    latency: 0,
    reason: 'init',
  });

  // Refs for tracking
  const intervalRef = useRef(CONFIG.DEFAULT_INTERVAL);
  const lastUpdateRef = useRef(Date.now());
  const latencyHistoryRef = useRef([]);
  const fpsHistoryRef = useRef([]);
  const pendingBatchRef = useRef([]);
  const lastStateRef = useRef(new Map());
  const batchTimerRef = useRef(null);
  const seqRef = useRef(0);
  const isIdleRef = useRef(false);

  // Calculate base interval from bus count
  const getBaseIntervalFromBusCount = useCallback((count) => {
    if (count <= CONFIG.BUS_COUNT_LOW) return CONFIG.MIN_INTERVAL;
    if (count <= CONFIG.BUS_COUNT_MEDIUM) return CONFIG.DEFAULT_INTERVAL;
    if (count <= CONFIG.BUS_COUNT_HIGH) return CONFIG.SLOW_INTERVAL;
    if (count <= CONFIG.BUS_COUNT_CRITICAL) return CONFIG.VERY_SLOW_INTERVAL;
    return CONFIG.MAX_INTERVAL;
  }, []);

  // Calculate adaptive interval based on performance
  const calculateAdaptiveInterval = useCallback(() => {
    const busCount = buses.length;
    const baseInterval = getBaseIntervalFromBusCount(busCount);
    
    // Get recent metrics
    const recentLatencies = latencyHistoryRef.current.slice(-5);
    const avgLatency = recentLatencies.length > 0
      ? recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
      : 0;
    
    const recentFps = fpsHistoryRef.current.slice(-10);
    const avgFps = recentFps.length > 0
      ? recentFps.reduce((a, b) => a + b, 0) / recentFps.length
      : 60;

    let adjustedInterval = baseInterval;
    let load = 'NORMAL';
    let reason = `base(${busCount} buses)`;

    // Check if idle (no updates for 3s)
    const timeSinceLastUpdate = Date.now() - lastUpdateRef.current;
    if (timeSinceLastUpdate > CONFIG.IDLE_TIME_THRESHOLD && busCount < 30) {
      // Can go faster when idle
      adjustedInterval = Math.max(CONFIG.MIN_INTERVAL, adjustedInterval - 100);
      load = 'IDLE';
      reason = 'idle';
      isIdleRef.current = true;
    } else {
      isIdleRef.current = false;
    }

    // Adjust based on FPS
    if (avgFps < CONFIG.FPS_THRESHOLD_CRITICAL) {
      // Critical - slow down significantly
      adjustedInterval = Math.min(
        CONFIG.MAX_INTERVAL,
        adjustedInterval + CONFIG.INCREASE_INTERVAL_STEP * 4
      );
      load = 'CRITICAL';
      reason = `critical fps(${avgFps.toFixed(1)})`;
    } else if (avgFps < CONFIG.FPS_THRESHOLD_WARNING) {
      // Warning - slow down
      adjustedInterval = Math.min(
        CONFIG.MAX_INTERVAL,
        adjustedInterval + CONFIG.INCREASE_INTERVAL_STEP * 2
      );
      load = 'STRESSED';
      reason = `low fps(${avgFps.toFixed(1)})`;
    } else if (avgFps > CONFIG.FPS_THRESHOLD_GOOD && !isIdleRef.current) {
      // Good FPS - can speed up slightly if not at min
      if (adjustedInterval > baseInterval) {
        adjustedInterval = Math.max(
          baseInterval,
          adjustedInterval - CONFIG.DECREASE_INTERVAL_STEP
        );
        reason = `good fps(${avgFps.toFixed(1)}) recovering`;
      }
    }

    // Adjust based on latency
    if (avgLatency > CONFIG.LATENCY_THRESHOLD_CRITICAL) {
      adjustedInterval = Math.min(
        CONFIG.MAX_INTERVAL,
        adjustedInterval + CONFIG.INCREASE_INTERVAL_STEP * 3
      );
      load = load === 'CRITICAL' ? 'CRITICAL' : 'STRESSED';
      reason = `critical latency(${avgLatency.toFixed(0)}ms)`;
    } else if (avgLatency > CONFIG.LATENCY_THRESHOLD_WARNING) {
      adjustedInterval = Math.min(
        CONFIG.MAX_INTERVAL,
        adjustedInterval + CONFIG.INCREASE_INTERVAL_STEP
      );
      load = load === 'NORMAL' ? 'STRESSED' : load;
      reason = `high latency(${avgLatency.toFixed(0)}ms)`;
    } else if (avgLatency < CONFIG.LATENCY_THRESHOLD_GOOD && avgFps > CONFIG.FPS_THRESHOLD_GOOD) {
      // Low latency and good FPS - can speed up
      if (adjustedInterval > baseInterval && !isIdleRef.current) {
        adjustedInterval = Math.max(
          baseInterval,
          adjustedInterval - CONFIG.DECREASE_INTERVAL_STEP
        );
        reason = `optimal(${avgLatency.toFixed(0)}ms, ${avgFps.toFixed(1)}fps)`;
      }
    }

    // Clamp to valid range
    adjustedInterval = Math.max(
      CONFIG.MIN_INTERVAL,
      Math.min(CONFIG.MAX_INTERVAL, adjustedInterval)
    );

    return {
      interval: Math.round(adjustedInterval),
      load,
      reason,
      metrics: { fps: avgFps, latency: avgLatency, busCount },
    };
  }, [buses.length, getBaseIntervalFromBusCount]);

  // Record performance metrics
  const recordMetrics = useCallback((fps, latency) => {
    if (fps) {
      fpsHistoryRef.current.push(fps);
      if (fpsHistoryRef.current.length > 20) fpsHistoryRef.current.shift();
    }
    if (latency) {
      latencyHistoryRef.current.push(latency);
      if (latencyHistoryRef.current.length > 10) latencyHistoryRef.current.shift();
    }
  }, []);

  // Flush batch to WebView
  const flushBatch = useCallback(() => {
    if (!webViewRef.current || !webViewReady) return;
    if (pendingBatchRef.current.length === 0) return;

    const startTime = performance.now();
    
    const batch = {
      t: 'u',
      s: ++seqRef.current,
      u: pendingBatchRef.current,
      ts: Date.now(),
    };

    webViewRef.current.postMessage(JSON.stringify(batch));
    
    const latency = performance.now() - startTime;
    recordMetrics(null, latency);

    lastUpdateRef.current = Date.now();
    pendingBatchRef.current = [];
    batchTimerRef.current = null;
  }, [webViewRef, webViewReady, recordMetrics]);

  // Schedule next batch with adaptive interval
  const scheduleBatch = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
    }
    
    const { interval, load, reason, metrics } = calculateAdaptiveInterval();
    
    // Update state if changed significantly (>50ms)
    if (Math.abs(interval - intervalRef.current) > 50) {
      intervalRef.current = interval;
      setAdaptiveState({
        currentInterval: interval,
        targetInterval: interval,
        systemLoad: load,
        busCount: metrics.busCount,
        fps: metrics.fps,
        latency: metrics.latency,
        reason,
      });
      
      console.log(
        `[ADAPTIVE] Interval: ${interval}ms (${load}) - ${reason}`
      );
      
      if (onMetricsUpdate) {
        onMetricsUpdate({
          interval,
          load,
          reason,
          ...metrics,
        });
      }
    }
    
    batchTimerRef.current = setTimeout(() => {
      flushBatch();
    }, interval);
  }, [calculateAdaptiveInterval, flushBatch, onMetricsUpdate]);

  // Main update effect
  useEffect(() => {
    if (!webViewReady) return;

    const now = Date.now();
    const updates = [];

    buses.forEach((bus) => {
      const id = bus.busId;
      const lat = Number(bus.lat ?? bus.latitude);
      const lng = Number(bus.lng ?? bus.longitude);
      
      if (!id || isNaN(lat) || isNaN(lng)) return;

      // Get priority
      let priority = 1;
      if (userLocation) {
        const dist = getDistanceMeters(
          userLocation.latitude,
          userLocation.longitude,
          lat,
          lng
        );
        priority = dist < 2000 ? 0 : dist < 5000 ? 1 : 2;
      }

      const prev = lastStateRef.current.get(id);
      
      if (!prev) {
        updates.push({ i: id, la: lat, ln: lng, p: priority });
        lastStateRef.current.set(id, { lat, lng, lastUpdate: now });
      } else {
        const dLat = Math.abs(prev.lat - lat);
        const dLng = Math.abs(prev.lng - lng);
        
        if (dLat > 0.00002 || dLng > 0.00002) {
          updates.push({ i: id, la: lat, ln: lng, p: priority });
          lastStateRef.current.set(id, { lat, lng, lastUpdate: now });
        }
      }
    });

    // Cleanup removed
    lastStateRef.current.forEach((_, id) => {
      if (!buses.find(b => b.busId === id)) {
        lastStateRef.current.delete(id);
      }
    });

    if (updates.length > 0) {
      pendingBatchRef.current.push(...updates);
      
      // Flush immediately if buffer large, else schedule
      if (pendingBatchRef.current.length >= 20) {
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
          batchTimerRef.current = null;
        }
        flushBatch();
      } else {
        scheduleBatch();
      }
    }
  }, [buses, webViewReady, userLocation, flushBatch, scheduleBatch]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, []);

  return {
    adaptiveState,
    recordMetrics,
    currentInterval: intervalRef.current,
  };
};

export default useAdaptiveBusTracking;
