import { useEffect, useRef, useCallback, useState } from 'react';
import { useBusStore } from '../store/busStore';

/**
 * Fault-tolerant bus tracking with retry, health checks, and safe recovery
 */

const FAULT_TOLERANCE_CONFIG = {
  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 100, // ms - doubles each retry (100, 200, 400)
  
  // Health check settings
  HEALTH_CHECK_INTERVAL: 2000, // 2 seconds
  ACK_TIMEOUT: 2000, // 2 seconds without ACK = unhealthy
  
  // Recovery settings
  MAX_CONSECUTIVE_FAILURES: 5,
  RESET_COOLDOWN: 3000, // 3 seconds between resets
  MAX_RESETS_PER_MINUTE: 3,
  
  // Circuit breaker
  CIRCUIT_BREAKER_THRESHOLD: 10, // failures
  CIRCUIT_BREAKER_TIMEOUT: 30000, // 30 seconds
};

const SYSTEM_STATE = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNHEALTHY: 'UNHEALTHY',
  RECOVERING: 'RECOVERING',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN', // Circuit breaker active
};

export const useFaultTolerantBusTracking = (
  webViewRef,
  webViewReady,
  onSystemStateChange
) => {
  const { buses } = useBusStore();
  
  // System state
  const [systemState, setSystemState] = useState({
    status: SYSTEM_STATE.HEALTHY,
    lastError: null,
    consecutiveFailures: 0,
    totalResets: 0,
    lastResetTime: 0,
    circuitBreakerOpen: false,
    retryCount: 0,
  });

  // Internal refs
  const messageQueueRef = useRef([]); // Pending messages with retry info
  const pendingAckRef = useRef(null); // Currently waiting for ACK
  const healthCheckRef = useRef(null);
  const circuitBreakerTimerRef = useRef(null);
  const lastHealthyTimeRef = useRef(Date.now());
  const consecutiveFailuresRef = useRef(0);
  const resetsThisMinuteRef = useRef(0);
  const resetHistoryRef = useRef([]); // Timestamps of recent resets
  const isProcessingRef = useRef(false);
  const seqRef = useRef(0);
  const lastStateRef = useRef(new Map());

  // Update system state helper
  const updateState = useCallback((updates) => {
    setSystemState(prev => {
      const newState = { ...prev, ...updates };
      if (onSystemStateChange) {
        onSystemStateChange(newState);
      }
      return newState;
    });
  }, [onSystemStateChange]);

  // Check circuit breaker
  const checkCircuitBreaker = useCallback(() => {
    if (consecutiveFailuresRef.current >= FAULT_TOLERANCE_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      if (!systemState.circuitBreakerOpen) {
        console.warn('[FAULT] Circuit breaker opened - too many failures');
        updateState({
          status: SYSTEM_STATE.CIRCUIT_OPEN,
          circuitBreakerOpen: true,
        });
        
        // Auto-close after timeout
        circuitBreakerTimerRef.current = setTimeout(() => {
          console.log('[FAULT] Circuit breaker closing - attempting recovery');
          consecutiveFailuresRef.current = 0;
          updateState({
            status: SYSTEM_STATE.RECOVERING,
            circuitBreakerOpen: false,
            consecutiveFailures: 0,
          });
        }, FAULT_TOLERANCE_CONFIG.CIRCUIT_BREAKER_TIMEOUT);
        
        return true; // Circuit is open
      }
    }
    return false;
  }, [systemState.circuitBreakerOpen, updateState]);

  // Send message with retry logic
  const sendWithRetry = useCallback(async (message, attempt = 0) => {
    if (!webViewRef.current || !webViewReady) {
      return { success: false, error: 'WebView not ready' };
    }

    // Check circuit breaker
    if (checkCircuitBreaker()) {
      return { success: false, error: 'Circuit breaker open' };
    }

    const startTime = performance.now();
    
    try {
      // Send via postMessage
      webViewRef.current.postMessage(JSON.stringify(message));
      
      // Wait for ACK
      const timeout = FAULT_TOLERANCE_CONFIG.ACK_TIMEOUT;
      
      return new Promise((resolve) => {
        pendingAckRef.current = {
          messageId: message.s,
          resolve,
          startTime,
          attempt,
        };
        
        // Timeout handler
        setTimeout(() => {
          if (pendingAckRef.current?.messageId === message.s) {
            pendingAckRef.current = null;
            
            // Retry if attempts remain
            if (attempt < FAULT_TOLERANCE_CONFIG.MAX_RETRIES) {
              const delay = FAULT_TOLERANCE_CONFIG.RETRY_DELAY_BASE * Math.pow(2, attempt);
              console.log(`[FAULT] ACK timeout, retrying in ${delay}ms (attempt ${attempt + 1}/${FAULT_TOLERANCE_CONFIG.MAX_RETRIES})`);
              
              setTimeout(() => {
                sendWithRetry(message, attempt + 1).then(resolve);
              }, delay);
            } else {
              // Max retries exceeded
              consecutiveFailuresRef.current++;
              updateState({
                consecutiveFailures: consecutiveFailuresRef.current,
                retryCount: attempt,
              });
              
              resolve({ 
                success: false, 
                error: `Max retries exceeded (${FAULT_TOLERANCE_CONFIG.MAX_RETRIES})`,
                latency: performance.now() - startTime,
              });
            }
          }
        }, timeout);
      });
      
    } catch (error) {
      consecutiveFailuresRef.current++;
      updateState({
        consecutiveFailures: consecutiveFailuresRef.current,
        lastError: error.message,
      });
      
      return { 
        success: false, 
        error: error.message,
        latency: performance.now() - startTime,
      };
    }
  }, [webViewRef, webViewReady, checkCircuitBreaker, updateState]);

  // Handle ACK from WebView
  const handleAck = useCallback((ackData) => {
    if (!pendingAckRef.current) return;
    
    const { resolve, startTime, attempt } = pendingAckRef.current;
    const latency = performance.now() - startTime;
    
    pendingAckRef.current = null;
    
    // Reset failure count on successful ACK
    if (consecutiveFailuresRef.current > 0) {
      consecutiveFailuresRef.current = 0;
      updateState({
        consecutiveFailures: 0,
        status: SYSTEM_STATE.HEALTHY,
        retryCount: 0,
      });
    }
    
    // Update healthy time
    lastHealthyTimeRef.current = Date.now();
    
    resolve({
      success: !ackData.error,
      error: ackData.error,
      latency,
      attempt,
    });
  }, [updateState]);

  // Safe system reset
  const safeReset = useCallback(async () => {
    const now = Date.now();
    
    // Check cooldown
    if (now - systemState.lastResetTime < FAULT_TOLERANCE_CONFIG.RESET_COOLDOWN) {
      console.log('[FAULT] Reset blocked - cooldown active');
      return false;
    }
    
    // Check max resets per minute
    resetHistoryRef.current = resetHistoryRef.current.filter(t => now - t < 60000);
    if (resetHistoryRef.current.length >= FAULT_TOLERANCE_CONFIG.MAX_RESETS_PER_MINUTE) {
      console.error('[FAULT] Max resets per minute exceeded - system halted');
      updateState({
        status: SYSTEM_STATE.CIRCUIT_OPEN,
        circuitBreakerOpen: true,
      });
      return false;
    }
    
    console.log('[FAULT] Performing safe system reset...');
    
    // 1. Clear pending queue
    messageQueueRef.current = [];
    
    // 2. Cancel pending ACK
    if (pendingAckRef.current) {
      pendingAckRef.current.resolve({ success: false, error: 'Reset' });
      pendingAckRef.current = null;
    }
    
    // 3. Clear WebView (if possible)
    try {
      webViewRef.current?.injectJavaScript(`
        if (window.busMarkers) {
          window.busMarkers.forEach(function(marker) {
            if (marker._animFrame) cancelAnimationFrame(marker._animFrame);
            if (marker._predictFrame) cancelAnimationFrame(marker._predictFrame);
            window.map?.removeLayer(marker);
          });
          window.busMarkers.clear();
        }
        window.__busMetrics = null;
        window.__fpsMetrics = null;
        console.log('[FAULT] WebView cleared');
        true;
      `);
    } catch (e) {
      console.error('[FAULT] Failed to clear WebView:', e);
    }
    
    // 4. Reset local state
    lastStateRef.current.clear();
    isProcessingRef.current = false;
    
    // 5. Update state
    resetHistoryRef.current.push(now);
    updateState({
      status: SYSTEM_STATE.RECOVERING,
      totalResets: systemState.totalResets + 1,
      lastResetTime: now,
      consecutiveFailures: 0,
    });
    
    // 6. Transition to healthy after recovery period
    setTimeout(() => {
      updateState({ status: SYSTEM_STATE.HEALTHY });
      console.log('[FAULT] System recovered');
    }, 1000);
    
    return true;
  }, [systemState.lastResetTime, systemState.totalResets, updateState, webViewRef]);

  // Health check monitor
  const runHealthCheck = useCallback(() => {
    const now = Date.now();
    const timeSinceHealthy = now - lastHealthyTimeRef.current;
    const isStuck = pendingAckRef.current && 
      (now - pendingAckRef.current.startTime > FAULT_TOLERANCE_CONFIG.ACK_TIMEOUT);
    
    // Detect frozen WebView
    if (isStuck || (timeSinceHealthy > FAULT_TOLERANCE_CONFIG.ACK_TIMEOUT && isProcessingRef.current)) {
      console.warn('[FAULT] WebView appears frozen - initiating recovery');
      
      updateState({
        status: SYSTEM_STATE.UNHEALTHY,
        lastError: 'WebView freeze detected',
      });
      
      // Trigger safe reset
      safeReset();
    }
    
    // Detect degraded performance
    if (consecutiveFailuresRef.current > 0 && consecutiveFailuresRef.current < 5) {
      if (systemState.status !== SYSTEM_STATE.DEGRADED) {
        updateState({ status: SYSTEM_STATE.DEGRADED });
      }
    }
  }, [safeReset, systemState.status, updateState]);

  // Process message queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || messageQueueRef.current.length === 0) return;
    if (systemState.circuitBreakerOpen) return;
    
    isProcessingRef.current = true;
    
    const message = messageQueueRef.current[0];
    
    const result = await sendWithRetry(message);
    
    if (result.success) {
      // Remove from queue on success
      messageQueueRef.current.shift();
    } else {
      // Keep in queue for later retry, but mark
      message.failures = (message.failures || 0) + 1;
      
      // If too many failures, drop message
      if (message.failures > FAULT_TOLERANCE_CONFIG.MAX_CONSECUTIVE_FAILURES) {
        console.error('[FAULT] Dropping message after max failures:', message);
        messageQueueRef.current.shift();
      }
    }
    
    isProcessingRef.current = false;
    
    // Process next if available
    if (messageQueueRef.current.length > 0) {
      setTimeout(() => processQueue(), 100);
    }
  }, [sendWithRetry, systemState.circuitBreakerOpen]);

  // Queue message for sending
  const queueMessage = useCallback((buses) => {
    const updates = buses.map(b => ({
      i: b.busId,
      la: Number(b.lat ?? b.latitude),
      ln: Number(b.lng ?? b.longitude),
    }));
    
    const message = {
      t: 'u',
      s: ++seqRef.current,
      u: updates,
      ts: Date.now(),
    };
    
    messageQueueRef.current.push(message);
    
    // Trigger processing
    processQueue();
  }, [processQueue]);

  // Main effect - start health checks
  useEffect(() => {
    if (!webViewReady) return;
    
    healthCheckRef.current = setInterval(
      runHealthCheck,
      FAULT_TOLERANCE_CONFIG.HEALTH_CHECK_INTERVAL
    );
    
    return () => {
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
      }
      if (circuitBreakerTimerRef.current) {
        clearTimeout(circuitBreakerTimerRef.current);
      }
    };
  }, [webViewReady, runHealthCheck]);

  // Handle buses updates
  useEffect(() => {
    if (!webViewReady || systemState.circuitBreakerOpen) return;
    
    queueMessage(buses);
  }, [buses, webViewReady, systemState.circuitBreakerOpen, queueMessage]);

  // Public API for handling WebView messages
  const onWebViewMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'ACK') {
        handleAck(data);
      }
      
      return data;
    } catch (e) {
      console.error('[FAULT] Failed to parse WebView message:', e);
      return null;
    }
  }, [handleAck]);

  // Manual reset trigger
  const triggerManualReset = useCallback(() => {
    return safeReset();
  }, [safeReset]);

  return {
    systemState,
    onWebViewMessage,
    triggerManualReset,
    stats: {
      queueDepth: messageQueueRef.current.length,
      pendingAck: pendingAckRef.current !== null,
      lastHealthy: lastHealthyTimeRef.current,
    },
  };
};

export default useFaultTolerantBusTracking;
