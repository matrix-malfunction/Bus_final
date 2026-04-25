import React, { useRef, useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useFaultTolerantBusTracking } from '../hooks/useFaultTolerantBusTracking';

/**
 * Demo component showing fault tolerance features
 */
export default function FaultToleranceDemo() {
  const webViewRef = useRef(null);
  const [webViewReady, setWebViewReady] = useState(false);
  const [logs, setLogs] = useState([]);
  
  const userLocation = { latitude: 40.7128, longitude: -74.0060 };

  // Add log entry
  const addLog = useCallback((type, message) => {
    setLogs(prev => [
      { time: new Date().toLocaleTimeString(), type, message },
      ...prev.slice(0, 49), // Keep last 50
    ]);
  }, []);

  // Handle system state changes
  const onSystemStateChange = useCallback((state) => {
    addLog('STATE', `${state.status} | Failures: ${state.consecutiveFailures} | Resets: ${state.totalResets}`);
    
    if (state.lastError) {
      addLog('ERROR', state.lastError);
    }
    
    if (state.circuitBreakerOpen) {
      addLog('WARNING', 'Circuit breaker OPEN - system paused');
    }
  }, [addLog]);

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

  // Handle WebView messages
  const handleMessage = useCallback((event) => {
    const data = onWebViewMessage(event);
    
    if (data?.type === 'ACK') {
      addLog('ACK', `Seq:${data.seq || 'N/A'} | ${data.processingTime}ms | Updated:${data.processed?.updated || 0}`);
    } else if (data?.type === 'PERFORMANCE') {
      addLog('PERF', `FPS:${data.fps} | Markers:${data.activeMarkers}/${data.visibleMarkers}`);
    }
  }, [onWebViewMessage, addLog]);

  // Simulate WebView freeze (for testing)
  const simulateFreeze = useCallback(() => {
    Alert.alert(
      'Simulate Freeze',
      'This will inject a script that blocks the WebView for 5 seconds to test freeze detection.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Simulate',
          onPress: () => {
            webViewRef.current?.injectJavaScript(`
              console.log('[TEST] Simulating freeze...');
              var start = Date.now();
              while (Date.now() - start < 5000) {} // Block for 5s
              console.log('[TEST] Freeze ended');
              true;
            `);
            addLog('TEST', 'Injected 5s freeze simulation');
          },
        },
      ]
    );
  }, [addLog]);

  // Simulate message failure
  const simulateFailure = useCallback(() => {
    webViewRef.current?.injectJavaScript(`
      // Override postMessage to simulate failure
      window.originalPostMessage = window.ReactNativeWebView.postMessage;
      window.ReactNativeWebView.postMessage = function() {
        console.log('[TEST] Dropping message (simulated failure)');
        // Don't actually send
      };
      
      // Restore after 3 seconds
      setTimeout(function() {
        window.ReactNativeWebView.postMessage = window.originalPostMessage;
        console.log('[TEST] Message sending restored');
      }, 3000);
      
      true;
    `);
    addLog('TEST', 'Simulated message failures (3s)');
  }, [addLog]);

  // Manual reset
  const handleManualReset = useCallback(async () => {
    addLog('ACTION', 'Manual reset triggered');
    const success = await triggerManualReset();
    addLog('ACTION', success ? 'Reset successful' : 'Reset failed/blocked');
  }, [triggerManualReset, addLog]);

  // Get status color
  const getStatusColor = () => {
    switch (systemState.status) {
      case 'HEALTHY': return '#4CAF50';
      case 'RECOVERING': return '#2196F3';
      case 'DEGRADED': return '#FF9800';
      case 'UNHEALTHY': return '#F44336';
      case 'CIRCUIT_OPEN': return '#9C27B0';
      default: return '#757575';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fault Tolerance Demo</Text>
      
      {/* Status Panel */}
      <View style={[styles.statusPanel, { borderColor: getStatusColor() }]}>
        <View style={styles.statusHeader}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={[styles.statusText, { color: getStatusColor() }]}>
            {systemState.status}
          </Text>
        </View>
        
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Failures</Text>
            <Text style={styles.statValue}>{systemState.consecutiveFailures}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Resets</Text>
            <Text style={styles.statValue}>{systemState.totalResets}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Retries</Text>
            <Text style={styles.statValue}>{systemState.retryCount}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Queue</Text>
            <Text style={styles.statValue}>{stats.queueDepth}</Text>
          </View>
        </View>
        
        {systemState.circuitBreakerOpen && (
          <Text style={styles.circuitWarning}>⚠️ Circuit Breaker OPEN</Text>
        )}
        
        {systemState.lastError && (
          <Text style={styles.lastError}>Last: {systemState.lastError}</Text>
        )}
      </View>

      {/* Control Buttons */}
      <View style={styles.controls}>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#F44336' }]}
          onPress={simulateFreeze}
        >
          <Text style={styles.buttonText}>Simulate Freeze</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#FF9800' }]}
          onPress={simulateFailure}
        >
          <Text style={styles.buttonText}>Simulate Failures</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#2196F3' }]}
          onPress={handleManualReset}
        >
          <Text style={styles.buttonText}>Manual Reset</Text>
        </TouchableOpacity>
      </View>

      {/* Logs */}
      <View style={styles.logPanel}>
        <Text style={styles.logTitle}>System Logs</Text>
        <ScrollView style={styles.logScroll}>
          {logs.map((log, i) => (
            <View key={i} style={styles.logEntry}>
              <Text style={styles.logTime}>{log.time}</Text>
              <Text style={[styles.logType, { 
                color: 
                  log.type === 'ERROR' ? '#F44336' :
                  log.type === 'WARNING' ? '#FF9800' :
                  log.type === 'ACK' ? '#4CAF50' :
                  log.type === 'STATE' ? '#2196F3' :
                  '#666'
              }]}>
                {log.type}
              </Text>
              <Text style={styles.logMessage}>{log.message}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Hidden WebView */}
      <WebView
        ref={webViewRef}
        source={{ 
          html: `
            <!DOCTYPE html>
            <html>
              <body style="background:#f0f0f0; font-family:sans-serif;">
                <h3>Fault Tolerance Test WebView</h3>
                <p id="status">Ready</p>
                <script>
                  window.busMarkers = new Map();
                  console.log('[WEBVIEW] Initialized');
                </script>
              </body>
            </html>
          ` 
        }}
        onLoadEnd={() => setWebViewReady(true)}
        onMessage={handleMessage}
        style={{ width: 0, height: 0 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  statusPanel: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  circuitWarning: {
    color: '#9C27B0',
    fontWeight: 'bold',
    marginTop: 4,
  },
  lastError: {
    color: '#F44336',
    fontSize: 12,
    marginTop: 4,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  button: {
    flex: 1,
    marginHorizontal: 4,
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  logPanel: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
  },
  logTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  logScroll: {
    flex: 1,
  },
  logEntry: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  logTime: {
    width: 70,
    fontSize: 11,
    color: '#999',
  },
  logType: {
    width: 60,
    fontSize: 11,
    fontWeight: 'bold',
  },
  logMessage: {
    flex: 1,
    fontSize: 12,
    color: '#333',
  },
});
