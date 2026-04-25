import React, { useRef, useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity,
  Slider,
} from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Demo component for marker clustering
 */
export default function ClusteringDemo() {
  const webViewRef = useRef(null);
  const [webViewReady, setWebViewReady] = useState(false);
  const [stats, setStats] = useState({
    totalBuses: 0,
    clusters: 0,
    visible: 0,
    zoom: 12,
  });
  const [targetBusCount, setTargetBusCount] = useState(50);

  // Generate random buses
  const generateBuses = useCallback((count) => {
    const buses = [];
    const center = { lat: 40.7128, lng: -74.0060 }; // NYC
    
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * 0.1; // ~10km spread
      
      const lat = center.lat + (distance * Math.cos(angle));
      const lng = center.lng + (distance * Math.sin(angle));
      
      buses.push({
        id: `BUS_${String(i + 1).padStart(3, '0')}`,
        lat,
        lng,
        priority: Math.random() > 0.5 ? 0 : 1,
      });
    }
    
    return buses;
  }, []);

  // Send buses to WebView
  const updateBuses = useCallback(() => {
    if (!webViewRef.current || !webViewReady) return;
    
    const buses = generateBuses(targetBusCount);
    
    webViewRef.current.injectJavaScript(`
      // Clear existing
      if (window.busMarkers) {
        window.busMarkers.forEach(function(marker) {
          window.map.removeLayer(marker);
        });
        window.busMarkers.clear();
      }
      
      // Create new markers
      window.busMarkers = new Map();
      
      var buses = ${JSON.stringify(buses)};
      
      buses.forEach(function(bus) {
        var marker = L.marker([bus.la, bus.ln], {
          icon: L.divIcon({
            className: 'bus-marker',
            html: '<div style="background:#e74c3c;width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          })
        }).addTo(window.map);
        
        marker._priority = bus.p;
        window.busMarkers.set(bus.i, marker);
      });
      
      // Update clusters
      if (window.clusterManager) {
        window.clusterManager.updateClusters();
      }
      
      // Report stats
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'STATS',
          totalBuses: window.busMarkers.size,
          clusters: window.clusterManager ? window.clusterManager.clusters.size : 0,
          zoom: window.map ? window.map.getZoom() : 0
        }));
      }
      
      true;
    `);
    
    setStats(prev => ({ ...prev, totalBuses: targetBusCount }));
  }, [generateBuses, targetBusCount, webViewReady]);

  // Handle zoom change
  const handleZoom = useCallback((delta) => {
    webViewRef.current?.injectJavaScript(`
      if (window.map) {
        var currentZoom = window.map.getZoom();
        window.map.setZoom(currentZoom + ${delta});
        
        // Update clusters after zoom
        setTimeout(function() {
          if (window.clusterManager) {
            window.clusterManager.updateClusters();
          }
          
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'STATS',
              totalBuses: window.busMarkers ? window.busMarkers.size : 0,
              clusters: window.clusterManager ? window.clusterManager.clusters.size : 0,
              zoom: window.map ? window.map.getZoom() : 0
            }));
          }
        }, 300);
      }
      true;
    `);
  }, []);

  // Handle WebView messages
  const onMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'STATS') {
        setStats({
          totalBuses: data.totalBuses,
          clusters: data.clusters,
          visible: data.totalBuses - data.clusters, // Approximate
          zoom: data.zoom,
        });
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Marker Clustering Demo</Text>
      
      {/* Stats Panel */}
      <View style={styles.statsPanel}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Buses:</Text>
          <Text style={styles.statValue}>{stats.totalBuses}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Clusters:</Text>
          <Text style={[styles.statValue, { color: '#e74c3c' }]}>
            {stats.clusters}
          </Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Current Zoom:</Text>
          <Text style={styles.statValue}>{stats.zoom}</Text>
        </View>
        <Text style={styles.hint}>
          {'Zoom ≤ 12: Clustering active\nZoom > 12: Individual markers'}
        </Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <Text style={styles.controlLabel}>Bus Count: {targetBusCount}</Text>
        <Slider
          style={styles.slider}
          minimumValue={10}
          maximumValue={200}
          step={10}
          value={targetBusCount}
          onValueChange={setTargetBusCount}
        />
        
        <TouchableOpacity style={styles.button} onPress={updateBuses}>
          <Text style={styles.buttonText}>Generate Buses</Text>
        </TouchableOpacity>
        
        <View style={styles.zoomControls}>
          <TouchableOpacity 
            style={[styles.button, styles.zoomButton]} 
            onPress={() => handleZoom(-1)}
          >
            <Text style={styles.buttonText}>Zoom Out -</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.button, styles.zoomButton]} 
            onPress={() => handleZoom(1)}
          >
            <Text style={styles.buttonText}>Zoom In +</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                <style>
                  body { margin: 0; padding: 0; }
                  #map { width: 100vw; height: 100vh; }
                  .bus-cluster div {
                    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%) !important;
                    transition: transform 0.2s;
                  }
                  .bus-cluster div:hover {
                    transform: scale(1.1);
                  }
                </style>
              </head>
              <body>
                <div id="map"></div>
                <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" /><script>
                  // Initialize map
                  window.map = L.map('map').setView([40.7128, -74.0060], 12);
                  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19
                  }).addTo(window.map);
                  
                  // Initialize marker storage
                  window.busMarkers = new Map();
                  
                  // Inject clustering code
                  ${getClusteringCode()}
                  
                  console.log('[WEBVIEW] Map and clustering initialized');
                </script>
              </body>
            </html>
          `
        }}
        onLoadEnd={() => setWebViewReady(true)}
        onMessage={onMessage}
        style={styles.map}
      />
    </View>
  );
}

// Helper to get clustering code as string
function getClusteringCode() {
  return `
    window.clusterManager = {
      clusters: new Map(),
      gridSize: 0.02,
      maxZoom: 12,
      
      getGridKey: function(lat, lng, zoom) {
        var grid = this.gridSize * Math.pow(2, 15 - zoom);
        var latGrid = Math.floor(lat / grid);
        var lngGrid = Math.floor(lng / grid);
        return latGrid + ',' + lngGrid;
      },
      
      createClusterMarker: function(lat, lng, count, buses) {
        var clusterIcon = L.divIcon({
          className: 'bus-cluster',
          html: '<div style="background:#e74c3c;width:50px;height:50px;border-radius:50%;border:4px solid white;box-shadow:0 3px 15px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:16px;">' + count + '</div>',
          iconSize: [50, 50],
          iconAnchor: [25, 25]
        });
        
        var marker = L.marker([lat, lng], { icon: clusterIcon });
        marker._isCluster = true;
        marker._clusterCount = count;
        
        marker.on('click', function() {
          var currentZoom = window.map.getZoom();
          window.map.setView([lat, lng], currentZoom + 2);
        });
        
        return marker;
      },
      
      updateClusters: function() {
        if (!window.map || !window.busMarkers) return;
        
        var zoom = window.map.getZoom();
        
        if (zoom > this.maxZoom) {
          this.clearClusters();
          this.showAllMarkers();
          return;
        }
        
        var groups = new Map();
        
        window.busMarkers.forEach(function(marker, id) {
          var pos = marker.getLatLng();
          var key = this.getGridKey(pos.lat, pos.lng, zoom);
          
          if (!groups.has(key)) {
            groups.set(key, { markers: [], latSum: 0, lngSum: 0 });
          }
          
          var group = groups.get(key);
          group.markers.push(marker);
          group.latSum += pos.lat;
          group.lngSum += pos.lng;
        }.bind(this));
        
        this.clearClusters();
        
        groups.forEach(function(group, key) {
          if (group.markers.length === 1) {
            var marker = group.markers[0];
            if (!window.map.hasLayer(marker)) {
              marker.addTo(window.map);
            }
            marker.setOpacity(1);
          } else {
            var avgLat = group.latSum / group.markers.length;
            var avgLng = group.lngSum / group.markers.length;
            
            var cluster = this.createClusterMarker(avgLat, avgLng, group.markers.length, []);
            this.clusters.set(key, cluster);
            cluster.addTo(window.map);
            
            group.markers.forEach(function(m) {
              m.setOpacity(0);
              if (window.map.hasLayer(m)) {
                window.map.removeLayer(m);
              }
            });
          }
        }.bind(this));
        
        console.log('[CLUSTER] ' + this.clusters.size + ' clusters from ' + window.busMarkers.size + ' markers');
      },
      
      clearClusters: function() {
        this.clusters.forEach(function(cluster) {
          if (window.map && window.map.hasLayer(cluster)) {
            window.map.removeLayer(cluster);
          }
        });
        this.clusters.clear();
      },
      
      showAllMarkers: function() {
        window.busMarkers.forEach(function(marker) {
          if (window.map) {
            if (!window.map.hasLayer(marker)) {
              marker.addTo(window.map);
            }
            marker.setOpacity(1);
          }
        });
      }
    };
    
    // Update on zoom
    window.map.on('zoomend', function() {
      window.clusterManager.updateClusters();
    });
  `;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    padding: 12,
    backgroundColor: 'white',
  },
  statsPanel: {
    backgroundColor: 'white',
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 8,
    borderRadius: 8,
    elevation: 2,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  hint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  controls: {
    backgroundColor: 'white',
    padding: 16,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    elevation: 2,
  },
  controlLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  slider: {
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  zoomControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  zoomButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  map: {
    flex: 1,
    margin: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
