import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { StyleSheet, View, TouchableOpacity, Text } from "react-native";
import { WebView } from "react-native-webview";
import { useBus } from "./BusContext";

function escapeText(input) {
  return String(input ?? "Bus").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toFiniteCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default function FullMapScreen({ route }) {
  const webViewRef = useRef(null);
  const lastUserLocationRef = useRef(null); // Cache for resend on WebView load
  const [webViewReady, setWebViewReady] = useState(false);
  const { buses: contextBuses, followBusId, setFollowBusId, setUserLocation } = useBus();
  const { buses: routeBuses, userLocation: routeUserLocation, center: routeCenter } = route?.params || {};

  // Convert context buses (object) to array and merge with route buses
  // MUST be defined before any hooks that reference it
  const buses = useMemo(() => {
    const contextBusesArray = Object.values(contextBuses || {});
    const routeBusesArray = Array.isArray(routeBuses) ? routeBuses : [];

    // Use context buses if available, otherwise fall back to route buses
    const sourceBuses = contextBusesArray.length > 0 ? contextBusesArray : routeBusesArray;

    return sourceBuses
      .map((bus) => {
        const latitude = toFiniteCoordinate(bus?.latitude ?? bus?.lat);
        const longitude = toFiniteCoordinate(bus?.longitude ?? bus?.lng);
        if (latitude === null || longitude === null) return null;
        return {
          ...bus,
          latitude,
          longitude,
          lat: latitude,
          lng: longitude,
          busId: bus.busId || bus._id
        };
      })
      .filter(Boolean);
  }, [routeBuses, contextBuses]);

  const center =
    routeCenter &&
    Number.isFinite(Number(routeCenter.latitude)) &&
    Number.isFinite(Number(routeCenter.longitude))
      ? routeCenter
      : { latitude: 12.8795, longitude: 77.1217 };
  const userLocation =
    routeUserLocation &&
    Number.isFinite(Number(routeUserLocation.latitude)) &&
    Number.isFinite(Number(routeUserLocation.longitude))
      ? routeUserLocation
      : null;

  // Handle MAP_READY from WebView - idempotent, always resend USER_LOCATION
  const handleWebViewMessage = useCallback((event) => {
    try {
      if (!event?.nativeEvent?.data) return;
      const data = JSON.parse(event.nativeEvent.data);
      if (!data?.type) return;

      // Idempotent MAP_READY handling - safe for duplicates
      if (data.type === "MAP_READY") {
        const alreadyReady = webViewReady;
        console.log("[FullMap] MAP_READY received (alreadyReady:", alreadyReady, ")");
        
        // Always mark as ready (idempotent)
        if (!alreadyReady) {
          setWebViewReady(true);
        }

        // ALWAYS resend cached user location on MAP_READY (recovery mechanism)
        if (lastUserLocationRef.current && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "USER_LOCATION",
            payload: lastUserLocationRef.current
          }));
          console.log("[FullMap] USER_LOCATION resent on MAP_READY");
        }

        // ALWAYS resend FOLLOW_UPDATE on MAP_READY
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "FOLLOW_UPDATE",
            busId: followBusId
          }));
          console.log("[FullMap] FOLLOW_UPDATE resent on MAP_READY");
        }

        // ALWAYS resend BUS_UPDATE on MAP_READY (recovery mechanism)
        // Use 50ms delay to ensure state is fresh, then read from contextBuses directly
        setTimeout(() => {
          if (!webViewRef.current) return;

          // Get latest buses directly from context to avoid stale closure
          const latestBuses = Object.values(contextBuses || {});
          console.log("[FullMap RN] Sending BUS_UPDATE after MAP_READY:", latestBuses.length, "buses");

          webViewRef.current.postMessage(
            JSON.stringify({
              type: "BUS_UPDATE",
              buses: latestBuses
            })
          );
        }, 50);
      }
      
      // PING → MAP_READY recovery (optional handshake)
      if (data.type === "PING") {
        console.log("[FullMap] PING received, responding with PONG");
        webViewRef.current?.postMessage(JSON.stringify({ type: "PONG" }));
      }

      // FOLLOW_STOPPED from WebView (user dragged map)
      if (data.type === "FOLLOW_STOPPED") {
        console.log("[FullMap] FOLLOW_STOPPED from WebView");
        setFollowBusId(null);
      }

      // BUS_SELECTED from WebView (user tapped marker)
      if (data.type === "BUS_SELECTED") {
        console.log("[FullMap] BUS_SELECTED:", data.busId);
        // Only select, do NOT auto-follow
        setSelectedBusId(data.busId);
      }

      // TOGGLE_FOLLOW from WebView (popup follow button)
      if (data.type === "TOGGLE_FOLLOW") {
        console.log("[FullMap] TOGGLE_FOLLOW:", data.busId);
        setFollowBusId(data.busId);
      }
    } catch (e) {
      console.log("[FullMap] Invalid message:", e.message);
    }
  }, [webViewReady, contextBuses, setFollowBusId, setSelectedBusId]);

  // Continuous user location sync (every 3 seconds)
  // Standardized schema: { type: "USER_LOCATION", payload: { latitude, longitude } }
  useEffect(() => {
    // Cache initial user location (use lat/lng format for WebView)
    if (route.params?.userLocation) {
      lastUserLocationRef.current = {
        lat: route.params.userLocation.latitude,
        lng: route.params.userLocation.longitude
      };
    }

    const interval = setInterval(() => {
      if (!route.params?.userLocation) return;

      // Update cache (use lat/lng format for WebView)
      lastUserLocationRef.current = {
        lat: route.params.userLocation.latitude,
        lng: route.params.userLocation.longitude
      };

      // Send if WebView ready
      if (webViewRef.current && webViewReady) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "USER_LOCATION",
          payload: lastUserLocationRef.current
        }));
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [webViewReady, route.params?.userLocation]);

  // Send BUS_UPDATE to WebView whenever buses change
  // ALWAYS send (even empty) to clear stale markers
  useEffect(() => {
    if (!webViewRef.current) return;

    console.log("[FullMap RN] Sending BUS_UPDATE:", buses.length, "buses");
    webViewRef.current.postMessage(
      JSON.stringify({
        type: "BUS_UPDATE",
        buses: buses
      })
    );
  }, [buses]);

  // Send FOLLOW_BUS to WebView whenever followBusId changes (global follow state)
  useEffect(() => {
    if (!webViewRef.current) return;

    console.log("[FullMap RN] Sending FOLLOW_BUS:", followBusId);
    webViewRef.current.postMessage(
      JSON.stringify({
        type: "FOLLOW_BUS",
        busId: followBusId,
        userLocation: lastUserLocationRef.current
      })
    );
  }, [followBusId]);

  const mapHTML = useMemo(
    () => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css"/>
        <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
        <style>
          html, body { margin:0; padding:0; height:100%; }
          #map { width:100%; height:100vh; }
          /* Beacon pulse animation - Google Maps style */
          .beacon-container { position: relative; }
          .beacon-dot {
            width: 12px; height: 12px; background: #007AFF; border-radius: 50%;
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2;
          }
          .beacon-pulse {
            width: 40px; height: 40px; background: rgba(0,122,255,0.3); border-radius: 50%;
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            animation: pulse-ring 1.5s ease-out infinite; z-index: 1;
          }
          @keyframes pulse-ring {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
          }
          /* Modern Popup Styles */
          .bus-popup {
            padding: 12px;
            border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            min-width: 160px;
            background: white;
          }
          .bus-popup-header {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 8px;
            color: #333;
          }
          .bus-popup-row {
            font-size: 12px;
            color: #666;
            margin: 4px 0;
          }
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
          .user-popup {
            padding: 8px 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            color: #333;
            text-align: center;
          }
          #recenter-btn {
            position: absolute;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            width: 48px;
            height: 48px;
            background: white;
            border: none;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
          }
          #recenter-btn svg {
            fill: #333;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <button id="recenter-btn">
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0-6v2a8 8 0 018 8h2A10 10 0 0012 2zm0 20v-2a8 8 0 01-8-8H2a10 10 0 0010 10zm10-10h-2a8 8 0 01-8 8v2a10 10 0 0010-10zM2 12h2a8 8 0 018-8V2A10 10 0 002 12z"/>
          </svg>
        </button>
        <script>
          document.addEventListener("DOMContentLoaded", function() {
            console.log("[WEBVIEW] DOMContentLoaded - Initializing...");

            // 1) CREATE MAP FIRST
            const map = L.map('map').setView([${Number(center.latitude)}, ${Number(center.longitude)}], 14);
            window.map = map;

            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.map);

            // 2) GLOBAL STATE (AFTER MAP INIT)
            window.busMarkers = {};
            window.userMarker = null;
            window.__followBusId = null;
            window.userLocation = null;
            window.__isFollowingActive = false;
            window.__lastFollowUpdate = 0;
            window.__pendingFollowLatLng = null;

            // 3) BUS ICON
            const busIcon = L.divIcon({
              html: '<div style="font-size:28px;background:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(0,0,0,0.3);cursor:pointer;">🚌</div>',
              className: '',
              iconSize: [36, 36],
              iconAnchor: [18, 36]
            });

            // 3a) CREATE POPUP HTML (dynamic follow/unfollow)
            function createPopupHTML(bus) {
              const speed = Math.round(bus.speed || 0);
              const eta = bus.eta ? Math.round(bus.eta) : "--";
              const isFollowing = window.__followBusId === (bus.busId || bus.id);
              return \`
                <div class="bus-popup">
                  <div class="bus-popup-header">\${bus.name || bus.busId || "Bus"}</div>
                  <div class="bus-popup-row">Speed: \${speed} km/h</div>
                  <div class="bus-popup-row">ETA: \${eta} min</div>
                  <label class="follow-toggle">
                    <input type="checkbox" \${isFollowing ? 'checked' : ''} onchange="window.toggleFollow('\${bus.busId || bus.id}')">
                    <span class="toggle-slider"></span>
                    <span class="toggle-label">\${isFollowing ? 'Following' : 'Follow'}</span>
                  </label>
                </div>
              \`;
            }

            // 3b) ETA CALCULATION
            function calculateETA(bus, user) {
              if (!bus.speed || bus.speed < 5) return null;
              const R = 6371000;
              const dLat = (user.lat - bus.lat) * Math.PI / 180;
              const dLng = (user.lng - bus.lng) * Math.PI / 180;
              const a = Math.sin(dLat/2)**2 + Math.cos(bus.lat * Math.PI/180) * Math.cos(user.lat * Math.PI/180) * Math.sin(dLng/2)**2;
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              const distance = R * c;
              const eta = distance / (bus.speed * (1000/3600));
              return Math.round(eta / 60);
            }

            // 3c) TOGGLE FOLLOW (called from popup) with optimistic UI update
            window.toggleFollow = function(busId) {
              // Optimistic update: toggle immediately
              const wasFollowing = window.__followBusId === busId;
              window.__followBusId = wasFollowing ? null : busId;

              // Update popup content immediately if open
              const marker = window.busMarkers[busId];
              if (marker && marker.getPopup()?.isOpen() && marker.__busData) {
                marker.setPopupContent(createPopupHTML(marker.__busData));
              }

              // Send to React Native
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "TOGGLE_FOLLOW",
                busId: busId
              }));
            };

            // 3d) DRAG DETECTION
            window.map.on("dragstart", () => {
              window.__userDragging = true;
              if (window.__followBusId) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "FOLLOW_STOPPED",
                  reason: "USER_DRAG"
                }));
              }
            });

            // 4) SINGLE MARKER FUNCTION - Source of truth
            function updateBusMarkers(buses) {
              if (!window.map || !buses) return;

              const activeIds = new Set(Object.keys(buses));

              // Followed bus went offline - reset follow state
              if (window.__followBusId && !activeIds.has(window.__followBusId)) {
                window.__followBusId = null;
                window.__isFollowingActive = false;
                window.__pendingFollowLatLng = null;
                window.__lastFollowUpdate = 0;

                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "FOLLOW_STOPPED",
                  reason: "BUS_OFFLINE"
                }));
              }

              // Remove stale markers
              Object.keys(window.busMarkers).forEach(id => {
                if (!activeIds.has(id)) {
                  window.map.removeLayer(window.busMarkers[id]);
                  delete window.busMarkers[id];
                }
              });

              // Add/update markers
              Object.entries(buses).forEach(([id, bus]) => {
                if (!bus?.lat || !bus?.lng) return;

                const latlng = [bus.lat, bus.lng];

                // Calculate ETA if user location exists
                let eta = null;
                if (window.userLocation) {
                  eta = calculateETA(bus, window.userLocation);
                }
                const busData = { ...bus, eta, busId: id };

                if (window.busMarkers[id]) {
                  // UPDATE EXISTING MARKER - no recreation
                  const marker = window.busMarkers[id];
                  marker.setLatLng(latlng);

                  // Store full bus data on marker for optimistic updates
                  marker.__busData = { ...bus, id, eta: busData.eta };

                  // Update popup content safely (only if open)
                  if (marker.getPopup()?.isOpen()) {
                    marker.setPopupContent(createPopupHTML(busData));
                  }

                  // Update z-index based on follow state
                  if (window.__followBusId === id) {
                    marker.setZIndexOffset(1000);
                  } else if (bus.sos) {
                    marker.setZIndexOffset(2000);
                  } else {
                    marker.setZIndexOffset(0);
                  }
                } else {
                  // CREATE NEW MARKER - only once
                  const marker = L.marker(latlng, { icon: busIcon }).addTo(window.map);

                  // Store full bus data on marker for optimistic updates
                  marker.__busData = { ...bus, id, eta: busData.eta };

                  // Click to select
                  marker.on("click", () => {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: "BUS_SELECTED",
                      busId: id
                    }));
                  });

                  // Bind popup with modern UI (only once)
                  marker.bindPopup(createPopupHTML(busData));

                  // Set z-index
                  if (bus.sos) {
                    marker.setZIndexOffset(2000);
                  }

                  window.busMarkers[id] = marker;
                }

                // REAL-TIME FOLLOW: Move camera with bus (safe with drag detection)
                if (window.__followBusId === id && !window.__userDragging) {
                  const latlng = [bus.lat, bus.lng];
                  const now = Date.now();

                  // Always store latest position
                  window.__pendingFollowLatLng = latlng;

                  if (!window.__isFollowingActive) {
                    window.map.flyTo(latlng, 16, {
                      animate: true,
                      duration: 0.5
                    });
                    window.__isFollowingActive = true;
                    window.__lastFollowUpdate = now;
                  } else {
                    if (now - window.__lastFollowUpdate > 300) {
                      const latest = window.__pendingFollowLatLng;

                      window.map.panTo(latest, {
                        animate: true,
                        duration: 0.4
                      });

                      window.__lastFollowUpdate = now;
                    }
                  }
                }
              });
            }

            // 5) USER LOCATION (unified beacon with CSS pulse)
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

            // 6) RECENTER FUNCTION
            function recenterToUser() {
              if (!window.map) return;

              if (window.userMarker) {
                const pos = window.userMarker.getLatLng();
                window.map.flyTo(pos, 15, { duration: 0.5 });
              }
            }

            // 7) ATTACH RECENTER BUTTON
            document.getElementById("recenter-btn")?.addEventListener("click", recenterToUser);

            // 8) MESSAGE HANDLER
            function handleMessage(event) {
              let data;
              try {
                data = JSON.parse(event.data || "{}");
              } catch (e) {
                return;
              }
              if (!data || !window.map) return;

              switch (data.type) {
                case "BUS_UPDATE":
                  // Normalize payload: handle both array and object formats
                  const buses = Array.isArray(data.buses)
                    ? Object.fromEntries(data.buses.map(b => [b.busId || b.id, b]))
                    : data.buses;
                  updateBusMarkers(buses || {});
                  break;

                case "USER_LOCATION":
                  console.log("[WEBVIEW] USER_LOCATION RECEIVED:", data.payload);
                  if (data.payload?.lat != null && data.payload?.lng != null) {
                    const lat = Number(data.payload.lat);
                    const lng = Number(data.payload.lng);
                    if (!isNaN(lat) && !isNaN(lng)) {
                      setUserLocation(lat, lng);
                    } else {
                      console.error("[WEBVIEW] Invalid lat/lng:", data.payload);
                    }
                  } else {
                    console.error("[WEBVIEW] Missing lat/lng in payload:", data.payload);
                  }
                  break;

                case "FOLLOW_UPDATE":
                  window.__followBusId = data.busId || null;
                  window.__isFollowingActive = false;
                  console.log("[WEBVIEW] FOLLOW_UPDATE:", window.__followBusId);
                  break;

                case "FOLLOW_STOPPED":
                  window.__followBusId = null;
                  window.__isFollowingActive = false;
                  window.__pendingFollowLatLng = null;
                  window.__lastFollowUpdate = 0;

                  if (data.reason === "BUS_OFFLINE") {
                    if (window.userMarker && window.map) {
                      const pos = window.userMarker.getLatLng();
                      window.map.flyTo(pos, 15, {
                        animate: true,
                        duration: 0.6
                      });
                    }
                  }
                  break;

                case "RECENTER":
                  recenterToUser();
                  break;
              }
            }

            // 9) ATTACH LISTENER (ONCE)
            if (!window.__BUS_LISTENER__) {
              window.__BUS_LISTENER__ = true;
              document.addEventListener("message", handleMessage);
              window.addEventListener("message", handleMessage);
            }

            // 10) STOP FOLLOW ON DRAG
            window.map.on("dragstart", () => {
              if (window.__followBusId) {
                window.__followBusId = null;
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "FOLLOW_STOPPED",
                  reason: "USER_DRAG"
                }));
              }
            });

            // 11) MAP READY
            window.__MAP_READY_SENT__ = false;
            function sendMapReady() {
              if (window.__MAP_READY_SENT__) return;
              if (!window.ReactNativeWebView) return;
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: "MAP_READY" }));
              window.__MAP_READY_SENT__ = true;
              console.log("[WEBVIEW] MAP_READY sent");
            }
            window.map.whenReady(sendMapReady);
            setTimeout(() => { if (!window.__MAP_READY_SENT__) sendMapReady(); }, 1000);

            console.log("[WEBVIEW] Init complete");
          });
        </script>
      </body>
      </html>
    `,
    [center.latitude, center.longitude, userLocation]
  );

  // isRecentering state for recenter button
  const [isRecentering, setIsRecentering] = useState(false);
  const [selectedBusId, setSelectedBusId] = useState(null);

  const handleRecenter = () => {
    if (!webViewRef.current) return;
    setIsRecentering(true);
    webViewRef.current.postMessage(JSON.stringify({ type: "RECENTER" }));
    setTimeout(() => setIsRecentering(false), 800);
  };

  const handleToggleFollow = () => {
    if (!selectedBusId) return;
    // Toggle: if already following this bus, stop; otherwise start following
    const newFollowId = followBusId === selectedBusId ? null : selectedBusId;
    setFollowBusId(newFollowId);
  };

  const handleCloseSelection = () => {
    setSelectedBusId(null);
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: mapHTML }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mixedContentMode="always"
        onMessage={handleWebViewMessage}
        style={{ flex: 1 }}
      />
      <TouchableOpacity
        style={[styles.recenterButton, isRecentering && styles.recenterButtonActive]}
        onPress={handleRecenter}
        activeOpacity={0.8}
      >
        <Text style={styles.recenterIcon}>⌖</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  recenterButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 30,
    padding: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  recenterButtonActive: {
    backgroundColor: '#e0e0e0',
    transform: [{ scale: 0.9 }],
  },
  recenterIcon: {
    fontSize: 20,
  },
  selectionPanel: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  closeIcon: {
    fontSize: 18,
    color: '#666',
  },
  followButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  followButtonActive: {
    backgroundColor: '#FF3B30',
  },
  followButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
