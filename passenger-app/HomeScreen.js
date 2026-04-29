import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";
import { fetchNearbyBuses, expandBusData } from "./api/busApi";
import { useBus } from "./BusContext";

const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";
const DEFAULT_CENTER = { latitude: 13.1044, longitude: 79.9079 };

// Nearest Bus Stop Card Component
const BusStopCard = ({ stopName, distance, nextBusTime, onPress }) => (
  <TouchableOpacity style={styles.stopCard} onPress={onPress}>
    <View style={styles.stopIconContainer}>
      <Text style={styles.stopIcon}>🚏</Text>
    </View>
    <View style={styles.stopInfo}>
      <Text style={styles.stopName}>{stopName}</Text>
      <Text style={styles.stopDistance}>{distance} away</Text>
      <Text style={styles.nextBus}>Next bus: {nextBusTime}</Text>
    </View>
    <Text style={styles.chevron}>›</Text>
  </TouchableOpacity>
);

// Mini Map Component - VIEW ONLY
const MiniMap = ({ webViewRef, setWebViewReady, onPress, buses, userLocation }) => {
  const mapHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    html, body, #map { height: 100%; margin: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    // Initialize map - MAP_READY sent only when map is fully ready
    var map = L.map('map').setView([13.0827, 80.2707], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    // Hardened MAP_READY delivery - multiple safeguards
    window.__MAP_READY_SENT__ = false;
    
    function sendMapReady() {
      if (window.__MAP_READY_SENT__) return; // Idempotent
      if (!window.ReactNativeWebView) {
        console.log("[WEBVIEW] ReactNativeWebView not available");
        return;
      }
      
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: "MAP_READY" })
      );
      window.__MAP_READY_SENT__ = true;
      console.log("[WEBVIEW] MAP_READY sent (idempotent)");
    }
    
    // Primary: Send when map is ready
    map.whenReady(function() {
      sendMapReady();
    });
    
    // Fallback 1: 1 second timeout in case whenReady fails
    setTimeout(function() {
      if (!window.__MAP_READY_SENT__) {
        console.log("[WEBVIEW] Fallback timeout triggered");
        sendMapReady();
      }
    }, 1000);
    
    // Fallback 2: DOM ready as last resort
    if (document.readyState === "complete") {
      sendMapReady();
    } else {
      document.addEventListener("DOMContentLoaded", function() {
        if (!window.__MAP_READY_SENT__) {
          console.log("[WEBVIEW] DOMContentLoaded fallback");
          sendMapReady();
        }
      });
    }

    // Marker storage
    window.busMarkers = {};
    window.userMarker = null; // Single user marker - no duplicates

    // Unified message handler - works with both document and window events
    function handleMessage(event) {
      try {
        // Log RAW data first
        console.log("[WEBVIEW] RAW:", event.data);
        
        if (!event || !event.data) {
          console.log("[WEBVIEW] Empty message, skipping");
          return;
        }

        var data = JSON.parse(event.data);
        console.log("[WEBVIEW] TYPE:", data ? data.type : "null");
        if (!data || !data.type) {
          console.log("[WEBVIEW] Invalid message format");
          return;
        }

        switch (data.type) {
          case "TEST":
            console.log("[WEBVIEW] TEST message received - bridge is working!");
            break;
          case "USER_LOCATION":
            // Support both: flat structure and payload structure (backward compatible)
            const lat = data.latitude ?? data.payload?.latitude;
            const lng = data.longitude ?? data.payload?.longitude;
            
            if (lat != null && lng != null) {
              handleUserLocation(Number(lat), Number(lng));
            } else {
              console.log("[WEBVIEW] Invalid USER_LOCATION - missing lat/lng:", data);
            }
            break;

          case "BUS_OFFLINE":
            // Instant marker removal for offline buses
            if (data.busId) {
              console.log("[WEBVIEW] Bus offline: " + data.busId);
              var marker = window.busMarkers[data.busId];
              if (marker && map && map.removeLayer) {
                map.removeLayer(marker);
                delete window.busMarkers[data.busId];
              }
            }
            break;

          case "BUS_UPDATE":
            // Strict payload contract validation
            if (!Array.isArray(data.buses)) {
              console.log("[WEBVIEW] Invalid BUS_UPDATE payload");
              return;
            }
            console.log("[WEBVIEW] buses: " + data.buses.length);
            if (data.buses.length === 0) {
              console.log("[WEBVIEW] No active buses");
            }
            updateBuses(data.buses);
            break;

          default:
            console.log("[WEBVIEW] Unknown message type: " + data.type);
        }
      } catch (e) {
        console.log("[WEBVIEW] Invalid message: " + e.message);
      }
    }

    // Handle user location - single marker, center map, no duplicates
    function handleUserLocation(lat, lng) {
      console.log("[WEBVIEW] handleUserLocation called:", lat, lng);
      if (typeof lat !== "number" || typeof lng !== "number") {
        console.log("[WEBVIEW] Invalid user location types:", typeof lat, typeof lng);
        return;
      }

      // Center map on user location
      map.setView([lat, lng], 14);
      console.log("[WEBVIEW] Map centered on user location");

      // Create or update single user marker
      if (window.userMarker) {
        window.userMarker.setLatLng([lat, lng]);
        console.log("[WEBVIEW] User marker updated");
      } else {
        // Custom icon for user location (blue circle)
        var userIcon = L.divIcon({
          className: "user-location-marker",
          html: '<div style="width: 16px; height: 16px; background: #0066ff; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        window.userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
        console.log("[WEBVIEW] User marker created");
      }

      // Center map on user location (smooth pan)
      map.panTo([lat, lng], { animate: true, duration: 0.5 });

      console.log("[WEBVIEW] User location updated: " + lat + ", " + lng);
    }

    // Prevent duplicate listeners on WebView reload
    // Attach BOTH document and window listeners for cross-platform compatibility
    if (!window.__BUS_LISTENER_ATTACHED__) {
      window.__BUS_LISTENER_ATTACHED__ = true;
      document.addEventListener("message", handleMessage);
      window.addEventListener("message", handleMessage);
      console.log("[WEBVIEW] Message listeners attached (document + window)");
    }

    // Marker system with strict validation and timestamp ordering
    function updateBuses(buses) {
      if (!window.busMarkers) window.busMarkers = {};

      // Validate array input
      if (!Array.isArray(buses)) {
        console.log("[WEBVIEW] Invalid buses data");
        return;
      }

      var existingIds = {};
      var keys = Object.keys(window.busMarkers);

      for (var i = 0; i < keys.length; i++) {
        existingIds[keys[i]] = true;
      }

      var processedCount = 0;
      for (var i = 0; i < buses.length; i++) {
        var bus = buses[i];

        // Strict ID consistency - use bus._id only
        if (!bus || !bus._id || typeof bus._id !== "string") continue;
        
        // Support both lat/lng and latitude/longitude property names
        var busLat = bus.lat ?? bus.latitude;
        var busLng = bus.lng ?? bus.longitude;
        if (typeof busLat !== "number" || typeof busLng !== "number") continue;
        
        processedCount++;

        var id = bus._id;
        var marker = window.busMarkers[id];

        // Warning for missing lastUpdate
        if (!bus.lastUpdate) {
          console.log("[WEBVIEW] Warning: missing lastUpdate for " + id);
        }

        // Check timestamp ordering - ignore stale updates (backend-driven only)
        if (marker && marker._ts && bus.lastUpdate) {
          if (marker._ts > bus.lastUpdate) {
            console.log("[WEBVIEW] Stale update ignored for " + id);
            continue;
          }
        }

        // Update existing marker (no duplicates)
        if (marker) {
          marker.setLatLng([busLat, busLng]);
          if (bus.lastUpdate) marker._ts = bus.lastUpdate;
        } else {
          // Create new marker with bus icon
          var busIcon = L.divIcon({
            className: "bus-marker",
            html: '<div style="font-size:24px;">🚌</div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });
          var newMarker = L.marker([busLat, busLng], { icon: busIcon }).addTo(map);
          if (bus.lastUpdate) newMarker._ts = bus.lastUpdate;
          window.busMarkers[id] = newMarker;
        }

        delete existingIds[id];
      }

      // Remove markers not in payload (ghost marker prevention)
      for (var id in existingIds) {
        if (existingIds.hasOwnProperty(id)) {
          var markerToRemove = window.busMarkers[id];

          // Crash-safe removal
          if (markerToRemove && map && map.removeLayer) {
            map.removeLayer(markerToRemove);
          }

          delete window.busMarkers[id];
        }
      }
      
      console.log("[WEBVIEW] Processed " + processedCount + " buses, " + Object.keys(window.busMarkers).length + " markers total");
    }

    // Handle BUS_OFFLINE - instant marker removal
    function handleBusOffline(busId) {
      if (!window.busMarkers || !busId) return;

      var marker = window.busMarkers[busId];
      if (marker && map && map.removeLayer) {
        map.removeLayer(marker);
        delete window.busMarkers[busId];
        console.log("[WEBVIEW] Bus offline removed: " + busId);
      }
    }
  </script>
</body>
</html>
  `;

  // Handle MAP_READY from WebView - idempotent, always resend USER_LOCATION
  const handleWebViewMessage = (event) => {
    try {
      if (!event || !event.nativeEvent || !event.nativeEvent.data) return;

      var data = JSON.parse(event.nativeEvent.data);
      if (!data || !data.type) return;

      // Idempotent MAP_READY handling - safe for duplicates
      if (data.type === "MAP_READY") {
        const alreadyReady = webViewReady;
        console.log("[RN] MAP_READY received (alreadyReady:", alreadyReady, ")");
        
        // Always mark as ready (idempotent)
        if (!alreadyReady) {
          setWebViewReady(true);
        }

        // ALWAYS resend cached user location on MAP_READY (recovery mechanism)
        if (lastUserLocationRef.current && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "USER_LOCATION",
            latitude: lastUserLocationRef.current.latitude,
            longitude: lastUserLocationRef.current.longitude
          }));
          console.log("[RN] USER_LOCATION resent on MAP_READY");
        }

        // ALSO send BUS_UPDATE on MAP_READY
        if (buses && webViewRef.current) {
          const busesArray = buses && typeof buses === 'object' && !Array.isArray(buses) 
            ? Object.values(buses) 
            : (buses || []);
          const activeBuses = busesArray.filter(bus =>
            bus && bus._id && bus.trackingActive === true &&
            typeof bus.lat === "number" && typeof bus.lng === "number"
          );
          
          webViewRef.current.postMessage(JSON.stringify({
            type: "BUS_UPDATE",
            buses: activeBuses
          }));
          console.log("[RN] BUS_UPDATE sent on MAP_READY - count:", activeBuses.length);
        }
      }
      
      // PING → MAP_READY recovery (optional handshake)
      if (data.type === "PING") {
        console.log("[RN] PING received, responding with PONG");
        webViewRef.current?.postMessage(JSON.stringify({ type: "PONG" }));
      }
    } catch (e) {
      console.log("[MiniMap] Invalid message:", event?.nativeEvent?.data, e.message);
    }
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
      <View style={styles.mapContainer}>
        <WebView
          ref={webViewRef}
          source={{ html: mapHTML }}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          originWhitelist={["*"]}
          scrollEnabled={false}
          style={{ width: '100%', height: 200 }}
        />
      </View>
    </TouchableOpacity>
  );
};

const HomeScreen = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState(DEFAULT_CENTER);
  const { buses, socket } = useBus();
  const [sosAlerts, setSosAlerts] = useState([]);
  const webViewRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const messageQueueRef = useRef({});
  const lastSentRef = useRef(null);
  const lastUserLocationRef = useRef(null); // Cache for resend on WebView load
  const [webViewReady, setWebViewReady] = useState(false);

  // Track alerted SOS buses to prevent duplicate alerts
  const alertedSOS = useRef(new Set());

  // Send BUS_UPDATE to WebView when buses change and WebView is ready
  useEffect(() => {
    console.log("[RN] Bus Update Effect - webViewReady:", webViewReady, "webViewRef:", !!webViewRef.current);
    // TEMPORARILY BYPASSED FOR TESTING - uncomment guard after verifying communication
    // if (!webViewReady || !webViewRef.current) {
    //   console.log("[RN] Skipping bus update - WebView not ready");
    //   return;
    // }
    if (!webViewRef.current) {
      console.log("[RN] Skipping bus update - no WebView ref");
      return;
    }

    // Convert buses object to array and filter active buses with valid coordinates
    const busesArray = buses ? Object.values(buses) : [];
    console.log("[RN] Buses state raw:", buses);
    console.log("[RN] Buses array count:", busesArray.length);
    console.log("[RN] Buses sample:", busesArray.slice(0, 2));
    
    const activeBuses = busesArray.filter(bus =>
      bus &&
      bus._id &&
      bus.trackingActive === true &&
      typeof bus.lat === "number" &&
      typeof bus.lng === "number"
    );
    
    console.log("[RN] Active buses for MiniMap:", activeBuses.length);

    // ORDER-INDEPENDENT + NOISE-REDUCED SIGNATURE
    const signature = activeBuses
      .slice()
      .sort((a, b) => (a._id > b._id ? 1 : -1))
      .map(b =>
        b._id +
        "_" +
        b.lat.toFixed(5) +
        "_" +
        b.lng.toFixed(5)
      )
      .join("|");

    // Skip identical updates
    if (lastSentRef.current === signature) return;
    lastSentRef.current = signature;

    const payload = JSON.stringify({
      type: "BUS_UPDATE",
      buses: activeBuses,
    });

    console.log("[RN] Sending BUS_UPDATE - count:", activeBuses.length);
    console.log("[RN] Payload preview:", payload.substring(0, 200));

    // Primary send
    webViewRef.current.postMessage(payload);
    console.log("[RN] postMessage called for BUS_UPDATE");

    // Clear previous retry (prevents stacking under rapid updates)
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    // Retry with LATEST data (prevents stale resend)
    retryTimeoutRef.current = setTimeout(() => {
      const ref = webViewRef.current;
      if (!ref) return;

      const latestBusesArray = buses ? Object.values(buses) : [];
      const latestActiveBuses = latestBusesArray.filter(bus =>
        bus &&
        bus._id &&
        bus.trackingActive === true &&
        typeof bus.lat === "number" &&
        typeof bus.lng === "number"
      );

      const latestPayload = JSON.stringify({
        type: "BUS_UPDATE",
        buses: latestActiveBuses,
      });

      ref.postMessage(latestPayload);
      console.log("[RN] Retry send active buses:", latestActiveBuses.length);
    }, 300);
  }, [webViewReady, buses]);

  // Socket listener for BUS_LOCATION_UPDATE with logging
  useEffect(() => {
    if (!socket) return;

    const handleBusLocationUpdate = (data) => {
      console.log("[RN HomeScreen] BUS_LOCATION_UPDATE received:", data);
    };

    socket.on("BUS_LOCATION_UPDATE", handleBusLocationUpdate);
    console.log("[RN HomeScreen] BUS_LOCATION_UPDATE listener registered");

    return () => {
      socket.off("BUS_LOCATION_UPDATE", handleBusLocationUpdate);
    };
  }, [socket]);

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Fetch user location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  // Send USER_LOCATION to MiniMap WebView when location changes
  // Standardized schema: { type: "USER_LOCATION", payload: { latitude, longitude } }
  useEffect(() => {
    if (!userLocation) return;

    // Cache in ref for resend on WebView load (no state used)
    lastUserLocationRef.current = {
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
    };

    // Send immediately if WebView ref exists (webViewReady bypassed for testing)
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: "USER_LOCATION",
        latitude: lastUserLocationRef.current.latitude,
        longitude: lastUserLocationRef.current.longitude
      }));
      console.log("[RN] Sent USER_LOCATION to MiniMap (webViewReady:", webViewReady, ")");
    } else {
      console.log("[RN] USER_LOCATION deferred - no WebView ref");
    }
  }, [userLocation, webViewReady]);

  // Safe sender to WebView with deduplicated queue
  const sendToWebView = useCallback((msg) => {
    if (!webViewRef.current || !webViewReady) {
      // Store only latest per key (prevents stale replay)
      const key = msg.busId || msg.type || "default";
      messageQueueRef.current[key] = msg;
      console.log("[RN] WebView not ready, message queued:", msg.type, key);
      return;
    }
    webViewRef.current.postMessage(JSON.stringify(msg));
  }, [webViewReady]);

  // Test button handler - sends TEST message to WebView
  const sendTestMessage = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({ type: "TEST" }));
      console.log("[RN] TEST message sent to WebView");
    } else {
      console.log("[RN] Cannot send TEST - no WebView ref");
    }
  }, []);

  // Flush queued messages when WebView becomes ready
  useEffect(() => {
    if (!webViewReady || !webViewRef.current) return;
    
    const queue = messageQueueRef.current;
    const keys = Object.keys(queue);
    if (keys.length > 0) {
      console.log("[RN] Flushing", keys.length, "queued messages");
      keys.forEach(key => {
        webViewRef.current.postMessage(JSON.stringify(queue[key]));
      });
      messageQueueRef.current = {};
    }
  }, [webViewReady]);

  // Socket listener for BUS_OFFLINE - instant marker removal
  useEffect(() => {
    if (!socket) return;

    const handleBusOffline = (busId) => {
      console.log("[RN] Bus offline:", busId);
      sendToWebView({ type: "BUS_OFFLINE", busId });
    };

    socket.on("BUS_OFFLINE", handleBusOffline);

    return () => {
      socket.off("BUS_OFFLINE", handleBusOffline);
    };
  }, [socket, sendToWebView]);

  // Convert buses object to array and filter active buses
  const busesArray = buses && typeof buses === 'object' && !Array.isArray(buses) 
    ? Object.values(buses) 
    : (buses || []);
  
  const filteredBuses = busesArray.filter(
    bus => bus && bus.trackingActive === true
  );

  // Navigate to full map
  const handleMapPress = () => {
    navigation.navigate("FullMap", {
      buses: filteredBuses,
      userLocation: userLocation
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>V-Bus</Text>
          <Text style={styles.subtitle}>Smart Campus Transport</Text>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search bus or route..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Nearest Bus Stop Card */}
        <BusStopCard
          stopName="VIT Main Gate"
          distance="200m"
          nextBusTime="2 min"
          onPress={() => console.log("Stop pressed")}
        />

        {/* Mini Map */}
        <View style={styles.mapSection}>
          <Text style={styles.sectionTitle}>Live Tracking</Text>
          <Text style={styles.busCount}>{filteredBuses.length} buses nearby</Text>
          <MiniMap
            webViewRef={webViewRef}
            setWebViewReady={setWebViewReady}
            onPress={handleMapPress}
            buses={filteredBuses}
            userLocation={userLocation}
          />
          {/* TEST Button for WebView bridge verification */}
          <TouchableOpacity 
            style={styles.testButton}
            onPress={sendTestMessage}
          >
            <Text style={styles.testButtonText}>TEST WebView Bridge</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5D7A1",
  },

  scrollView: {
    flex: 1,
  },

  header: {
    padding: 16,
    paddingTop: 40,
  },

  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#000",
  },

  subtitle: {
    fontSize: 12,
    color: "#333",
  },

  searchContainer: {
    margin: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  searchInput: {
    fontSize: 16,
  },

  stopCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  stopIconContainer: {
    marginRight: 10,
  },

  stopIcon: {                 
    fontSize: 18,
  },

  stopInfo: {
    flex: 1,
  },

  stopName: {
    fontWeight: "bold",
    fontSize: 14,
  },

  stopDistance: {
    fontSize: 12,
    color: "#666",
  },

  nextBus: {
    fontSize: 12,
    color: "#333",
  },

  chevron: {
    fontSize: 18,
  },

  mapSection: {
    marginTop: 10,
  },

  sectionTitle: {
    marginLeft: 16,
    marginBottom: 6,
    fontWeight: "bold",
    fontSize: 16,
  },

  busCount: {
    marginLeft: 16,
    fontSize: 12,
    color: "#666",
  },

  miniMap: {
    height: 180,
    margin: 16,
    borderRadius: 12,
    overflow: "hidden",
  },

  testButton: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: "#0066ff",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },

  testButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
});

export default HomeScreen;
