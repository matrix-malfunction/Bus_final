import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { NavigationContainer, useNavigation, useRoute } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DriverTrackingScreen from "./DriverTrackingScreen";

// PRODUCTION BACKEND URL - must use HTTPS for Android APK
const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";
const Stack = createNativeStackNavigator();

function LoginScreen() {
  const navigation = useNavigation();
  const [email, setEmail] = useState("driver@test.com");
  const [password, setPassword] = useState("Pass1234");
  const [status, setStatus] = useState("Not logged in");

  const handleLogin = async () => {
    console.log("Driver login button pressed");

    if (!email?.trim() || !password?.trim()) {
      alert("Please enter email and password");
      setStatus("Email and password are required");
      return;
    }

    try {
      console.log("Sending driver login request...");
      console.log("API:", `${API_BASE_URL}/api/auth/login`);
      console.log("EMAIL:", email);
      console.log("PASSWORD:", password);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const rawText = await response.text();
      console.log("Raw driver server response:", rawText);
      const data = JSON.parse(rawText);
      console.log("Driver login response:", data);

      if (!response.ok) {
        setStatus(data?.message || "Login failed");
        alert(data?.message || "Login failed");
        return;
      }

      if (!data?.token || !data?.user) {
        setStatus(data?.message || "Login failed");
        alert("Invalid credentials");
        return;
      }

      if (data.user.role !== "driver") {
        setStatus("Only driver role can use this app");
        alert("Invalid credentials");
        return;
      }

      setStatus(`Logged in as ${data.user.name}. You can now send location.`);
      console.log("Driver login success");
      navigation.replace("Tracking", { token: data.token });
    } catch (error) {
      console.log("Driver login error:", error);
      setStatus("Network error during login");
      alert("Network request failed");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.heading}>Driver App MVP</Text>

      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
      />

      <View style={styles.actions}>
        <Button title="Login" onPress={handleLogin} />
      </View>

      <Text style={styles.status}>Status: {status}</Text>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function TrackingScreen() {
  const route = useRoute();
  const { token } = route.params || {};

  return <DriverTrackingScreen token={token} />;
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Tracking" component={TrackingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 16,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  actions: {
    marginBottom: 10,
  },
  status: {
    marginTop: 16,
    textAlign: "center",
  },
});
