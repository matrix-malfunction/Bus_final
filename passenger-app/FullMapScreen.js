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
  const { buses: contextBuses } = useBus();
  const { buses: routeBuses, userLocation: routeUserLocation, center: routeCenter } = route?.params || {};
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

        // ALWAYS resend BUS_UPDATE on MAP_READY (recovery mechanism)
        if (webViewRef.current) {
          console.log("[FullMap] Sending BUS_UPDATE on MAP_READY:", buses.length, "buses");
          webViewRef.current.postMessage(
            JSON.stringify({
              type: "BUS_UPDATE",
              buses: buses
            })
          );
        }
      }
      
      // PING → MAP_READY recovery (optional handshake)
      if (data.type === "PING") {
        console.log("[FullMap] PING received, responding with PONG");
        webViewRef.current?.postMessage(JSON.stringify({ type: "PONG" }));
      }
    } catch (e) {
      console.log("[FullMap] Invalid message:", e.message);
    }
  }, [webViewReady, buses]);

  // Continuous user location sync (every 3 seconds)
  // Standardized schema: { type: "USER_LOCATION", payload: { latitude, longitude } }
  useEffect(() => {
    // Cache initial user location
    if (route.params?.userLocation) {
      lastUserLocationRef.current = {
        latitude: route.params.userLocation.latitude,
        longitude: route.params.userLocation.longitude
      };
    }

    const interval = setInterval(() => {
      if (!route.params?.userLocation) return;

      // Update cache
      lastUserLocationRef.current = {
        latitude: route.params.userLocation.latitude,
        longitude: route.params.userLocation.longitude
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
    if (!webViewRef.current || !webViewReady) return;

    console.log("[FullMap RN] Sending BUS_UPDATE:", buses.length, "buses");
    webViewRef.current.postMessage(
      JSON.stringify({
        type: "BUS_UPDATE",
        buses: buses
      })
    );
  }, [buses, webViewReady]);

  // Convert context buses (object) to array and merge with route buses
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

  const markersScript = useMemo(
    () =>
      buses
        .map(
          (bus) => `
        const busIcon = L.divIcon({
          html: '<div style="font-size:28px;background:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(0,0,0,0.3);">🚌</div>',
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        });

        window.busMarkers = window.busMarkers || {};

        if (window.busMarkers['${bus.busId}']) {
          smoothMove(window.busMarkers['${bus.busId}'], ${bus.latitude}, ${bus.longitude});
        } else {
          window.busMarkers['${bus.busId}'] = L.marker([${bus.latitude}, ${bus.longitude}], { icon: busIcon }).addTo(map);
        }

        updateRouteLine('${bus.busId}');
      `
        )
        .join(""),
    [buses]
  );

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
          .user-beacon {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .beacon {
            width: 12px;
            height: 12px;
            background: #007AFF;
            border-radius: 50%;
            box-shadow: 0 0 0 6px rgba(0,122,255,0.2);
            animation: pulse 1.5s infinite;
          }
          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(0,122,255,0.5); }
            70% { box-shadow: 0 0 0 12px rgba(0,122,255,0); }
            100% { box-shadow: 0 0 0 0 rgba(0,122,255,0); }
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <button id="recenterBtn" style="
          position:absolute;
          bottom:20px;
          right:20px;
          z-index:9999;
          padding:10px 12px;
          background:white;
          border-radius:10px;
          border:none;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          font-size:20px;
          cursor:pointer;
        ">📍</button>
        <script>
          console.log("WEBVIEW LOADED");

          window.map = L.map('map').setView([${Number(center.latitude)}, ${Number(center.longitude)}], 14);
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.map);

          window.busMarkers = {};
          window.userMarker = null;
          window.isFollowingUser = true;
          window.userLocation = null;
          window.lastFollowLatLng = null;
          window.hasInitialCentered = false;

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
          window.map.whenReady(function() {
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

          // Disable follow on user interaction
          window.map.on("dragstart", () => {
            window.isFollowingUser = false;
            console.log("[FOLLOW] Disabled by user drag");
          });
          window.map.on("zoomstart", () => {
            window.isFollowingUser = false;
            console.log("[FOLLOW] Disabled by user zoom");
          });

          // Initialize route line
          window.routeLine = L.polyline([], {
            color: 'blue',
            weight: 4,
            opacity: 0.7
          }).addTo(window.map);

          // Smooth animation function
          function smoothMove(marker, newLat, newLng) {
            const start = marker.getLatLng();
            const end = L.latLng(newLat, newLng);

            const duration = 2000;
            const startTime = performance.now();

            function animate(time) {
              const t = Math.min((time - startTime) / duration, 1);
              const lat = start.lat + (end.lat - start.lat) * t;
              const lng = start.lng + (end.lng - start.lng) * t;
              marker.setLatLng([lat, lng]);
              if (t < 1) requestAnimationFrame(animate);
            }

            requestAnimationFrame(animate);
          }

          // Update route line between user and bus
          function updateRouteLine(busId) {
            if (!window.routeLine || !window.userMarker || !window.busMarkers[busId]) return;

            const userPos = window.userMarker.getLatLng();
            const busPos = window.busMarkers[busId].getLatLng();

            window.routeLine.setLatLngs([
              [userPos.lat, userPos.lng],
              [busPos.lat, busPos.lng]
            ]);
          }

          // Handle messages from React Native
          function handleMessage(event) {
            let data;
            try { data = JSON.parse(event.data); } catch { return; }

            console.log("[FullMap] Message received:", data.type);

            if (data.type === "BUS_UPDATE") {
              console.log("[FullMap] BUS_UPDATE received:", data.buses);
              const buses = data.buses || [];

              // Clear existing bus markers
              if (window.busMarkers) {
                Object.values(window.busMarkers).forEach(m => map.removeLayer(m));
              }
              window.busMarkers = {};

              // Add new markers
              buses.forEach(bus => {
                if (!bus.trackingActive) return;

                const lat = bus.lat ?? bus.latitude;
                const lng = bus.lng ?? bus.longitude;
                if (lat == null || lng == null) return;

                const busIcon = L.divIcon({
                  html: '<div style="font-size:28px;background:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(0,0,0,0.3);">🚌</div>',
                  className: '',
                  iconSize: [36, 36],
                  iconAnchor: [18, 18]
                });

                window.busMarkers[bus.busId] = L.marker([lat, lng], { icon: busIcon })
                  .addTo(map)
                  .bindPopup("Bus: " + bus.busId);
              });

              console.log("[FullMap] Rendered buses:", buses.length);
              return;
            }

            if (data.type === "USER_LOCATION") {
              // Standardized payload: { payload: { latitude, longitude } }
              if (!data.payload || data.payload.latitude == null || data.payload.longitude == null) return;
              const lat = Number(data.payload.latitude);
              const lng = Number(data.payload.longitude);
              if (isNaN(lat) || isNaN(lng)) return;

              // Store for fallback
              window.userLocation = { lat, lng };

              // Beacon-style user icon
              const userIcon = L.divIcon({
                className: "user-beacon",
                html: '<div class="beacon"></div>',
                iconSize: [20, 20]
              });

              // Create or update marker
              if (window.userMarker) {
                window.userMarker.setLatLng([lat, lng]);
              } else {
                window.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(window.map);
              }

              // Initial centering (first time only)
              if (!window.hasInitialCentered) {
                window.map.setView([lat, lng], window.map.getZoom());
                window.hasInitialCentered = true;
                window.lastFollowLatLng = L.latLng(lat, lng);
                return;
              }

              // Auto-follow logic
              if (window.isFollowingUser) {
                const center = window.map.getCenter();
                const distance = center.distanceTo([lat, lng]);
                const movement = window.lastFollowLatLng
                  ? window.lastFollowLatLng.distanceTo([lat, lng])
                  : distance;

                if (distance > 20 && movement > 10) {
                  console.log("[FOLLOW] Auto-centering, distance:", Math.round(distance), "m, movement:", Math.round(movement), "m");
                  window.map.flyTo([lat, lng], window.map.getZoom(), { duration: 0.5 });
                  window.lastFollowLatLng = L.latLng(lat, lng);
                }
              } else {
                console.log("[FOLLOW] Skipped (user controlled)");
              }

              return;
            }

            if (data.type === "BUS_DATA") {
              // Legacy - handled by BUS_UPDATE
            }

            if (data.type === "RECENTER") {
              if (!window.map) return;

              let target = null;

              if (window.userMarker) {
                target = window.userMarker.getLatLng();
              } else if (window.userLocation) {
                target = [window.userLocation.lat, window.userLocation.lng];
              }

              if (!target) {
                console.warn("No user location for recenter");
                return;
              }

              const targetZoom = window.map.getZoom() < 15 ? 16 : window.map.getZoom();

              window.map.flyTo(target, targetZoom, {
                animate: true,
                duration: 1.2
              });

              window.isFollowingUser = true;
              console.log("[FOLLOW] Re-enabled by recenter");
            }
          }

          document.addEventListener("message", handleMessage);
          window.addEventListener("message", handleMessage);

          // Recenter button handler (DOMContentLoaded-safe, idempotent)
          const setupRecenter = () => {
            const btn = document.getElementById("recenterBtn");
            if (!btn || btn._bound) return;
            btn._bound = true;

            btn.onclick = () => {
              let lat, lng;

              if (window.userMarker) {
                const pos = window.userMarker.getLatLng();
                lat = pos.lat;
                lng = pos.lng;
              } else if (window.userLocation) {
                lat = window.userLocation.lat;
                lng = window.userLocation.lng;
              } else {
                console.log("[RECENTER] No user location available");
                return;
              }

              window.isFollowingUser = true;
              console.log("[FOLLOW] Re-enabled by recenter");
              window.map.flyTo([lat, lng], window.map.getZoom(), { duration: 0.8 });
              window.lastFollowLatLng = L.latLng(lat, lng);
            };
          };

          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", setupRecenter);
          } else {
            setupRecenter();
          }

          ${markersScript}
        </script>
      </body>
      </html>
    `,
    [center.latitude, center.longitude, userLocation, markersScript]
  );

  // isRecentering state for recenter button
  const [isRecentering, setIsRecentering] = useState(false);

  const handleRecenter = () => {
    if (!webViewRef.current) return;
    setIsRecentering(true);
    webViewRef.current.postMessage(JSON.stringify({ type: "RECENTER" }));
    setTimeout(() => setIsRecentering(false), 800);
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
        <Text style={styles.recenterIcon}>📍</Text>
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
});
