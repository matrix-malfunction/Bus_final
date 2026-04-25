import { useState } from "react";
import { ActivityIndicator, Alert, Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

// PRODUCTION BACKEND URL - must use HTTPS for Android APK
const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

// Debug log for APK builds
console.log("🌐 LoginScreen API_BASE_URL:", API_BASE_URL);

export default function LoginScreen({ onLogin, navigation }) {
  const [email, setEmail] = useState("passenger@test.com");
  const [password, setPassword] = useState("Pass1234");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (loading) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok || !data?.token) {
        Alert.alert("Login failed", data?.message || "Please verify your credentials.");
        return;
      }

      onLogin(data.token, data?.user?.name);
    } catch (error) {
      Alert.alert("Network error", "Unable to reach server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Bus Tracker</Text>
        <Text style={styles.subtitle}>Sign in to view nearby buses and ETA</Text>

        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor="#9ca3af"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          autoCapitalize="none"
          placeholder="Password"
          placeholderTextColor="#9ca3af"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />

        <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleLogin}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>LOGIN</Text>
          )}
        </Pressable>
        <Button
          title="Login as Passenger"
          onPress={() =>
            navigation.navigate("PassengerLogin", {
              onLogin: (t, name) => {
                onLogin(t, name);
              },
            })
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 20,
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    gap: 10,
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
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#222",
    backgroundColor: "#ffffff",
  },
  button: {
    marginTop: 6,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
});
