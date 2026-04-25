import "react-native-reanimated";
import "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import React, { useMemo, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { DrawerContentScrollView, DrawerItem, DrawerItemList } from "@react-navigation/drawer";
import LoginScreen from "./LoginScreen";
import HomeScreen from "./HomeScreen";
import ScheduleScreen from "./ScheduleScreen";
import FullMapScreen from "./FullMapScreen";
import ProfileScreen from "./ProfileScreen";
import EmergencyScreen from "./EmergencyScreen";
import PassengerLoginScreen from "./screens/PassengerLoginScreen";
import { MapPreviewProvider } from "./MapPreviewContext";

const Stack = createNativeStackNavigator();
const Drawer = createDrawerNavigator();

function DrawerApp({ token, userName, onLogout, renderHome }) {
  const CustomDrawer = React.useCallback(
    (props) => (
      <DrawerContentScrollView {...props}>
        <DrawerItemList {...props} />
        <DrawerItem label="Logout" onPress={onLogout} />
      </DrawerContentScrollView>
    ),
    [onLogout]
  );

  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerShown: true,
        lazy: true,
        swipeEdgeWidth: 60,
        headerShadowVisible: false,
      }}
    >
      <Drawer.Screen name="Home" options={{ title: "Home" }} children={renderHome} />
      <Drawer.Screen name="Profile" options={{ title: "Profile" }}>
        {(props) => <ProfileScreen {...props} userName={userName} token={token} />}
      </Drawer.Screen>
      <Drawer.Screen name="Schedule" options={{ title: "Schedule" }}>
        {(props) => <ScheduleScreen {...props} token={token} />}
      </Drawer.Screen>
      <Drawer.Screen name="SOS" options={{ title: "SOS" }}>
        {(props) => <EmergencyScreen {...props} token={token} />}
      </Drawer.Screen>
      <Drawer.Screen
        name="FullMap"
        options={{
          title: "Full Map",
          drawerItemStyle: { display: "none" },
        }}
      >
        {(props) => <FullMapScreen {...props} token={token} />}
      </Drawer.Screen>
    </Drawer.Navigator>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [userName, setUserName] = useState("");

  const authContext = useMemo(
    () => ({
      onLogin: (nextToken, nextUserName) => {
        setToken(nextToken);
        setUserName(nextUserName || "");
      },
      onLogout: () => {
        setToken(null);
        setUserName("");
      },
    }),
    []
  );

  const handleLogout = React.useCallback(() => {
    setToken(null);
  }, []);

  const renderHome = React.useCallback(
    (props) => (
      <HomeScreen
        {...props}
        token={token}
        userName={userName}
        onLogout={handleLogout}
      />
    ),
    [token, userName, handleLogout]
  );

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
        {token ? (
          <Stack.Screen name="Main" options={{ headerShown: false }}>
            {() => (
              <MapPreviewProvider>
                <DrawerApp
                  token={token}
                  userName={userName}
                  onLogout={handleLogout}
                  renderHome={renderHome}
                />
              </MapPreviewProvider>
            )}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Login" options={{ title: "Passenger Login" }}>
              {(props) => <LoginScreen {...props} onLogin={authContext.onLogin} />}
            </Stack.Screen>
            <Stack.Screen name="PassengerLogin" options={{ title: "Passenger Quick Login" }}>
              {(props) => (
                <PassengerLoginScreen
                  {...props}
                  onLogin={(t, name) => {
                    setToken(t);
                    setUserName(name);
                  }}
                />
              )}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
