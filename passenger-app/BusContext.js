import React, { createContext, useContext, useState, useEffect } from "react";
import io from "socket.io-client";

const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

// Static bus stops (exact coordinates)
const STATIC_STOPS = [
  { id: "vellore_1", name: "Vellore New Bus Station", lat: 12.9346, lng: 79.1366 },
  { id: "vellore_2", name: "Vellore Old Bus Stand", lat: 12.9223, lng: 79.1325 },
  { id: "vellore_3", name: "Vellore Smart City New Bus Stand", lat: 12.9347, lng: 79.1376 },
  { id: "vellore_4", name: "Jubilee Gate Bus Stop (CMC)", lat: 12.9245, lng: 79.1376 },
  { id: "vellore_5", name: "Vallalar Bus Stop", lat: 12.9383, lng: 79.1669 },
  { id: "vellore_6", name: "New Bus Stand (Thottapalayam)", lat: 12.9244, lng: 79.1273 },
  { id: "vellore_7", name: "Vellore TNSTC Bus Depot", lat: 12.9245, lng: 79.1149 },
  { id: "vellore_8", name: "Sainathapuram Bus Stop", lat: 12.8970, lng: 79.1352 },
  { id: "vellore_9", name: "Katpadi Bus Stand", lat: 12.9672, lng: 79.1374 },
  { id: "tvlr_1", name: "Thiruvallur Bus Stand", lat: 13.1386, lng: 79.9076 },
  { id: "tvlr_2", name: "Thiruvallur Terminal", lat: 13.1405, lng: 79.9080 },
  { id: "tvlr_3", name: "Thiruvallur Oil Mill Bus Stop", lat: 13.1227, lng: 79.9118 },
  { id: "tvlr_4", name: "Theradi Bus Stop", lat: 13.1433, lng: 79.9088 },
  { id: "tvlr_5", name: "Thiruvallur Court Bus Stop", lat: 13.1370, lng: 79.9176 },
  { id: "tvlr_6", name: "Thiruvallur Bustand (Kakkalur)", lat: 13.1227, lng: 79.9118 },
  { id: "tvlr_7", name: "Manavalanagar Bus Stop", lat: 13.1126, lng: 79.9133 },
  { id: "tvlr_8", name: "Ondikuppam Bus Stop", lat: 13.1104, lng: 79.9180 },
  { id: "tvlr_9", name: "SBI Bus Stop (JN Road)", lat: 13.1354, lng: 79.9087 }
];

export const BusContext = createContext({
  buses: {},
  sosAlerts: [],
  userLocation: null,
  socket: null,
  followBusId: null,
  setFollowBusId: () => {},
  busStops: STATIC_STOPS,
  busProgress: {}
});

export const useBus = () => useContext(BusContext);

export function BusProvider({ children }) {
  // Store buses as object keyed by busId for O(1) updates
  const [buses, setBuses] = useState({});
  const [sosAlerts, setSosAlerts] = useState([]);
  const [socket, setSocket] = useState(null);
  const [followBusId, setFollowBusId] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [busStops, setBusStops] = useState([]); // Will be populated from socket
  const [busProgress, setBusProgress] = useState({}); // Bus progression state

  useEffect(() => {
    const newSocket = io(API_BASE_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 20000,
      transports: ["websocket"]
    });
    setSocket(newSocket);

    // Socket connection event logging
    newSocket.on("connect", () => {
      console.log("[BusContext] Socket connected");
    });

    newSocket.on("disconnect", (reason) => {
      console.log("[BusContext] Socket disconnected:", reason);
    });

    newSocket.on("reconnect", (attemptNumber) => {
      console.log("[BusContext] Socket reconnected after", attemptNumber, "attempts");
    });

    newSocket.on("connect_error", (error) => {
      console.log("[BusContext] Socket connection error:", error.message);
    });

    // Listen for BUS_LOCATION_UPDATE from backend
    newSocket.on("BUS_LOCATION_UPDATE", (data) => {
      console.log("[BusContext] BUS_LOCATION_UPDATE received:", data);
      
      // Verify route metadata
      console.log("[PASSENGER ROUTE UPDATE]", {
        busId: data.busId,
        routeId: data.routeId,
        routeName: data.routeName,
        direction: data.direction,
        tripId: data.tripId,
      });
      
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
          snappedLat: data.snappedLat ?? null,  // Snapped coordinates (if within route corridor)
          snappedLng: data.snappedLng ?? null,
          isSnapped: data.isSnapped || false,
          distanceFromRoute: data.distanceFromRoute ?? null,
          speed: data.speed ?? 0,  // Raw GPS speed from backend (m/s)
          derivedSpeed: data.derivedSpeed ?? null,  // Backend-derived stable speed (km/h)
          trackingActive: data.trackingActive !== false,
          lastUpdate: Date.now(),
          // Route data from backend (if assigned)
          routeId: data.routeId || null,
          routeName: data.routeName || null,
          routeColor: data.routeColor || null,
          routeCoords: data.routeCoords || null,  // Active route corridor coordinates
          direction: data.direction || null,
          tripId: data.tripId || null,
          // Progression data from backend
          currentStopId: data.currentStopId || null,
          currentStopName: data.currentStopName || null,
          nextStopId: data.nextStopId || null,
          nextStopName: data.nextStopName || null,
          passedStopIds: data.passedStopIds || [],
          nextStopEtaMinutes: data.nextStopEtaMinutes ?? null,
          remainingDistanceMeters: data.remainingDistanceMeters ?? null,
          routeProgressIndex: data.routeProgressIndex ?? null,
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
      // Clear progression for offline bus
      setBusProgress((prevProgress) => {
        const updated = { ...prevProgress };
        delete updated[busId];
        return updated;
      });
      // Reset follow if this bus was followed
      setFollowBusId(prev => (prev === busId ? null : prev));
    });

    // Listen for full bus stops dataset from backend
    newSocket.on("INIT_BUS_STOPS", (data) => {
      console.log("[BusContext] INIT_BUS_STOPS received:", data?.stops?.length);
      if (data?.stops && Array.isArray(data.stops)) {
        setBusStops(data.stops);
        console.log("[BusContext] busStops updated:", data.stops.length);
      }
    });

    // Listen for BUS_PROGRESS_UPDATE from backend
    newSocket.on("BUS_PROGRESS_UPDATE", (data) => {
      console.log("[BusContext] BUS_PROGRESS_UPDATE received:", data);
      
      if (!data || !data.busId) {
        console.log("[BusContext] Invalid progress data, skipping");
        return;
      }
      
      setBusProgress((prevProgress) => ({
        ...prevProgress,
        [data.busId]: {
          tripId: data.tripId,
          routeId: data.routeId,
          currentStopIndex: data.currentStopIndex,
          nextStopIndex: data.nextStopIndex,
          passedStopIds: data.passedStopIds,
          remainingDistanceKm: data.remainingDistanceKm,
          progressPercent: data.progressPercent,
          etaMinutes: data.etaMinutes,
          avgSpeedKmh: data.avgSpeedKmh,
          lastUpdate: Date.now()
        }
      }));
    });

    // Cleanup socket listeners on unmount
    return () => {
      newSocket.off("BUS_LOCATION_UPDATE");
      newSocket.off("BUS_OFFLINE");
      newSocket.off("BUS_PROGRESS_UPDATE");
      newSocket.close();
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
    setUserLocation,
    busStops, // Now from socket, not hardcoded
    busProgress // Bus progression state from backend
  };

  return <BusContext.Provider value={value}>{children}</BusContext.Provider>;
}
