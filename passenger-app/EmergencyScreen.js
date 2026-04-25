import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://10.55.144.39:5000";

export default function EmergencyScreen({ token }) {
  const [status, setStatus] = useState("Tap SOS to send emergency alert.");
  const [loading, setLoading] = useState(false);

  const sendSos = async () => {
    if (loading) return;
    if (!token) {
      setStatus("Session expired. Please login again.");
      return;
    }
    setLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setStatus("Location permission denied.");
        return;
      }
      let current = null;
      try {
        current = await Location.getCurrentPositionAsync({});
      } catch (locationError) {
        setStatus("Unable to fetch location.");
        return;
      }
      const payload = {
        location: {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        },
      };
      const response = await fetch(`${API_BASE_URL}/api/passenger/sos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const raw = await response.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (parseError) {
        data = {};
      }
      if (!response.ok) {
        setStatus(data?.message || "Failed to send SOS.");
        return;
      }
      setStatus("SOS sent successfully.");
      Alert.alert("SOS Sent", "Emergency alert triggered.");
    } catch {
      setStatus("Network error. Check connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Emergency SOS</Text>
      <Text style={styles.subtitle}>Use this when immediate help is needed.</Text>
      <Pressable style={[styles.button, loading ? styles.buttonDisabled : null]} onPress={loading ? undefined : sendSos}>
        <Text style={styles.buttonText}>{loading ? "Sending..." : "🚨 SOS"}</Text>
      </Pressable>
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#222",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  button: {
    marginTop: 6,
    backgroundColor: "#dc2626",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  status: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
});
