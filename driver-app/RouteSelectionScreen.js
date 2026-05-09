import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

// PRODUCTION BACKEND URL
const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

const DIRECTIONS = ["OUTBOUND", "INBOUND"];

export default function RouteSelectionScreen({ route }) {
  const navigation = useNavigation();
  const { token } = route.params || {};
  
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [selectedDirection, setSelectedDirection] = useState("OUTBOUND");
  const [startingShift, setStartingShift] = useState(false);

  // Fetch routes from backend on mount
  useEffect(() => {
    fetchRoutes();
  }, []);

  const fetchRoutes = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${API_BASE_URL}/api/routes`, {
        headers: {
          "Authorization": token ? `Bearer ${token}` : "",
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      console.log("[Route Selection] Fetched", data.routes?.length, "routes");
      setRoutes(data.routes || []);
    } catch (err) {
      console.error("[Route Selection] Error fetching routes:", err.message);
      setError("Failed to load routes. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartShift = async () => {
    if (!selectedRoute) {
      Alert.alert("Select a Route", "Please choose a route before starting your shift.");
      return;
    }

    setStartingShift(true);
    
    // Debug log before navigation
    const navParams = {
      token,
      routeId: selectedRoute.id,
      routeName: selectedRoute.name,
      routeColor: selectedRoute.color,
      direction: selectedDirection,
    };
    console.log("[ROUTE SELECT NAV]", navParams);
    
    // Navigate to tracking screen with selected route
    navigation.replace("Tracking", navParams);
  };

  const renderRouteItem = ({ item }) => {
    const isSelected = selectedRoute?.id === item.id;
    
    return (
      <TouchableOpacity
        style={[
          styles.routeCard,
          isSelected && styles.routeCardSelected,
        ]}
        onPress={() => setSelectedRoute(item)}
        activeOpacity={0.7}
      >
        <View style={styles.routeColorIndicator}>
          <View style={[styles.colorDot, { backgroundColor: item.color }]} />
        </View>
        <View style={styles.routeInfo}>
          <Text style={styles.routeShortName}>{item.shortName}</Text>
          <Text style={styles.routeName}>{item.name}</Text>
          <View style={styles.routeMeta}>
            <Text style={styles.routeDistrict}>{item.district}</Text>
            <Text style={styles.routeType}>{item.type}</Text>
            <Text style={styles.stopCount}>{item.stopCount} stops</Text>
          </View>
        </View>
        {isSelected && (
          <View style={styles.selectedIndicator}>
            <Text style={styles.selectedCheck}>✓</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderDirectionSelector = () => (
    <View style={styles.directionContainer}>
      <Text style={styles.sectionTitle}>Select Direction</Text>
      <View style={styles.directionButtons}>
        {DIRECTIONS.map((direction) => (
          <TouchableOpacity
            key={direction}
            style={[
              styles.directionButton,
              selectedDirection === direction && styles.directionButtonSelected,
            ]}
            onPress={() => setSelectedDirection(direction)}
          >
            <Text
              style={[
                styles.directionButtonText,
                selectedDirection === direction && styles.directionButtonTextSelected,
              ]}
            >
              {direction}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading routes...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchRoutes}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Your Route</Text>
        <Text style={styles.headerSubtitle}>
          Choose a route and direction to start your shift
        </Text>
      </View>

      <FlatList
        data={routes}
        renderItem={renderRouteItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.routesList}
        showsVerticalScrollIndicator={false}
      />

      {renderDirectionSelector()}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.startButton,
            (!selectedRoute || startingShift) && styles.startButtonDisabled,
          ]}
          onPress={handleStartShift}
          disabled={!selectedRoute || startingShift}
        >
          {startingShift ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.startButtonText}>
              {selectedRoute
                ? `Start Shift - ${selectedRoute.shortName} (${selectedDirection})`
                : "Select a Route to Start"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  header: {
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1e293b",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 4,
  },
  routesList: {
    padding: 16,
  },
  routeCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  routeCardSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  routeColorIndicator: {
    marginRight: 12,
    justifyContent: "center",
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  routeInfo: {
    flex: 1,
  },
  routeShortName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
  },
  routeName: {
    fontSize: 14,
    color: "#475569",
    marginTop: 2,
  },
  routeMeta: {
    flexDirection: "row",
    marginTop: 8,
    gap: 8,
  },
  routeDistrict: {
    fontSize: 12,
    color: "#64748b",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  routeType: {
    fontSize: 12,
    color: "#64748b",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    textTransform: "capitalize",
  },
  stopCount: {
    fontSize: 12,
    color: "#64748b",
  },
  selectedIndicator: {
    justifyContent: "center",
    marginLeft: 8,
  },
  selectedCheck: {
    fontSize: 20,
    color: "#2563eb",
    fontWeight: "700",
  },
  directionContainer: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 12,
  },
  directionButtons: {
    flexDirection: "row",
    gap: 12,
  },
  directionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
  },
  directionButtonSelected: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  directionButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748b",
  },
  directionButtonTextSelected: {
    color: "#fff",
  },
  footer: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  startButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  startButtonDisabled: {
    backgroundColor: "#94a3b8",
  },
  startButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#64748b",
  },
  errorText: {
    fontSize: 14,
    color: "#ef4444",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
