import { useCallback, useEffect, useRef, useState } from "react";
import { Button, FlatList, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

// PRODUCTION BACKEND URL - must use HTTPS for Android APK
const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

// Debug log for APK builds
console.log("🌐 NearbyBusesScreen API_BASE_URL:", API_BASE_URL);

const PASSENGER_STOP_LOCATION = {
  latitude: 12.9165,
  longitude: 79.1325,
};
const AVERAGE_BUS_SPEED_KMPH = 28;
const EARTH_RADIUS_KM = 6371;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function getDistanceInKm(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const dLat = toRadians(toLatitude - fromLatitude);
  const dLon = toRadians(toLongitude - fromLongitude);
  const lat1 = toRadians(fromLatitude);
  const lat2 = toRadians(toLatitude);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const angularDistance = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_KM * angularDistance;
}

function getEtaLabel(latitude, longitude) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(AVERAGE_BUS_SPEED_KMPH) ||
    AVERAGE_BUS_SPEED_KMPH <= 0
  ) {
    return "ETA: unavailable";
  }

  const distanceKm = getDistanceInKm(
    latitude,
    longitude,
    PASSENGER_STOP_LOCATION.latitude,
    PASSENGER_STOP_LOCATION.longitude
  );
  const etaMinutes = (distanceKm / AVERAGE_BUS_SPEED_KMPH) * 60;

  if (!Number.isFinite(etaMinutes)) {
    return "ETA: unavailable";
  }
  if (etaMinutes < 1) {
    return "ETA: <1 min";
  }

  return `ETA: ${Math.round(etaMinutes)} min`;
}

export default function NearbyBusesScreen({ token }) {
  const [buses, setBuses] = useState([]);
  const [status, setStatus] = useState("Ready to fetch buses");
  const isFetchingRef = useRef(false);

  const fetchNearbyBuses = useCallback(async () => {
    if (!token) {
      setStatus("Missing token. Login first.");
      return;
    }

    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

    try {
      const response = await fetch(`${API_BASE_URL}/api/passenger/nearby-buses`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.message || "Failed to fetch buses");
        return;
      }

      setBuses(data.buses || []);
      setStatus(`Fetched ${data.buses?.length || 0} buses`);
    } catch (error) {
      setStatus("Network error while fetching buses");
    } finally {
      isFetchingRef.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    fetchNearbyBuses();
    const intervalId = setInterval(() => {
      fetchNearbyBuses();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [token, fetchNearbyBuses]);

  const mapHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css"/>
      <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
      <style>
        body { margin:0; padding:0; }
        #map { width:100%; height:100vh; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map').setView([12.8795, 77.1217], 13);

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19
        }).addTo(map);

        ${buses
          .map(
            (bus) => `
          L.marker([${bus.latitude}, ${bus.longitude}])
            .addTo(map)
            .bindPopup("${bus.name || "Bus"}");
        `
          )
          .join("")}
      </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <View style={{ height: 250 }}>
        <WebView originWhitelist={["*"]} source={{ html: mapHTML }} />
      </View>

      <Text style={styles.heading}>Passenger Nearby Buses</Text>
      <Button title="Fetch Nearby Buses" onPress={fetchNearbyBuses} />
      <Text style={styles.status}>{status}</Text>

      <FlatList
        style={styles.list}
        data={buses}
        keyExtractor={(item) => item.busId}
        ListEmptyComponent={<Text style={styles.empty}>No buses available</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            {(() => {
              const latitude = Number(item.latitude);
              const longitude = Number(item.longitude);
              const etaLabel = getEtaLabel(latitude, longitude);

              return (
                <>
                  <Text style={styles.busId}>{item.busId}</Text>
                  <Text>
                    {item.busId} {"->"} {item.latitude}, {item.longitude}
                  </Text>
                  <Text>Last Updated: {item.timestamp}</Text>
                  <Text style={styles.etaText}>{etaLabel}</Text>
                </>
              );
            })()}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 16,
    gap: 12,
    backgroundColor: "#f5f5f5",
  },
  heading: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#222",
  },
  status: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  empty: {
    fontSize: 14,
    marginTop: 12,
    color: "#666",
    lineHeight: 20,
  },
  list: {
    flex: 1,
  },
  card: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 10,
  },
  busId: {
    fontWeight: "700",
    color: "#222",
    marginBottom: 4,
  },
  etaText: {
    marginTop: 4,
    fontWeight: "600",
    color: "#1d4ed8",
  },
});
