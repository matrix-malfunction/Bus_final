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

// Mini Map Component
const MiniMap = ({ buses, sosAlerts, userLocation, onPress }) => {
  const webViewRef = useRef(null);
  const [webViewReady, setWebViewReady] = useState(false);

  const mapHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    html, body, #map { height: 100%; margin: 0; }
    .bus-marker { font-size: 24px; }
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
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    // Default center (VIT area)
    const defaultLat = 13.1044;
    const defaultLng = 79.9079;

    const map = L.map('map').setView([defaultLat, defaultLng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    window.userMarker = null;
    window.busMarkers = {};
    window.isFollowingUser = true;
    window.userLocation = null;
    window.lastFollowLatLng = null;
    window.hasInitialCentered = false;
    window.triggeredSOS = new Set();  // Track shown SOS alerts

    // Disable follow on user interaction
    map.on("dragstart", () => {
      window.isFollowingUser = false;
      console.log("[FOLLOW] Disabled by user drag");
    });
    map.on("zoomstart", () => {
      window.isFollowingUser = false;
      console.log("[FOLLOW] Disabled by user zoom");
    });

    const busIcon = L.divIcon({
      html: '<div style="font-size:28px;background:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(0,0,0,0.3);">🚌</div>',
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

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

    function handleMessage(event) {
      const data = JSON.parse(event.data);
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
          window.userMarker = L.marker([lat, lng]).addTo(map);
        }

        // Initial centering (first time only)
        if (!window.hasInitialCentered) {
          map.setView([lat, lng], map.getZoom());
          window.hasInitialCentered = true;
          window.lastFollowLatLng = L.latLng(lat, lng);
          return;
        }

        // Auto-follow logic
        if (window.isFollowingUser) {
          const center = map.getCenter();
          const distance = center.distanceTo([lat, lng]);
          const movement = window.lastFollowLatLng
            ? window.lastFollowLatLng.distanceTo([lat, lng])
            : distance;

          if (distance > 20 && movement > 10) {
            console.log("[FOLLOW] Auto-centering, distance:", Math.round(distance), "m, movement:", Math.round(movement), "m");
            map.flyTo([lat, lng], map.getZoom(), { duration: 0.5 });
            window.lastFollowLatLng = L.latLng(lat, lng);
          }
        } else {
          console.log("[FOLLOW] Skipped (user controlled)");
        }

        return;
      }

      if (data.type === "BUS_DATA") {
        if (!window.busMarkers) window.busMarkers = {};
        data.buses.forEach(bus => {
          const lat = Number(bus.latitude ?? bus.lat);
          const lng = Number(bus.longitude ?? bus.lng);
          if (isNaN(lat) || isNaN(lng)) return;
          if (window.busMarkers[bus.busId]) {
            smoothMove(window.busMarkers[bus.busId], lat, lng);
          } else {
            window.busMarkers[bus.busId] = L.marker([lat, lng], { icon: busIcon }).addTo(map);
          }
        });

        // Check for SOS alerts
        if (data.sos && data.sos.length > 0) {
          data.sos.forEach(function(sos) {
            if (!window.triggeredSOS.has(sos.busId)) {
              window.triggeredSOS.add(sos.busId);
              var msg = "EMERGENCY: Bus " + sos.busId + " needs assistance!";
              alert(msg);
              console.log("[SOS ALERT] Triggered for bus:", sos.busId);
            }
          });
        }
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
        map.flyTo([lat, lng], map.getZoom(), { duration: 0.8 });
        window.lastFollowLatLng = L.latLng(lat, lng);
      };
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", setupRecenter);
    } else {
      setupRecenter();
    }

    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "MAP_READY" }));
  </script>
</body>
</html>
  `;

  // Send bus data to WebView when ready
  useEffect(() => {
    if (!webViewReady || buses.length === 0) return;
    webViewRef.current?.postMessage(JSON.stringify({
      type: "BUS_DATA",
      buses: buses,
      sos: sosAlerts || [],  // Include SOS alerts
    }));
  }, [webViewReady, buses, sosAlerts]);

  // Send user location updates
  useEffect(() => {
    if (!webViewReady || !userLocation) return;
    webViewRef.current?.postMessage(JSON.stringify({
      type: "USER_LOCATION",
      lat: userLocation.latitude,
      lng: userLocation.longitude,
    }));
  }, [webViewReady, userLocation]);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: mapHTML }}
        style={styles.miniMap}
        javaScriptEnabled={true}
        onMessage={(event) => {
          const msg = JSON.parse(event.nativeEvent.data);
          if (msg.type === "MAP_READY") setWebViewReady(true);
        }}
      />
    </TouchableOpacity>
  );
};

export default function HomeScreen() {
  const navigation = useNavigation();
  const [userLocation, setUserLocation] = useState(null);
  const [buses, setBuses] = useState([]);
  const [sosAlerts, setSosAlerts] = useState([]);  // SOS alerts from backend
  const [searchQuery, setSearchQuery] = useState("");

  // Filter buses based on search query
  const filteredBuses = buses.filter(bus =>
    bus.busId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    bus.route?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Fetch buses from backend
  const fetchBuses = useCallback(async () => {
    if (!userLocation) return;
    
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/buses/nearby?lat=${userLocation.latitude}&lng=${userLocation.longitude}&radius=5000`
      );

      // Safe JSON parsing to prevent HTML error crashes
      const text = await response.text();

      if (!text.startsWith("{")) {
        console.log("❌ Non-JSON response (Render cold start?):", text.substring(0, 100));
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.log("❌ JSON parse error:", e.message);
        return;
      }

      console.log("[RAW API RESPONSE]:", JSON.stringify(data, null, 2));
      console.log("[RAW BUSES COUNT]:", data.buses?.length || 0);
      
      // Store SOS alerts if present
      if (data.sos && Array.isArray(data.sos)) {
        console.log("[SOS ALERTS]:", data.sos.length, "alerts");
        setSosAlerts(data.sos);
      }

      if (data.buses && Array.isArray(data.buses)) {
        // Process buses with crash-safe logic
        const processedBuses = data.buses.map(bus => {
          const expanded = expandBusData(bus);

          console.log("[EXPANDED BUS]", expanded);

          if (!expanded) return null;

          return {
            busId: expanded.busId,
            latitude: expanded.lat,
            longitude: expanded.lng,
            route: expanded.route
          };
        })
        .filter(b =>
          b &&
          b.latitude != null &&
          b.longitude != null &&
          !isNaN(b.latitude) &&
          !isNaN(b.longitude)
        );

        console.log("[FINAL BUSES]", processedBuses);
        setBuses(processedBuses);
      } else {
        console.log("[NO BUSES]:", "data.buses is empty or not array");
      }
    } catch (err) {
      console.error("[FETCH ERROR]:", err);
    }
  }, [userLocation]);

  // Periodic bus fetch
  useEffect(() => {
    if (!userLocation) return;
    
    fetchBuses();
    const interval = setInterval(fetchBuses, 5000);
    return () => clearInterval(interval);
  }, [fetchBuses, userLocation]);

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
    console.log("WEBVIEW LOADED");

    // Default center (VIT area)
    const defaultLat = 13.1044;
    const defaultLng = 79.9079;

    const map = L.map('map').setView([defaultLat, defaultLng], 15);
    window.map = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    window.userMarker = null;
    window.busMarkers = {};

    // Initialize route line
    window.routeLine = L.polyline([], {
      color: 'blue',
      weight: 4,
      opacity: 0.7
    }).addTo(window.map);

    // Custom bus icon - large and visible
    const busIcon = L.divIcon({
      html: '<div style="font-size:28px;background:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(0,0,0,0.3);">🚌</div>',
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

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

    function handleMessage(event) {
      const data = JSON.parse(event.data);

      console.log("[WEBVIEW RECEIVED]", data);

      if (data.type === "USER_LOCATION") {
        const lat = Number(data.lat);
        const lng = Number(data.lng);

        if (window.userMarker) {
          window.userMarker.setLatLng([lat, lng]);
        } else {
          window.userMarker = L.marker([lat, lng]).addTo(map);
        }

        map.setView([lat, lng], 15);
      } else if (data.type === "BUS_DATA") {

        if (!window.busMarkers) {
          window.busMarkers = {};
        }

        data.buses.forEach(bus => {
          const lat = Number(bus.latitude ?? bus.lat);
          const lng = Number(bus.longitude ?? bus.lng);

          console.log("[MARKER]", lat, lng);

          if (isNaN(lat) || isNaN(lng)) return;

          if (window.busMarkers[bus.busId]) {
            smoothMove(window.busMarkers[bus.busId], lat, lng);
          } else {
            window.busMarkers[bus.busId] =
              L.marker([lat, lng], { icon: busIcon }).addTo(window.map);
          }

          updateRouteLine(bus.busId);
        });
      }
    }

    document.addEventListener("message", handleMessage);
    window.addEventListener("message", handleMessage);
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "MAP_READY" }));
  </script>
</body>
</html>
  `;

  // Send bus data to WebView when ready
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
            buses={filteredBuses}
            sosAlerts={sosAlerts}
            userLocation={userLocation}
            onPress={handleMapPress}
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
});
