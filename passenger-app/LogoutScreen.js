import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

export default function LogoutScreen({ onLogout }) {
  useEffect(() => {
    onLogout?.();
  }, [onLogout]);

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.text}>Logging out...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  text: {
    color: "#334155",
  },
});
