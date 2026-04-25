import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILE_KEY = "passenger_profile";

export default function ProfileScreen({ userName }) {
  const [name, setName] = useState(userName || "");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("Profile is local to this device.");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PROFILE_KEY);
        if (!raw || !active) return;
        const parsed = JSON.parse(raw);
        setName(parsed?.name || userName || "");
        setPhone(parsed?.phone || "");
      } catch (error) {
        // keep defaults
      }
    })();
    return () => {
      active = false;
    };
  }, [userName]);

  const saveProfile = async () => {
    try {
      await AsyncStorage.setItem(
        PROFILE_KEY,
        JSON.stringify({
          name: String(name || "").trim(),
          phone: String(phone || "").trim(),
        })
      );
      setStatus("Profile saved locally.");
      Alert.alert("Saved", "Profile saved on this device.");
    } catch (error) {
      setStatus("Failed to save profile.");
      Alert.alert("Error", "Failed to save profile locally.");
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Passenger Profile</Text>
      <Text style={styles.status}>{status}</Text>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Name"
      />
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="Phone"
        keyboardType="phone-pad"
      />

      <Pressable style={styles.button} onPress={saveProfile}>
        <Text style={styles.buttonText}>Save Profile</Text>
      </Pressable>
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
  status: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 12,
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
