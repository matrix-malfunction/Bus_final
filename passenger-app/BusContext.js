import React, { createContext, useContext, useState, useEffect } from "react";
import io from "socket.io-client";

const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

export const BusContext = createContext({
  buses: {},
  sosAlerts: [],
  userLocation: null,
  socket: null
});

export const useBus = () => useContext(BusContext);

export function BusProvider({ children }) {
  // Store buses as object keyed by busId for O(1) updates
  const [buses, setBuses] = useState({});
  const [sosAlerts, setSosAlerts] = useState([]);
  const [socket, setSocket] = useState(null);

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
      
      setBuses((prevBuses) => ({
        ...prevBuses,
        [data.busId]: {
          _id: data.busId,
          busId: data.busId,
          lat: data.latitude,
          lng: data.longitude,
          trackingActive: true,
          lastUpdate: Date.now()
        }
      }));
    });

    newSocket.on("BUS_OFFLINE", (busId) => {
      console.log("[BusContext] BUS_OFFLINE received:", busId);
      setBuses((prevBuses) => {
        const updated = { ...prevBuses };
        delete updated[busId];
        return updated;
      });
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const value = {
    buses,
    sosAlerts,
    socket,
    setSosAlerts
  };

  return <BusContext.Provider value={value}>{children}</BusContext.Provider>;
}
