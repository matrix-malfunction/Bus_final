import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { busSimulator } from '../utils/busLoadSimulator';
import { usePerformanceMonitor } from '../hooks/usePerformanceMonitor';

/**
 * Load Test Screen - Simulate 100+ buses and monitor performance
 */
export default function LoadTestScreen() {
  const webViewRef = useRef(null);
  const [webViewReady, setWebViewReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [busCount, setBusCount] = useState(0);
  const [testResults, setTestResults] = useState([]);
  
  const { metrics, recordBridgeLatency, recordProcessingTime, getRecommendations } = 
    usePerformanceMonitor(isRunning);

  // Initialize simulation
  const initBuses = useCallback((count) => {
    const buses = busSimulator.initBuses(count);
    setBusCount(count);
    
    // Initial inject
    if (webViewRef.current && webViewReady) {
      const start = performance.now();
      webViewRef.current.injectJavaScript(`
        window.updateBusMarkers({
          updated: ${JSON.stringify(buses.map(b => ({
            id: b.busId,
            lat: b.lat,
            lng: b.lng,
            priority: b.calculatedDistance < 2000 ? 0 : b.calculatedDistance < 5000 ? 1 : 2,
          })))},
          removed: []
        });
        true;
      `);
      recordBridgeLatency(performance.now() - start);
    }
    
    return buses;
  }, [webViewReady, recordBridgeLatency]);

  // Start simulation
  const startSimulation = useCallback((count = 100) => {
    initBuses(count);
    
    busSimulator.start((buses) => {
      // Send to WebView
      if (webViewRef.current && webViewReady) {
        const start = performance.now();
        
        // Build diff (simplified for test)
        const updates = buses.map(b => ({
          id: b.busId,
          lat: b.lat,
          lng: b.lng,
          priority: b.calculatedDistance < 2000 ? 0 : b.calculatedDistance < 5000 ? 1 : 2,
        }));
        
        webViewRef.current.injectJavaScript(`
          window.updateBusMarkers({
            updated: ${JSON.stringify(updates)},
            removed: []
          });
          true;
        `);
        
        const latency = performance.now() - start;
        recordBridgeLatency(latency);
        recordProcessingTime(latency, buses.length);
      }
    }, 500); // 500ms update interval
    
    setIsRunning(true);
    console.log(`[TEST] Started simulation with ${count} buses`);
  }, [initBuses, webViewReady, recordBridgeLatency, recordProcessingTime]);

  // Stop simulation
  const stopSimulation = useCallback(() => {
    busSimulator.stop();
    setIsRunning(false);
    console.log('[TEST] Stopped simulation');
  }, []);

  // Run stress test
  const runStressTest = useCallback(async () => {
    Alert.alert('Stress Test', 'This will test with 20, 40, 60... up to 200 buses. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Start',
        onPress: async () => {
          setIsRunning(true);
          const results = await busSimulator.runStressTest(
            (buses) => {
              if (webViewRef.current && webViewReady) {
                const start = performance.now();
                webViewRef.current.injectJavaScript(`
                  window.updateBusMarkers({
                    updated: ${JSON.stringify(buses.map(b => ({
                      id: b.busId,
                      lat: b.lat,
                      lng: b.lng,
                    })))},
                    removed: []
                  });
                  true;
                `);
                recordBridgeLatency(performance.now() - start);
              }
            },
            200, // max 200 buses
            20   // step by 20
          );
          setTestResults(results);
          setIsRunning(false);
        },
      },
    ]);
  }, [webViewReady, recordBridgeLatency]);

  // Auto-stop on critical performance
  useEffect(() => {
    if (metrics.health === 'CRITICAL' && isRunning) {
      console.warn('[TEST] Auto-stopping due to critical performance');
      stopSimulation();
      Alert.alert(
        'Performance Critical',
        `FPS: ${metrics.fps}, Latency: ${metrics.bridgeLatency}ms\n\n` +
        'Simulation stopped to prevent system freeze.'
      );
    }
  }, [metrics.health, isRunning, stopSimulation, metrics.fps, metrics.bridgeLatency]);

  const recommendations = getRecommendations();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Load Test (100+ Buses)</Text>
      
      {/* Performance Metrics */}
      <View style={styles.metricsPanel}>
        <Text style={[styles.status, { color: 
          metrics.health === 'GOOD' ? 'green' : 
          metrics.health === 'WARNING' ? 'orange' : 'red'
        }]}>
          Status: {metrics.health} {metrics.bottleneck && `(${metrics.bottleneck})`}
        </Text>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>FPS:</Text>
          <Text style={[styles.metricValue, { color: metrics.fps > 55 ? 'green' : metrics.fps > 30 ? 'orange' : 'red' }]}>
            {metrics.fps}
          </Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Bridge Latency:</Text>
          <Text style={[styles.metricValue, { color: metrics.bridgeLatency < 30 ? 'green' : metrics.bridgeLatency < 80 ? 'orange' : 'red' }]}>
            {metrics.bridgeLatency}ms
          </Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Active Buses:</Text>
          <Text style={styles.metricValue}>{busCount}</Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Markers:</Text>
          <Text style={styles.metricValue}>{metrics.markerCount}</Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Dropped Frames:</Text>
          <Text style={[styles.metricValue, { color: metrics.droppedFrames < 10 ? 'green' : 'red' }]}>
            {metrics.droppedFrames}
          </Text>
        </View>
        
        {metrics.memoryUsed > 0 && (
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Memory:</Text>
            <Text style={styles.metricValue}>
              {metrics.memoryUsed}MB / {metrics.memoryTotal}MB
            </Text>
          </View>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <Button
          title="Start 50 Buses"
          onPress={() => startSimulation(50)}
          disabled={isRunning}
        />
        <Button
          title="Start 100 Buses"
          onPress={() => startSimulation(100)}
          disabled={isRunning}
        />
        <Button
          title="Start 150 Buses"
          onPress={() => startSimulation(150)}
          disabled={isRunning}
        />
        <Button
          title="Stress Test (20→200)"
          onPress={runStressTest}
          disabled={isRunning}
          color="orange"
        />
        <Button
          title={isRunning ? "Stop" : "Stopped"}
          onPress={stopSimulation}
          disabled={!isRunning}
          color={isRunning ? "red" : "gray"}
        />
      </View>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <View style={styles.recommendations}>
          <Text style={styles.recTitle}>Recommendations:</Text>
          <ScrollView>
            {recommendations.map((rec, i) => (
              <View key={i} style={styles.recItem}>
                <Text style={[styles.recPriority, { color: rec.priority === 'HIGH' ? 'red' : 'orange' }]}>
                  {rec.priority}
                </Text>
                <Text style={styles.recIssue}>{rec.issue}</Text>
                <Text style={styles.recAction}>{rec.action}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Stress Test Results */}
      {testResults.length > 0 && (
        <View style={styles.results}>
          <Text style={styles.resultsTitle}>Stress Test Results:</Text>
          <ScrollView horizontal>
            {testResults.map((result, i) => (
              <View key={i} style={[styles.resultCard, { 
                backgroundColor: result.status === 'OK' ? '#e0f2e0' : 
                                result.status === 'DEGRADED' ? '#fff3e0' : '#ffebee'
              }]}>
                <Text style={styles.resultBusCount}>{result.busCount} buses</Text>
                <Text style={styles.resultFps}>{result.fps} FPS</Text>
                <Text style={styles.resultDropped}>{result.droppedFrames} dropped</Text>
                <Text style={styles.resultTime}>{result.avgProcessingTime}ms avg</Text>
                <Text style={[styles.resultStatus, { color: 
                  result.status === 'OK' ? 'green' : 
                  result.status === 'DEGRADED' ? 'orange' : 'red'
                }]}>
                  {result.status}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Hidden WebView for testing */}
      <WebView
        ref={webViewRef}
        source={{ html: '<!DOCTYPE html><html><body style="background:#f0f0f0"><div id="map"></div></body></html>' }}
        onLoadEnd={() => setWebViewReady(true)}
        style={{ width: 0, height: 0 }} // Hidden but functional
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  metricsPanel: {
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  status: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  metricLabel: {
    fontSize: 14,
    color: '#666',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  recommendations: {
    maxHeight: 150,
    backgroundColor: '#fff8e1',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  recTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  recItem: {
    marginVertical: 4,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ffa000',
  },
  recPriority: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  recIssue: {
    fontWeight: 'bold',
  },
  recAction: {
    fontSize: 12,
    color: '#666',
  },
  results: {
    flex: 1,
  },
  resultsTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  resultCard: {
    width: 120,
    padding: 12,
    marginRight: 8,
    borderRadius: 8,
  },
  resultBusCount: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  resultFps: {
    fontSize: 24,
    fontWeight: 'bold',
    marginVertical: 4,
  },
  resultDropped: {
    fontSize: 12,
    color: '#666',
  },
  resultTime: {
    fontSize: 12,
    color: '#666',
  },
  resultStatus: {
    fontWeight: 'bold',
    marginTop: 4,
  },
});
