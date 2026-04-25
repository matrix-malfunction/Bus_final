import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { io } from "socket.io-client";

// PRODUCTION BACKEND URL - must use HTTPS for Android APK
const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

export default function App() {
  const [busesById, setBusesById] = useState({});
  const [status, setStatus] = useState("Loading nearby buses...");
  const buses = useMemo(() => Object.values(busesById), [busesById]);

  useEffect(() => {
    const socket = io(API_BASE_URL, { transports: ["websocket"] });
    socket.on("location:updated", (payload) => {
      setBusesById((prev) => ({ ...prev, [payload.busId]: payload }));
    });
    socket.on("connect", () => setStatus("Connected for live updates"));
    return () => socket.close();
  }, []);

  async function loadNearbyBuses() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setStatus("Location permission denied");
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const response = await fetch(`${API_BASE_URL}/api/location/nearest-stop`);
      const raw = await response.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (parseError) {
        console.error("Invalid JSON from /api/location/nearest-stop:", raw);
      }

      if (!response.ok) {
        setStatus(data.message || "Failed to load nearby buses");
        return;
      }
      const mapped = {};
      (data.buses || []).forEach((bus) => {
        mapped[bus.busId] = bus;
      });
      setBusesById(mapped);
      setStatus(`Loaded ${(data.buses || []).length} nearby buses`);
    } catch (error) {
      console.error("Network error while loading nearby buses:", error);
      setStatus(`Network error while loading nearby buses: ${error?.message || "unknown error"}`);
    }
  }

  useEffect(() => {
    loadNearbyBuses();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.heading}>Passenger App MVP (Web)</Text>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.buttonWrap}>
        <Button title="Refresh Nearby Buses" onPress={loadNearbyBuses} />
      </View>
      <FlatList
        data={buses}
        keyExtractor={(item) => item.busId}
        ListEmptyComponent={<Text style={styles.empty}>No live buses yet</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.busTitle}>{item.busId}</Text>
            <Text>Lat: {item.latitude ?? item.lat}</Text>
            <Text>Lng: {item.longitude ?? item.lng}</Text>
            {item.updatedAt ? <Text>Updated: {item.updatedAt}</Text> : null}
          </View>
        )}
      />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  heading: { fontSize: 18, fontWeight: "bold", color: "#222", marginBottom: 10 },
  status: { fontSize: 14, color: "#666", lineHeight: 20, marginBottom: 10 },
  buttonWrap: { marginBottom: 12 },
  empty: { textAlign: "center", fontSize: 14, color: "#666", lineHeight: 20, marginTop: 24 },
  card: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 12,
    marginBottom: 10,
  },
  busTitle: { fontWeight: "700", color: "#222", marginBottom: 4 },
});
