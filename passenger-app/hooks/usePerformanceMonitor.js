import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Performance Monitor for tracking system metrics under load
 */

export const usePerformanceMonitor = (isActive = true) => {
  const [metrics, setMetrics] = useState({
    // Frame metrics
    fps: 60,
    droppedFrames: 0,
    frameTime: 16,
    
    // Bridge metrics
    bridgeLatency: 0,
    bridgeThroughput: 0,
    avgPayloadSize: 0,
    
    // Memory metrics (if available)
    memoryUsed: 0,
    memoryTotal: 0,
    
    // Processing metrics
    updateProcessingTime: 0,
    markerCount: 0,
    
    // Status
    health: 'GOOD', // GOOD | WARNING | CRITICAL
    bottleneck: null,
  });

  // Refs for tracking
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const latencyHistoryRef = useRef([]);
  const processingTimeHistoryRef = useRef([]);
  const memoryHistoryRef = useRef([]);

  // Track frame rate
  useEffect(() => {
    if (!isActive) return;

    let rafId;
    let isActiveFlag = true;

    const measureFrame = () => {
      if (!isActiveFlag) return;

      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      
      frameCountRef.current++;
      
      // Check for dropped frame (> 33ms = missed 2 frames at 60fps)
      if (delta > 33) {
        const dropped = Math.floor(delta / 16) - 1;
        setMetrics(prev => ({
          ...prev,
          droppedFrames: prev.droppedFrames + Math.max(0, dropped),
        }));
      }

      lastFrameTimeRef.current = now;
      rafId = requestAnimationFrame(measureFrame);
    };

    rafId = requestAnimationFrame(measureFrame);

    // Calculate FPS every second
    const fpsInterval = setInterval(() => {
      const fps = frameCountRef.current;
      frameCountRef.current = 0;
      
      setMetrics(prev => ({
        ...prev,
        fps: Math.min(60, fps),
        frameTime: fps > 0 ? Math.round(1000 / fps) : 16,
      }));
    }, 1000);

    return () => {
      isActiveFlag = false;
      cancelAnimationFrame(rafId);
      clearInterval(fpsInterval);
    };
  }, [isActive]);

  // Track memory (if available)
  useEffect(() => {
    if (!isActive || !performance.memory) return;

    const memoryInterval = setInterval(() => {
      const memory = performance.memory;
      const usedMB = Math.round(memory.usedJSHeapSize / 1048576);
      const totalMB = Math.round(memory.totalJSHeapSize / 1048576);
      
      memoryHistoryRef.current.push(usedMB);
      if (memoryHistoryRef.current.length > 10) {
        memoryHistoryRef.current.shift();
      }

      setMetrics(prev => ({
        ...prev,
        memoryUsed: usedMB,
        memoryTotal: totalMB,
      }));
    }, 2000);

    return () => clearInterval(memoryInterval);
  }, [isActive]);

  // Record bridge latency
  const recordBridgeLatency = useCallback((latencyMs) => {
    latencyHistoryRef.current.push(latencyMs);
    if (latencyHistoryRef.current.length > 20) {
      latencyHistoryRef.current.shift();
    }

    const avg = latencyHistoryRef.current.reduce((a, b) => a + b, 0) / 
                latencyHistoryRef.current.length;
    
    setMetrics(prev => ({
      ...prev,
      bridgeLatency: Math.round(avg),
    }));
  }, []);

  // Record update processing time
  const recordProcessingTime = useCallback((timeMs, markerCount) => {
    processingTimeHistoryRef.current.push(timeMs);
    if (processingTimeHistoryRef.current.length > 10) {
      processingTimeHistoryRef.current.shift();
    }

    const avg = processingTimeHistoryRef.current.reduce((a, b) => a + b, 0) / 
                processingTimeHistoryRef.current.length;

    setMetrics(prev => ({
      ...prev,
      updateProcessingTime: Math.round(avg),
      markerCount,
    }));
  }, []);

  // Record payload size
  const recordPayload = useCallback((sizeBytes, count) => {
    setMetrics(prev => ({
      ...prev,
      avgPayloadSize: Math.round(sizeBytes / count),
      bridgeThroughput: Math.round((sizeBytes * 8) / 1000), // kbps
    }));
  }, []);

  // Analyze health
  useEffect(() => {
    const { fps, bridgeLatency, memoryUsed, updateProcessingTime, markerCount } = metrics;
    
    let health = 'GOOD';
    let bottleneck = null;

    // Determine health status
    if (fps < 30 || bridgeLatency > 100 || memoryUsed > 500 || updateProcessingTime > 50) {
      health = 'CRITICAL';
    } else if (fps < 55 || bridgeLatency > 50 || memoryUsed > 300 || updateProcessingTime > 30) {
      health = 'WARNING';
    }

    // Identify bottleneck
    if (fps < 55) {
      bottleneck = 'RENDERING';
    } else if (bridgeLatency > 50) {
      bottleneck = 'BRIDGE';
    } else if (updateProcessingTime > 30) {
      bottleneck = 'PROCESSING';
    } else if (memoryUsed > 300) {
      bottleneck = 'MEMORY';
    }

    // Log critical issues
    if (health === 'CRITICAL') {
      console.warn(`[PERF] CRITICAL: ${bottleneck}`, {
        fps,
        bridgeLatency,
        memoryUsed,
        updateProcessingTime,
        markerCount,
      });
    }

    setMetrics(prev => ({
      ...prev,
      health,
      bottleneck,
    }));
  }, [metrics.fps, metrics.bridgeLatency, metrics.memoryUsed, metrics.updateProcessingTime, metrics.markerCount]);

  // Get recommendations
  const getRecommendations = useCallback(() => {
    const recs = [];
    const { fps, bridgeLatency, markerCount, memoryUsed, bottleneck } = metrics;

    if (fps < 55) {
      recs.push({
        priority: 'HIGH',
        issue: 'Low FPS',
        action: markerCount > 50 
          ? 'Reduce max markers to 30-40 or enable clustering'
          : 'Simplify animations or reduce update frequency',
      });
    }

    if (bridgeLatency > 50) {
      recs.push({
        priority: 'HIGH',
        issue: 'Bridge latency high',
        action: 'Increase batch interval to 500ms+ or use postMessage',
      });
    }

    if (markerCount > 80) {
      recs.push({
        priority: 'MEDIUM',
        issue: 'Too many markers',
        action: 'Implement priority-based rendering (max 50 markers)',
      });
    }

    if (memoryUsed > 300) {
      recs.push({
        priority: 'MEDIUM',
        issue: 'High memory usage',
        action: 'Check for memory leaks, reduce history buffer size',
      });
    }

    if (bottleneck === 'PROCESSING') {
      recs.push({
        priority: 'MEDIUM',
        issue: 'Processing bottleneck',
        action: 'Skip animations for far buses, reduce prediction frequency',
      });
    }

    return recs;
  }, [metrics]);

  return {
    metrics,
    recordBridgeLatency,
    recordProcessingTime,
    recordPayload,
    getRecommendations,
  };
};

export default usePerformanceMonitor;
