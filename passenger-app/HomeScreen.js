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

    /* Beacon pulse animation - Google Maps style */
    .beacon-container { position: relative; }
    .beacon-dot {
      width: 12px;
      height: 12px;
      background: #007AFF;
      border-radius: 50%;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2;
    }
    .beacon-pulse {
      width: 40px;
      height: 40px;
      background: rgba(0,122,255,0.3);
      border-radius: 50%;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      animation: pulse-ring 1.5s ease-out infinite;
      z-index: 1;
    }
    @keyframes pulse-ring {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }

    /* Modern Popup Styles */
    .bus-popup { padding: 12px; min-width: 160px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .bus-popup-header { font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #333; }
    .bus-popup-row { font-size: 12px; color: #666; margin: 4px 0; }

    /* Toggle Switch */
    .follow-toggle { display: flex; align-items: center; margin-top: 8px; cursor: pointer; }
    .follow-toggle input { display: none; }
    .toggle-slider {
      width: 40px; height: 20px; background: #ccc; border-radius: 10px;
      position: relative; transition: 0.3s; margin-right: 8px;
    }
    .toggle-slider::after {
      content: ''; position: absolute; width: 16px; height: 16px;
      background: white; border-radius: 50%; top: 2px; left: 2px;
      transition: 0.3s;
    }
    .follow-toggle input:checked + .toggle-slider { background: #007AFF; }
    .follow-toggle input:checked + .toggle-slider::after { left: 22px; }
    .toggle-label { font-size: 12px; color: #333; }
  </style>
</head>
<body>
  <div id="map" style="height:100vh;"></div>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    // Wrap ALL logic inside DOMContentLoaded to ensure Leaflet + DOM are ready
    document.addEventListener("DOMContentLoaded", function() {
      console.log("[WEBVIEW] DOMContentLoaded - Initializing map...");

      // 1. CREATE MAP FIRST (zoomControl disabled, use RN buttons only)
      var map = L.map('map', { zoomControl: false }).setView([13.0827, 80.2707], 13);
      window.map = map; // Expose globally

      // 2. ADD TILE LAYER
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      // 3. CREATE GLOBALS AFTER MAP EXISTS
      window.__MAP_READY__ = false;
      window.__MAP_READY_SENT__ = false;
      window.__BUS_LISTENER_ATTACHED__ = false;
      window.busMarkers = {};
      window.userMarker = null;
      window.userPulse = null;
      window.followBusId = null;
      window.userLocation = null;
      window._lastFollow = 0;
      window.__pulseRadius = 0;
      window.__pulseInterval = null;

      // 4. MAP READY HANDLER
      function sendMapReady() {
        if (window.__MAP_READY_SENT__) return;
        if (!window.ReactNativeWebView) {
          console.log("[WEBVIEW] ReactNativeWebView not available");
          return;
        }
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: "MAP_READY" })
        );
        window.__MAP_READY_SENT__ = true;
        console.log("[WEBVIEW] MAP_READY sent");
      }

      // 5. WHEN MAP IS ACTUALLY READY
      map.whenReady(function() {
        window.__MAP_READY__ = true;
        console.log("[WEBVIEW] Map is ready");
        sendMapReady();
      });

      // 6. FALLBACK TIMEOUT
      setTimeout(function() {
        if (!window.__MAP_READY_SENT__) {
          console.log("[WEBVIEW] Fallback timeout - forcing MAP_READY");
          window.__MAP_READY__ = true;
          sendMapReady();
        }
      }, 1500);

      // 7. MESSAGE HANDLER
      function handleMessage(event) {
        try {
          if (!event || !event.data) return;

          var data;
          try {
            data = JSON.parse(event.data);
          } catch (e) {
            console.log("[WEBVIEW] JSON parse error:", e.message);
            return;
          }

          console.log("[WEBVIEW] Received:", data.type);

          switch (data.type) {
            case "USER_LOCATION":
              if (!window.map) return;
              console.log("[WEBVIEW] USER_LOCATION received:", data.payload);
              const lat = data.payload?.lat;
              const lng = data.payload?.lng;
              if (lat != null && lng != null) {
                setUserLocation(Number(lat), Number(lng));
              }
              break;

            case "FOLLOW_UPDATE":
              window.__followBusId = data.busId || null;
              console.log("[WEBVIEW] FOLLOW_UPDATE:", window.__followBusId);
              break;

            case "ZOOM_IN":
              if (window.map) window.map.zoomIn();
              break;

            case "ZOOM_OUT":
              if (window.map) window.map.zoomOut();
              break;

            case "RECENTER":
              if (window.map && window.userMarker) {
                const pos = window.userMarker.getLatLng();
                window.map.flyTo(pos, 15, { duration: 0.5 });
              }
              break;

            case "BUS_OFFLINE":
              if (data.busId && window.busMarkers[data.busId]) {
                if (window.map && window.map.removeLayer) {
                  window.map.removeLayer(window.busMarkers[data.busId]);
                }
                delete window.busMarkers[data.busId];
                if (window.followBusId === data.busId) {
                  window.followBusId = null;
                  if (window.userLocation && window.map && window.map.panTo) {
                    window.map.panTo([window.userLocation.lat, window.userLocation.lng], { animate: true });
                  }
                }
              }
              break;

            case "BUS_LOCATION_UPDATE":
              if (!data || !data.busId) return;
              updateBusMarker(data);
              break;

            case "BUS_UPDATE":
              if (!Array.isArray(data.buses)) {
                console.log("[WEBVIEW] Invalid BUS_UPDATE");
                return;
              }

              // Process buses
              data.buses.forEach(function(bus) {
                if (!bus || !bus._id) return;
                var busLat = bus.lat ?? bus.latitude;
                var busLng = bus.lng ?? bus.longitude;
                if (typeof busLat !== "number" || typeof busLng !== "number") return;

                var marker = window.busMarkers[bus._id];
                if (marker) {
                  marker.setLatLng([busLat, busLng]);
                  if (bus.lastUpdate) marker._ts = bus.lastUpdate;
                } else {
                  var busIcon = L.divIcon({
                    className: "bus-marker",
                    html: '<div style="font-size:24px;">🚌</div>',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  });
                  var newMarker = L.marker([busLat, busLng], { icon: busIcon }).addTo(window.map);
                  if (bus.lastUpdate) newMarker._ts = bus.lastUpdate;
                  window.busMarkers[bus._id] = newMarker;
                }
              });

              // Cleanup stale markers (not in current update)
              var currentIds = {};
              data.buses.forEach(function(b) { if (b && b._id) currentIds[b._id] = true; });
              Object.keys(window.busMarkers).forEach(function(id) {
                if (!currentIds[id]) {
                  if (window.map && window.map.removeLayer) {
                    window.map.removeLayer(window.busMarkers[id]);
                  }
                  delete window.busMarkers[id];
                }
              });

              console.log("[WEBVIEW] Active buses:", Object.keys(window.busMarkers).length);
              break;

            default:
              console.log("[WEBVIEW] Unknown type:", data.type);
          }
        } catch (e) {
          console.log("[WEBVIEW] Handler error:", e.message);
        }
      }

      // 8. ATTACH LISTENERS
      if (!window.__BUS_LISTENER_ATTACHED__) {
        window.__BUS_LISTENER_ATTACHED__ = true;
        document.addEventListener("message", handleMessage);
        window.addEventListener("message", handleMessage);
        console.log("[WEBVIEW] Listeners attached");
      }

      // UNIFIED SET USER LOCATION (with CSS pulse - zoom independent)
      function setUserLocation(lat, lng) {
        if (!window.map) return;

        const pos = [lat, lng];
        window.userLocation = { lat, lng };

        // Marker (create once)
        if (!window.userMarker) {
          window.userMarker = L.circleMarker(pos, {
            radius: 6,
            color: "#007AFF",
            fillColor: "#007AFF",
            fillOpacity: 1,
          }).addTo(window.map);

          window.userMarker.bindPopup("📍 I am here");
        } else {
          window.userMarker.setLatLng(pos);
        }

        // CSS Pulse marker (create once) - zoom independent divIcon
        if (!window.userPulse) {
          const pulseIcon = L.divIcon({
            className: 'beacon-container',
            html: '<div class="beacon-dot"></div><div class="beacon-pulse"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          window.userPulse = L.marker(pos, { icon: pulseIcon, zIndexOffset: -100 }).addTo(window.map);
        } else {
          window.userPulse.setLatLng(pos);
        }
      }

      // SINGLE POPUP GENERATOR with toggle switch
      function getBusPopup(bus) {
        const isFollowing = window.__followBusId === bus.id;
        const speed = Math.round(bus.speed || 0);
        const eta = bus.eta ?? "--";
        return \`
          <div class="bus-popup">
            <div class="bus-popup-header">\${bus.name || "Bus"}</div>
            <div class="bus-popup-row">Speed: \${speed} km/h</div>
            <div class="bus-popup-row">ETA: \${eta} min</div>
            <label class="follow-toggle">
              <input type="checkbox" \${isFollowing ? 'checked' : ''} onchange="toggleFollow('\${bus.id}')">
              <span class="toggle-slider"></span>
              <span class="toggle-label">\${isFollowing ? 'Following' : 'Follow'}</span>
            </label>
          </div>
        \`;
      }

      // TOGGLE FOLLOW with optimistic UI update
      window.toggleFollow = function(busId) {
        // Optimistic update: toggle immediately
        const wasFollowing = window.__followBusId === busId;
        window.__followBusId = wasFollowing ? null : busId;

        // Update popup content immediately if open
        const marker = window.busMarkers[busId];
        if (marker && marker.getPopup()?.isOpen() && marker.__busData) {
          marker.setPopupContent(getBusPopup(marker.__busData));
        }

        // Send to React Native
        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            type: "TOGGLE_FOLLOW",
            busId,
          })
        );
      };

      // RECENTER FUNCTION
      function recenterToUser() {
        if (!window.map || !window.userMarker) return;
        const pos = window.userMarker.getLatLng();
        window.map.flyTo(pos, 15, { duration: 0.5 });
      }

      // DRAG DETECTION
      window.map.on("dragstart", () => {
        window.__userDragging = true;

        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: "FOLLOW_STOPPED" })
        );
      });

      // UPDATE BUS MARKER (no recreation)
      window.__followBusId = null;
      window.__userDragging = false;
      window.__lastFlyTo = 0;

      function updateBusMarker(data) {
        if (!window.map || !data.busId) return;

        const busId = data.busId;
        const lat = data.latitude ?? data.lat;
        const lng = data.longitude ?? data.lng;
        const speed = data.speed ?? 0;

        if (typeof lat !== "number" || typeof lng !== "number") return;

        const busData = {
          id: busId,
          name: data.name || busId,
          speed: speed,
          eta: data.eta,
        };

        if (!window.busMarkers[busId]) {
          // CREATE NEW MARKER
          const marker = L.marker([lat, lng]).addTo(window.map);

          marker.bindPopup(getBusPopup(busData));
          window.busMarkers[busId] = marker;
        }

        // Store full bus data on marker for optimistic updates
        const marker = window.busMarkers[busId];
        marker.__busData = busData;

        // Update position
        marker.setLatLng([lat, lng]);

        // Update popup content safely (only if open)
        if (marker.getPopup()?.isOpen()) {
          marker.setPopupContent(getBusPopup(busData));
        }

        // CAMERA FOLLOW (throttled)
        if (
          window.__followBusId === busId &&
          !window.__userDragging &&
          Date.now() - window.__lastFlyTo > 500
        ) {
          window.__lastFlyTo = Date.now();

          window.map.flyTo([lat, lng], window.map.getZoom(), {
            duration: 0.5,
          });
        }
      }

      // BUS_UPDATE handler (batch update)
      window.__busUpdatePending = null;
      function handleBusUpdate(buses) {
        if (!Array.isArray(buses)) return;
        buses.forEach(function(bus) {
          if (!bus || !bus._id) return;
          updateBusMarker({
            busId: bus._id,
            latitude: bus.lat ?? bus.latitude,
            longitude: bus.lng ?? bus.longitude,
            speed: bus.speed ?? 0,
            name: bus.name,
          });
        });
      }

      console.log("[WEBVIEW] Initialization complete, waiting for map...");
    });
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
            payload: {
              lat: lastUserLocationRef.current.lat,
              lng: lastUserLocationRef.current.lng
            }
          }));
          console.log("[RN] USER_LOCATION resent on MAP_READY");
        }

        // ALSO resend FOLLOW_UPDATE on MAP_READY
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "FOLLOW_UPDATE",
            busId: followBusId
          }));
          console.log("[RN] FOLLOW_UPDATE resent on MAP_READY");
        }
      }
      
      // PING → MAP_READY recovery (optional handshake)
      if (data.type === "PING") {
        console.log("[RN] PING received, responding with PONG");
        webViewRef.current?.postMessage(JSON.stringify({ type: "PONG" }));
      }

      // FOLLOW_STOPPED from WebView (user dragged map)
      if (data.type === "FOLLOW_STOPPED") {
        console.log("[RN] FOLLOW_STOPPED from MiniMap WebView");
        setFollowBusId(null);
        return;
      }

      // TOGGLE_FOLLOW from WebView (popup button clicked)
      if (data.type === "TOGGLE_FOLLOW") {
        console.log("[RN] TOGGLE_FOLLOW from MiniMap:", data.busId);
        setFollowBusId(prev => prev === data.busId ? null : data.busId);
        return;
      }
    } catch (e) {
      console.log("[MiniMap] Invalid message:", event?.nativeEvent?.data, e.message);
    }
  };

  return (
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
      {/* Zoom Controls */}
      <View style={styles.zoomControls}>
        <TouchableOpacity
          style={styles.zoomButton}
          onPress={() => webViewRef.current?.postMessage(JSON.stringify({ type: "ZOOM_IN" }))}
        >
          <Text style={styles.zoomText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.zoomButton}
          onPress={() => webViewRef.current?.postMessage(JSON.stringify({ type: "ZOOM_OUT" }))}
        >
          <Text style={styles.zoomText}>−</Text>
        </TouchableOpacity>
      </View>
      {/* Recenter Button */}
      <TouchableOpacity
        style={[styles.zoomButton, { position: 'absolute', bottom: 10, left: 10, backgroundColor: '#007AFF' }]}
        onPress={() => webViewRef.current?.postMessage(JSON.stringify({ type: "RECENTER" }))}
      >
        <Text style={{ color: 'white', fontSize: 18 }}>⌖</Text>
      </TouchableOpacity>
      {/* Full Map Button */}
      <TouchableOpacity style={styles.fullMapButton} onPress={onPress}>
        <Text style={styles.fullMapText}>Full Map</Text>
      </TouchableOpacity>
    </View>
  );
};

const HomeScreen = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState(DEFAULT_CENTER);
  const { buses, socket } = useBus();
  
  // Local follow state (single source of truth for this screen)
  const [followBusId, setFollowBusId] = useState(null);
  const [sosAlerts, setSosAlerts] = useState([]);
  const webViewRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const messageQueueRef = useRef({});
  const lastSentRef = useRef(null);
  const lastUserLocationRef = useRef(null); // Cache for resend on WebView load
  const [webViewReady, setWebViewReady] = useState(false);

  // Track alerted SOS buses to prevent duplicate alerts
  const alertedSOS = useRef(new Set());

  // Send USER_LOCATION to MiniMap WebView when location changes
  useEffect(() => {
    if (!userLocation) return;

    // Cache in ref for resend on WebView load
    lastUserLocationRef.current = {
      lat: userLocation.latitude,
      lng: userLocation.longitude,
    };

    // Send to MiniMap WebView
    const msg = {
      type: "USER_LOCATION",
      payload: {
        lat: userLocation.latitude,
        lng: userLocation.longitude
      }
    };

    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
      console.log("[RN] Sent USER_LOCATION to MiniMap:", userLocation.latitude, userLocation.longitude);
    }
  }, [userLocation, webViewReady]);

  // Send FOLLOW_UPDATE to MiniMap WebView when followBusId changes
  useEffect(() => {
    const msg = {
      type: "FOLLOW_UPDATE",
      busId: followBusId,
    };

    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
      console.log("[RN] Sent FOLLOW_UPDATE to MiniMap:", followBusId);
    }
  }, [followBusId, webViewReady]);

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

  mapContainer: {
    height: 200,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },

  zoomControls: {
    position: "absolute",
    right: 8,
    top: 8,
    flexDirection: "column",
    gap: 4,
  },

  zoomButton: {
    width: 32,
    height: 32,
    backgroundColor: "white",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },

  zoomText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },

  fullMapButton: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },

  fullMapText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },

});

export default HomeScreen;
