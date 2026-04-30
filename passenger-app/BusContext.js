import React, { createContext, useContext, useState, useEffect } from "react";
import io from "socket.io-client";

const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

export const BusContext = createContext({
  buses: {},
  sosAlerts: [],
  userLocation: null,
  socket: null,
  followBusId: null,
  setFollowBusId: () => {}
});

export const useBus = () => useContext(BusContext);

export function BusProvider({ children }) {
  // Store buses as object keyed by busId for O(1) updates
  const [buses, setBuses] = useState({});
  const [sosAlerts, setSosAlerts] = useState([]);
  const [socket, setSocket] = useState(null);
  const [followBusId, setFollowBusId] = useState(null);
  const [userLocation, setUserLocation] = useState(null);

  useEffect(() => {
    const newSocket = io(API_BASE_URL);
    setSocket(newSocket);

    // Listen for BUS_LOCATION_UPDATE from backend
    newSocket.on("BUS_LOCATION_UPDATE", (data) => {
      console.log("[BusContext] BUS_LOCATION_UPDATE received:", data);
      
      if (!data || !data.busId) {
        console.log("[BusContext] Invalid data, skipping");
        return;
      }
      
      setBuses((prevBuses) => {
        // Clean replacement - no merging of nested stale fields
        const busData = {
          _id: data.busId,
          busId: data.busId,
          lat: data.latitude,
          lng: data.longitude,
          trackingActive: data.trackingActive !== false,
          lastUpdate: Date.now()
        };
        const newBuses = { ...prevBuses };
        newBuses[data.busId] = busData;  // Direct assignment, no merge
        console.log("[FLOW] Buses updated:", Object.keys(newBuses));
        return newBuses;
      });
    });

    newSocket.on("BUS_OFFLINE", (data) => {
      const busId = typeof data === 'string' ? data : data?.busId;
      console.log("[BusContext] BUS_OFFLINE received:", busId);
      if (!busId) return;
      setBuses((prevBuses) => {
        const updated = { ...prevBuses };
        delete updated[busId];
        console.log("[FLOW] Bus removed:", busId, "Remaining:", Object.keys(updated));
        return updated;
      });
      // Reset follow if this bus was followed
      setFollowBusId(prev => (prev === busId ? null : prev));
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const value = {
    buses,
    sosAlerts,
    socket,
    setSosAlerts,
    followBusId,
    setFollowBusId,
    userLocation,
    setUserLocation
  };

  return <BusContext.Provider value={value}>{children}</BusContext.Provider>;
}
