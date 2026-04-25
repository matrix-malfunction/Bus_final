import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://10.55.144.39:5000";

export default function ScheduleScreen({ token }) {
  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Ready");

  const fetchRoutes = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/passenger/routes`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data?.message || "Failed to load routes");
        return;
      }
      const nextRoutes = data.routes || [];
      setRoutes(nextRoutes);
      if (!selectedRouteId && nextRoutes.length > 0) {
        setSelectedRouteId(String(nextRoutes[0].routeId));
      }
      setStatus(`Loaded ${nextRoutes.length} routes`);
    } catch (error) {
      setStatus(`Failed to load routes: ${error?.message || "unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [token, selectedRouteId]);

  const fetchSchedule = useCallback(async () => {
    if (!token || !selectedRouteId) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/passenger/routes/${selectedRouteId}/schedule`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data?.message || "Failed to load schedule");
        return;
      }
      setStops(data.stops || []);
      setStatus(`Loaded ${data.stops?.length || 0} stops`);
    } catch (error) {
      setStatus(`Failed to load schedule: ${error?.message || "unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [token, selectedRouteId]);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Route Schedule</Text>
      <Text style={styles.status}>{status}</Text>

      <FlatList
        horizontal
        data={routes}
        keyExtractor={(item) => String(item.routeId)}
        contentContainerStyle={styles.routeRow}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.routeChip,
              String(item.routeId) === String(selectedRouteId) ? styles.routeChipActive : null,
            ]}
            onPress={() => setSelectedRouteId(String(item.routeId))}
          >
            <Text
              style={[
                styles.routeChipText,
                String(item.routeId) === String(selectedRouteId) ? styles.routeChipTextActive : null,
              ]}
            >
              {item.name}
            </Text>
          </Pressable>
        )}
      />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color="#2563eb" />
        </View>
      ) : (
        <FlatList
          data={stops}
          keyExtractor={(item, index) => String(item.stopId || index)}
          renderItem={({ item }) => (
            <View style={styles.stopCard}>
              <Text style={styles.stopName}>{item.name}</Text>
              <Text style={styles.stopMeta}>
                Time: {item.time || "N/A"} | Order: {item.order}
              </Text>
              <Text style={styles.stopMeta}>
                {item.latitude}, {item.longitude}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No stops available for this route.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#222",
    marginBottom: 6,
  },
  status: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 10,
  },
  routeRow: {
    gap: 8,
    paddingBottom: 12,
  },
  routeChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
  },
  routeChipActive: {
    backgroundColor: "#dbeafe",
  },
  routeChipText: {
    color: "#334155",
    fontWeight: "600",
  },
  routeChipTextActive: {
    color: "#1d4ed8",
  },
  loadingWrap: {
    paddingTop: 12,
  },
  stopCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    marginBottom: 10,
  },
  stopName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
  },
  stopMeta: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
});
