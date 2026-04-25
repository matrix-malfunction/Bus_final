import React, { useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAdaptiveBusTracking } from '../hooks/useAdaptiveBusTracking';

/**
 * Demo component showing adaptive throttling in action
 */
export default function AdaptiveTrackingDemo() {
  const webViewRef = useRef(null);
  const [webViewReady, setWebViewReady] = useState(false);
  const [performanceData, setPerformanceData] = useState({
    fps: 60,
    activeMarkers: 0,
    visibleMarkers: 0,
  });
  
  const userLocation = { latitude: 40.7128, longitude: -74.0060 }; // NYC

  // Handle metrics updates from adaptive system
  const handleMetricsUpdate = useCallback((metrics) => {
    console.log(
      `[ADAPTIVE] ${metrics.interval}ms (${metrics.load}) - ${metrics.reason}`
    );
  }, []);

  // Use adaptive tracking
  const { adaptiveState, recordMetrics, currentInterval } = useAdaptiveBusTracking(
    webViewRef,
    webViewReady,
    userLocation,
    handleMetricsUpdate
  );

  // Handle WebView messages (FPS reports)
  const onMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      
      if (msg.type === 'PERFORMANCE') {
        setPerformanceData({
          fps: msg.fps,
          activeMarkers: msg.activeMarkers,
          visibleMarkers: msg.visibleMarkers,
        });
        
        // Record FPS for adaptive system
        recordMetrics(msg.fps, null);
      } else if (msg.type === 'ACK') {
        // Record latency from ACK
        recordMetrics(null, msg.processingTime);
      }
    } catch (e) {
      console.error('WebView message error:', e);
    }
  }, [recordMetrics]);

  // Determine color based on system load
  const getLoadColor = () => {
    switch (adaptiveState.systemLoad) {
      case 'IDLE': return '#4CAF50'; // Green
      case 'NORMAL': return '#2196F3'; // Blue
      case 'STRESSED': return '#FF9800'; // Orange
      case 'CRITICAL': return '#F44336'; // Red
      default: return '#2196F3';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Adaptive Tracking Demo</Text>
      
      {/* Adaptive Status Panel */}
      <View style={[styles.statusPanel, { borderColor: getLoadColor() }]}>
        <Text style={styles.sectionTitle}>Adaptive Throttling</Text>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Update Interval:</Text>
          <Text style={[styles.metricValue, { color: getLoadColor() }]}>
            {currentInterval}ms
          </Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>System Load:</Text>
          <Text style={[styles.metricValue, { color: getLoadColor() }]}>
            {adaptiveState.systemLoad}
          </Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Reason:</Text>
          <Text style={styles.metricValueSmall}>{adaptiveState.reason}</Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Bus Count:</Text>
          <Text style={styles.metricValue}>{adaptiveState.busCount}</Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Avg FPS:</Text>
          <Text style={[styles.metricValue, { 
            color: adaptiveState.fps > 55 ? '#4CAF50' : 
                   adaptiveState.fps > 40 ? '#FF9800' : '#F44336'
          }]}>
            {adaptiveState.fps.toFixed(1)}
          </Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Avg Latency:</Text>
          <Text style={[styles.metricValue, { 
            color: adaptiveState.latency < 30 ? '#4CAF50' : 
                   adaptiveState.latency < 80 ? '#FF9800' : '#F44336'
          }]}>
            {adaptiveState.latency.toFixed(1)}ms
          </Text>
        </View>
      </View>

      {/* WebView Performance */}
      <View style={styles.webViewPanel}>
        <Text style={styles.sectionTitle}>WebView Performance</Text>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Current FPS:</Text>
          <Text style={[styles.metricValue, { 
            color: performanceData.fps > 55 ? '#4CAF50' : 
                   performanceData.fps > 30 ? '#FF9800' : '#F44336'
          }]}>
            {performanceData.fps}
          </Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Active Markers:</Text>
          <Text style={styles.metricValue}>{performanceData.activeMarkers}</Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Visible:</Text>
          <Text style={styles.metricValue}>{performanceData.visibleMarkers}</Text>
        </View>
        
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Culled:</Text>
          <Text style={styles.metricValue}>
            {performanceData.activeMarkers - performanceData.visibleMarkers}
          </Text>
        </View>
      </View>

      {/* Adaptive Behavior Guide */}
      <View style={styles.guidePanel}>
        <Text style={styles.sectionTitle}>Adaptive Behavior</Text>
        <ScrollView>
          <Text style={styles.guideText}>
            • <Text style={styles.bold}>&lt; 10 buses:</Text> 100ms (fastest){'\n'}
            • <Text style={styles.bold}>10-50 buses:</Text> 250ms (normal){'\n'}
            • <Text style={styles.bold}>50-80 buses:</Text> 500ms (slow){'\n'}
            • <Text style={styles.bold}>80+ buses:</Text> 1000ms (very slow){'\n\n'}
            
            <Text style={styles.bold}>Performance Adjustments:</Text>{'\n'}
            • FPS &lt; 30: +200ms (critical){'\n'}
            • FPS &lt; 40: +100ms (warning){'\n'}
            • FPS &gt; 55: -25ms (optimal){'\n'}
            • Latency &gt; 150ms: +150ms{'\n'}
            • Latency &lt; 30ms: -25ms{'\n\n'}
            
            <Text style={styles.bold}>Idle Detection:</Text>{'\n'}
            • 3s no updates + &lt;30 buses → faster updates
          </Text>
        </ScrollView>
      </View>

      {/* Hidden WebView */}
      <WebView
        ref={webViewRef}
        source={{ html: '<!DOCTYPE html><html><body><div id="map"></div></body></html>' }}
        onLoadEnd={() => setWebViewReady(true)}
        onMessage={onMessage}
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
  webViewPanel: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  guidePanel: {
    flex: 1,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
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
  metricValueSmall: {
    fontSize: 12,
    color: '#666',
    flex: 1,
    textAlign: 'right',
  },
  guideText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#555',
  },
  bold: {
    fontWeight: 'bold',
    color: '#333',
  },
});
