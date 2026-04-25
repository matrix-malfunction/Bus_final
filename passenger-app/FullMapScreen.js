import { useMemo, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

function escapeText(input) {
  return String(input ?? "Bus").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toFiniteCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default function FullMapScreen({ route }) {
  const webViewRef = useRef(null);
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

  // Continuous user location sync (every 3 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!webViewRef.current || !route.params?.userLocation) return;

      webViewRef.current.postMessage(JSON.stringify({
        type: "USER_LOCATION",
        lat: route.params.userLocation.latitude,
        lng: route.params.userLocation.longitude
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const buses = useMemo(
    () =>
      (Array.isArray(routeBuses) ? routeBuses : [])
        .map((bus) => {
          const latitude = toFiniteCoordinate(bus?.latitude);
          const longitude = toFiniteCoordinate(bus?.longitude);
          if (latitude === null || longitude === null) return null;
          return { ...bus, latitude, longitude };
        })
        .filter(Boolean),
    [routeBuses]
  );

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
          .beacon {
            width: 14px;
            height: 14px;
            background: #007bff;
            border-radius: 50%;
            position: relative;
          }
          .beacon::after {
            content: "";
            position: absolute;
            width: 28px;
            height: 28px;
            background: rgba(0, 123, 255, 0.3);
            border-radius: 50%;
            top: -7px;
            left: -7px;
            animation: pulse 1.5s infinite;
          }
          @keyframes pulse {
            0% { transform: scale(0.5); opacity: 1; }
            100% { transform: scale(2); opacity: 0; }
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

            if (data.type === "USER_LOCATION") {
              const lat = Number(data.lat);
              const lng = Number(data.lng);
              if (isNaN(lat) || isNaN(lng)) return;

              // Store for fallback
              window.userLocation = { lat, lng };

              // Create or update marker
              if (window.userMarker) {
                window.userMarker.setLatLng([lat, lng]);
              } else {
                window.userMarker = L.marker([lat, lng]).addTo(window.map);
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
              // Existing bus marker logic handled by markersScript
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

          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "MAP_READY" }));
        </script>
      </body>
      </html>
    `,
    [center.latitude, center.longitude, userLocation, markersScript]
  );

  // Send user location to WebView
  useEffect(() => {
    if (!routeUserLocation || !webViewRef.current) return;

    webViewRef.current.postMessage(JSON.stringify({
      type: "USER_LOCATION",
      lat: routeUserLocation.latitude,
      lng: routeUserLocation.longitude
    }));
  }, [routeUserLocation]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: mapHTML }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
});
