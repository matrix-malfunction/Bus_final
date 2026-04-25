import React, { useMemo, useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://10.55.144.39:5000";

export default function PassengerLoginScreen({ route, onLogin }) {
  const routeOnLogin = route?.params?.onLogin;
  const loginHandler = useMemo(() => routeOnLogin || onLogin, [routeOnLogin, onLogin]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const handleLogin = async () => {
    if (!name.trim() || !phone.trim()) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/passenger/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, phone }),
      });

      const data = await res.json();

      if (data.success) {
        loginHandler?.(data.token, data.passenger?.name);
      }
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Passenger Login</Text>
        <TextInput
          style={styles.input}
          placeholder="Name"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Phone"
          value={phone}
          onChangeText={setPhone}
        />
      <Button title="Login as Passenger" onPress={handleLogin} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    elevation: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#222",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#ffffff",
  },
});
