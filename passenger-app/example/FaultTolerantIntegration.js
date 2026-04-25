import React, { useRef, useState, useCallback } from 'react';
import { View, Text, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFaultTolerantBusTracking } from '../hooks/useFaultTolerantBusTracking';

/**
 * Example: Integrating fault tolerance into HomeScreen
 */
export default function FaultTolerantIntegration() {
  const webViewRef = useRef(null);
  const [webViewReady, setWebViewReady] = useState(false);
  const [status, setStatus] = useState('Initializing...');

  // Handle system state changes
  const onSystemStateChange = useCallback((state) => {
    console.log('[SYSTEM]', state.status, state);
    
    // Show alerts for critical states
    if (state.status === 'CIRCUIT_OPEN') {
      Alert.alert(
        'System Protection',
        'Too many failures detected. System paused for 30 seconds to prevent crash.',
        [{ text: 'OK' }]
      );
    } else if (state.status === 'UNHEALTHY') {
      setStatus('System unhealthy - attempting recovery...');
    } else if (state.status === 'RECOVERING') {
      setStatus('Recovering...');
    } else if (state.status === 'HEALTHY') {
      setStatus('System healthy');
    }
  }, []);

  // Use fault-tolerant tracking
  const { 
    systemState, 
    onWebViewMessage, 
    triggerManualReset,
    stats 
  } = useFaultTolerantBusTracking(
    webViewRef,
    webViewReady,
    onSystemStateChange
  );

  // Handle WebView messages (combines multiple message types)
  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      // Route to fault tolerance system
      onWebViewMessage(event);
      
      // Handle other message types
      if (data.type === 'VIEWPORT_CHANGE') {
        // Update viewport bounds
        console.log('[VIEWPORT]', data.bounds);
      } else if (data.type === 'BUS_CLICK') {
        // Handle bus click
        console.log('[CLICK]', data.busId);
      }
    } catch (e) {
      console.error('Message handling error:', e);
    }
  }, [onWebViewMessage]);

  // WebView error handling
  const handleError = useCallback((event) => {
    console.error('[WebView Error]', event.nativeEvent);
    
    // Trigger manual reset on WebView error
    triggerManualReset();
  }, [triggerManualReset]);

  // WebView render error
  const handleRenderError = useCallback((event) => {
    console.error('[WebView Render Error]', event.nativeEvent);
    Alert.alert(
      'Map Error',
      'Failed to render map. Attempting recovery...',
      [
        { text: 'Retry', onPress: () => triggerManualReset() },
        { text: 'Dismiss' }
      ]
    );
  }, [triggerManualReset]);

  return (
    <View style={{ flex: 1 }}>
      {/* Status Bar */}
      <View style={{
        padding: 8,
        backgroundColor: 
          systemState.status === 'HEALTHY' ? '#4CAF50' :
          systemState.status === 'RECOVERING' ? '#2196F3' :
          systemState.status === 'DEGRADED' ? '#FF9800' :
          '#F44336'
      }}>
        <Text style={{ color: 'white', textAlign: 'center' }}>
          {status} | Queue: {stats.queueDepth} | ACK Pending: {stats.pendingAck ? 'Yes' : 'No'}
        </Text>
      </View>

      {/* Main WebView */}
      <WebView
        ref={webViewRef}
        source={{ 
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                  body { margin: 0; padding: 0; }
                  #map { width: 100vw; height: 100vh; }
                </style>
              </head>
              <body>
                <div id="map"></div>
                <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                <script>
                  // Initialize map
                  window.map = L.map('map').setView([40.7128, -74.0060], 12);
                  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.map);
                  
                  // Initialize markers map
                  window.busMarkers = new Map();
                  
                  // [Inject all your optimized bus tracking code here]
                  
                  console.log('[WEBVIEW] Map initialized with fault tolerance support');
                </script>
              </body>
            </html>
          ` 
        }}
        onLoadEnd={() => setWebViewReady(true)}
        onMessage={handleMessage}
        onError={handleError}
        onRenderProcessGone={handleRenderError}
        style={{ flex: 1 }}
      />
    </View>
  );
}

/**
 * Configuration Tips:
 * 
 * 1. Adjust timeouts based on your network conditions:
 *    - ACK_TIMEOUT: 2000ms for slow networks, 1000ms for fast
 *    - MAX_RETRIES: 3-5 depending on reliability needs
 * 
 * 2. Circuit breaker prevents cascade failures:
 *    - CIRCUIT_BREAKER_THRESHOLD: 10 failures
 *    - CIRCUIT_BREAKER_TIMEOUT: 30 seconds
 * 
 * 3. Monitor these metrics:
 *    - consecutiveFailures: Should stay at 0
 *    - queueDepth: Should stay < 10
 *    - totalResets: Should stay < 5 per minute
 * 
 * 4. Alerts to watch for:
 *    - "Max retries exceeded" → Check network
 *    - "Circuit breaker opened" → System overloaded
 *    - "WebView appears frozen" → WebView crash
 */
