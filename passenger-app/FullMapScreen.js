import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { StyleSheet, View, TouchableOpacity, Text, DeviceEventEmitter } from "react-native";
import { WebView } from "react-native-webview";
import { useBus } from "./BusContext";

// API Configuration
const API_BASE_URL = 'https://bus-tracking-backend-6htm.onrender.com/api';

function escapeText(input) {
  return String(input ?? "Bus").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toFiniteCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default function FullMapScreen({ route }) {
  const webViewRef = useRef(null);
  const lastUserLocationRef = useRef(null); // Cache for resend on WebView load
  const busStopsRef = useRef(null); // Cache bus stops for resend
  const lastDrawnRouteRef = useRef(null); // Track last drawn route to prevent redraw spam
  const [webViewReady, setWebViewReady] = useState(false);
  const [showNearestRoute, setShowNearestRoute] = useState(false);

  // Default center (Chennai) - prevents crash when no route params
  const DEFAULT_CENTER = { latitude: 13.0827, longitude: 80.2707 };
  const { buses: contextBuses, socket, followBusId, setFollowBusId, setUserLocation, busStops, busProgress } = useBus();
  const { buses: routeBuses, userLocation: routeUserLocation, center: routeCenter, focusStop, userLocation: navUserLocation } = route?.params || {};

  // Convert context buses (object) to array and merge with route buses
  // MUST be defined before any hooks that reference it
  const buses = useMemo(() => {
    const contextBusesArray = Object.values(contextBuses || {});
    const routeBusesArray = Array.isArray(routeBuses) ? routeBuses : [];

    // Use context buses if available, otherwise fall back to route buses
    const sourceBuses = contextBusesArray.length > 0 ? contextBusesArray : routeBusesArray;

    return sourceBuses
      .map((bus) => {
        const latitude = toFiniteCoordinate(bus?.latitude ?? bus?.lat);
        const longitude = toFiniteCoordinate(bus?.longitude ?? bus?.lng);
        if (latitude === null || longitude === null) return null;
        
        // Merge progression data if available
        const progress = bus?.busId ? busProgress[bus.busId] : null;
        
        return {
          ...bus,
          latitude,
          longitude,
          lat: latitude,
          // Add progression data for popup display
          ...(progress && {
            currentStopIndex: progress.currentStopIndex,
            nextStopIndex: progress.nextStopIndex,
            etaMinutes: progress.etaMinutes,
            progressPercent: progress.progressPercent,
            remainingDistanceKm: progress.remainingDistanceKm,
          }),
          lng: longitude,
          busId: bus.busId || bus._id
        };
      })
      .filter(Boolean);
  }, [routeBuses, contextBuses, busProgress]);

  const center =
    routeCenter &&
    Number.isFinite(Number(routeCenter.latitude)) &&
    Number.isFinite(Number(routeCenter.longitude))
      ? routeCenter
      : DEFAULT_CENTER;
  const userLocation =
    routeUserLocation &&
    Number.isFinite(Number(routeUserLocation.latitude)) &&
    Number.isFinite(Number(routeUserLocation.longitude))
      ? routeUserLocation
      : null;

  // Handle MAP_READY from WebView - idempotent, always resend USER_LOCATION
  const handleWebViewMessage = useCallback((event) => {
    try {
      if (!event?.nativeEvent?.data) return;
      const data = JSON.parse(event.nativeEvent.data);
      if (!data?.type) return;

      // Idempotent MAP_READY handling - safe for duplicates
      if (data.type === "MAP_READY") {
        const alreadyReady = webViewReady;
        console.log("[FullMap] MAP_READY received (alreadyReady:", alreadyReady, ")");

        // Always mark as ready (idempotent)
        if (!alreadyReady) {
          setWebViewReady(true);
        }

        // Send INIT_BUS_STOPS on MAP_READY
        if (busStops && webViewRef.current) {
          console.log("[RN] stops:", busStops.length);
          webViewRef.current.postMessage(JSON.stringify({
            type: "INIT_BUS_STOPS",
            stops: busStops
          }));
          console.log("[FullMap] INIT_BUS_STOPS sent on MAP_READY:", busStops.length);
        }

        // ALWAYS resend cached user location on MAP_READY (recovery mechanism)
        if (lastUserLocationRef.current && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "USER_LOCATION",
            payload: lastUserLocationRef.current
          }));
          console.log("[FullMap] USER_LOCATION resent on MAP_READY");
        }

        // ALWAYS resend FOLLOW_UPDATE on MAP_READY
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "FOLLOW_UPDATE",
            followBusId: followBusId
          }));
          console.log("[FullMap] FOLLOW_UPDATE resent on MAP_READY");
        }

        // ALWAYS resend BUS_UPDATE on MAP_READY (recovery mechanism)
        // Use 50ms delay to ensure state is fresh
        setTimeout(() => {
          if (!webViewRef.current) return;

          // Get latest buses and enrich with progression data
          const latestBuses = Object.values(contextBuses || {}).map(bus => ({
            ...bus,
            progression: busProgress?.[bus.busId] || null,
          }));
          console.log("[FullMap RN] Sending BUS_UPDATE after MAP_READY:", latestBuses.length, "buses");

          webViewRef.current.postMessage(
            JSON.stringify({
              type: "BUS_UPDATE",
              buses: latestBuses
            })
          );
        }, 50);
      }
      
      // PING → MAP_READY recovery (optional handshake)
      if (data.type === "PING") {
        console.log("[FullMap] PING received, responding with PONG");
        webViewRef.current?.postMessage(JSON.stringify({ type: "PONG" }));
      }

      // BUS_SELECTED from WebView (user tapped marker)
      if (data.type === "BUS_SELECTED") {
        console.log("[FullMap] BUS_SELECTED:", data.busId);
        // Only select, do NOT auto-follow
        setSelectedBusId(data.busId);
      }

      // SET_FOLLOW from WebView (popup toggle - final state)
      if (data.type === "SET_FOLLOW") {
        console.log("[FullMap] SET_FOLLOW:", data.busId);
        setFollowBusId(data.busId || null); // Direct set, no toggle logic
      }

      // SOS_ACK from WebView (user clicked ACK button)
      if (data.type === "SOS_ACK") {
        const busId = data.busId;
        console.log("[FullMap] SOS_ACK from WebView:", busId);
        
        // Call backend to acknowledge SOS
        fetch(`${API_BASE_URL}/sos/ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ busId })
        })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then(result => {
          console.log("[FullMap] SOS acknowledged:", result);
          // Backend will emit SOS_ACKNOWLEDGED to all clients
        })
        .catch(error => {
          console.error("[FullMap] SOS ack failed:", error.message);
          // Send ACK_FAILED back to WebView to re-enable button
          webViewRef.current?.postMessage(JSON.stringify({
            type: "ACK_FAILED",
            busId: busId
          }));
        });
      }
    } catch (e) {
      console.log("[FullMap] Invalid message:", e.message);
    }
  }, [webViewReady, contextBuses, setFollowBusId, setSelectedBusId]);

  // Continuous user location sync (every 3 seconds)
  // Standardized schema: { type: "USER_LOCATION", payload: { latitude, longitude } }
  useEffect(() => {
    // Cache initial user location (use lat/lng format for WebView)
    if (route.params?.userLocation) {
      lastUserLocationRef.current = {
        lat: route.params.userLocation.latitude,
        lng: route.params.userLocation.longitude
      };
    }

    const interval = setInterval(() => {
      if (!route.params?.userLocation) return;

      // Update cache (use lat/lng format for WebView)
      lastUserLocationRef.current = {
        lat: route.params.userLocation.latitude,
        lng: route.params.userLocation.longitude
      };

      // Send if WebView ready
      if (webViewRef.current && webViewReady) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "USER_LOCATION",
          payload: lastUserLocationRef.current
        }));
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [webViewReady, route.params?.userLocation]);

  // Send BUS_UPDATE to WebView whenever buses change
  // ONLY send when WebView is ready to prevent lost messages
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;

    console.log("[FullMap RN] Sending BUS_UPDATE:", buses.length, "buses");
    webViewRef.current.postMessage(
      JSON.stringify({
        type: "BUS_UPDATE",
        buses: buses
      })
    );
  }, [buses, webViewReady]);

  // Send FOLLOW_UPDATE to WebView whenever followBusId changes (global follow state)
  // This triggers immediate speed badge visibility update
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;

    console.log("[FullMap RN] Sending FOLLOW_UPDATE:", followBusId);
    webViewRef.current.postMessage(
      JSON.stringify({
        type: "FOLLOW_UPDATE",
        followBusId: followBusId,
        userLocation: lastUserLocationRef.current
      })
    );
  }, [followBusId, webViewReady]);

  // Send STOP_PROGRESSION to WebView when busProgress changes
  // Backend-driven next stop highlighting (render-only in WebView)
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;
    if (!busProgress || Object.keys(busProgress).length === 0) return;

    // Send progression updates for each bus with valid next stop
    Object.entries(busProgress).forEach(([busId, progress]) => {
      if (progress?.nextStopIndex !== undefined && progress.nextStopIndex >= 0) {
        webViewRef.current.postMessage(
          JSON.stringify({
            type: "STOP_PROGRESSION",
            busId,
            nextStopIndex: progress.nextStopIndex,
            currentStopIndex: progress.currentStopIndex,
            etaMinutes: progress.etaMinutes,
          })
        );
        console.log("[FullMap RN] STOP_PROGRESSION sent for", busId, "next stop:", progress.nextStopIndex);
      }
    });
  }, [busProgress, webViewReady]);

  // Route corridor: fetch and draw when active route changes (NOT on GPS updates)
  useEffect(() => {
    // Determine active route from followed or selected bus
    const activeBusId = followBusId || selectedBusId;
    const activeBus = buses.find(b => b.busId === activeBusId || b.id === activeBusId);
    const activeRouteId = activeBus?.routeId || null;
    
    // Guard 1: No active route - clear and exit
    if (!activeRouteId || !webViewRef.current || !webViewReady) {
      if (!activeRouteId && lastDrawnRouteRef.current) {
        webViewRef.current?.postMessage(JSON.stringify({ type: "CLEAR_ROUTE" }));
        lastDrawnRouteRef.current = null;
      }
      return;
    }
    
    // Guard 2: Skip if same route already drawn (prevents redraw spam)
    if (lastDrawnRouteRef.current === activeRouteId) {
      console.log("[Route Corridor] Skip - already drawn:", activeRouteId);
      return;
    }
    
    // Guard 3: Cancelled fetch tracking
    let isCancelled = false;
    
    // Fetch route geometry from backend
    const fetchAndDrawRoute = async () => {
      try {
        console.log("[Route Corridor] Fetching route:", activeRouteId);
        const response = await fetch(`${API_BASE_URL}/routes/${activeRouteId}`);
        
        // Guard: Request was cancelled or component unmounted
        if (isCancelled) {
          console.log("[Route Corridor] Fetch cancelled, ignoring result");
          return;
        }
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        // Guard: Check again after async
        if (isCancelled) {
          console.log("[Route Corridor] Fetch cancelled after response");
          return;
        }
        
        if (!data.route?.coordinates) {
          console.log("[Route Corridor] No coordinates in route data");
          return;
        }

        // Guard: Final check before draw
        if (lastDrawnRouteRef.current === activeRouteId) {
          console.log("[Route Corridor] Skip draw - race condition");
          return;
        }

        // Send DRAW_ROUTE to WebView
        webViewRef.current.postMessage(JSON.stringify({
          type: "DRAW_ROUTE",
          routeId: activeRouteId,
          routeColor: activeBus.routeColor || data.route.color || "#2563eb",
          coordinates: data.route.coordinates,
        }));
        
        // Mark as drawn
        lastDrawnRouteRef.current = activeRouteId;
        console.log("[Route Corridor] Drawn route:", activeRouteId);
      } catch (err) {
        if (!isCancelled) {
          console.error("[Route Corridor] Failed to fetch route:", err.message);
        }
      }
    };

    fetchAndDrawRoute();
    
    // Cleanup: mark as cancelled if effect re-runs or unmounts
    return () => {
      isCancelled = true;
    };
  }, [followBusId, selectedBusId, buses]); // Dependencies: only bus selection/follow changes

  // Send FOCUS_STOP to WebView when navigating from nearest stops
  useEffect(() => {
    if (!focusStop || !webViewRef.current) return;

    console.log("[RN FullMap] Focusing stop:", focusStop.name);

    webViewRef.current.postMessage(
      JSON.stringify({
        type: "FOCUS_STOP",
        stop: focusStop,
        userLocation: navUserLocation,
      })
    );
  }, [focusStop, navUserLocation]);

  // Send toggle state to WebView when it changes
  useEffect(() => {
    if (!webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: "TOGGLE_NEAREST_ROUTE",
      enabled: showNearestRoute
    }));
    console.log("[RN] Toggle state sent to WebView:", showNearestRoute);
  }, [showNearestRoute]);

  // Handle BUS_OFFLINE from socket - send to WebView to remove marker
  useEffect(() => {
    if (!socket) return;

    const handleBusOffline = (data) => {
      const busId = typeof data === 'string' ? data : data?.busId;
      console.log("[FullMap RN] BUS_OFFLINE:", busId);

      if (webViewRef.current && webViewReady) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "BUS_OFFLINE",
          busId: busId
        }));
      }

      // Clear follow ONLY if this bus was being followed
      if (followBusId === busId) {
        console.log("[FullMap RN] Clearing follow for offline bus:", busId);
        setFollowBusId(null);
      }
      
      // Clear route corridor if this was the active bus
      if ((followBusId === busId || selectedBusId === busId) && webViewRef.current && webViewReady) {
        console.log("[FullMap RN] Clearing route corridor for offline bus:", busId);
        webViewRef.current.postMessage(JSON.stringify({ type: "CLEAR_ROUTE" }));
        lastDrawnRouteRef.current = null; // Reset to allow redraw if bus comes back online
      }
    };

    socket.on("BUS_OFFLINE", handleBusOffline);
    
    // SOS_ACKNOWLEDGED - popup update only, no new marker
    const handleSosAcknowledged = (data) => {
      console.log("[FullMap] SOS_ACKNOWLEDGED received:", data.busId);
      if (webViewRef.current && webViewReady) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "SOS_ACKNOWLEDGED",
          busId: data.busId
        }));
      }
    };
    socket.on("SOS_ACKNOWLEDGED", handleSosAcknowledged);
    
    return () => {
      socket.off("BUS_OFFLINE", handleBusOffline);
      socket.off("SOS_ACKNOWLEDGED", handleSosAcknowledged);
    };
  }, [socket, webViewReady, followBusId, selectedBusId, setFollowBusId]);

  // Global event listener for BUS_OFFLINE from HomeScreen
  useEffect(() => {
    const handleGlobalBusOffline = (data) => {
      console.log("[FullMap] Global BUS_OFFLINE received:", data.busId);
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "BUS_OFFLINE",
          busId: data.busId
        }));
      }
    };

    const subscription = DeviceEventEmitter.addListener("BUS_OFFLINE_GLOBAL", handleGlobalBusOffline);

    return () => {
      subscription.remove();
    };
  }, [webViewRef]);

  // Global event listener for SOS_TRIGGERED from HomeScreen
  useEffect(() => {
    const handleGlobalSosTriggered = (data) => {
      console.log("[FullMap] Global SOS_TRIGGERED received:", data.busId, "lat:", data?.lat, "lng:", data?.lng);
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "SOS_TRIGGERED",
          busId: data.busId,
          lat: data.lat,
          lng: data.lng
        }));
      }
    };

    const subscription = DeviceEventEmitter.addListener("SOS_TRIGGERED_GLOBAL", handleGlobalSosTriggered);

    return () => {
      subscription.remove();
    };
  }, [webViewRef]);

  // Global event listener for SOS_CLEARED from HomeScreen
  useEffect(() => {
    const handleGlobalSosCleared = (data) => {
      console.log("[FullMap] Global SOS_CLEARED received:", data.busId);
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "SOS_CLEARED",
          busId: data.busId
        }));
      }
    };

    const subscription = DeviceEventEmitter.addListener("SOS_CLEARED_GLOBAL", handleGlobalSosCleared);

    return () => {
      subscription.remove();
    };
  }, [webViewRef]);

  // Global event listener for SOS_ACKNOWLEDGED from HomeScreen
  useEffect(() => {
    const handleGlobalSosAcknowledged = (data) => {
      console.log("[FullMap] Global SOS_ACKNOWLEDGED received:", data.busId);
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "SOS_ACKNOWLEDGED",
          busId: data.busId
        }));
      }
    };

    const subscription = DeviceEventEmitter.addListener("SOS_ACKNOWLEDGED_GLOBAL", handleGlobalSosAcknowledged);

    return () => {
      subscription.remove();
    };
  }, [webViewRef]);

  const mapHTML = useMemo(
    () => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css"/>
        <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
        <style>
          html, body { margin:0; padding:0; height:100%; }
          #map { width:100%; height:100vh; }
          /* Beacon pulse animation - Google Maps style */
          .beacon-container { position: relative; }
          .beacon-dot {
            width: 12px; height: 12px; background: #007AFF; border-radius: 50%;
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2;
          }
          .beacon-pulse {
            width: 40px; height: 40px; background: rgba(0,122,255,0.3); border-radius: 50%;
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            animation: pulse-ring 1.5s ease-out infinite; z-index: 1;
          }
          @keyframes pulse-ring {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
          }
          /* Speed Badge Color Classes */
          .speed-badge { transition: background-color 0.3s ease; }
          .speed-low { background: #999 !important; color: white !important; }
          .speed-medium { background: #34C759 !important; color: white !important; }
          .speed-high { background: #FF9500 !important; color: white !important; }
          .speed-very-high {
            background: #FF3B30 !important;
            color: white !important;
            animation: speed-pulse 0.8s ease-out infinite;
          }
          @keyframes speed-pulse {
            0%, 100% { transform: translateX(-50%) scale(1); }
            50% { transform: translateX(-50%) scale(1.1); }
          }
          /* Modern Popup Styles */
          .bus-popup {
            padding: 12px;
            border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            min-width: 160px;
            background: white;
          }
          .bus-popup-header {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 8px;
            color: #333;
          }
          .bus-popup-row {
            font-size: 12px;
            color: #666;
            margin: 4px 0;
          }
          /* Toggle Switch */
          .follow-toggle { display: flex; align-items: center; margin-top: 8px; cursor: pointer; }
          .follow-toggle input { display: none; }
          .toggle-slider {
            width: 40px; height: 20px; background: #ccc; border-radius: 10px;
            position: relative; transition: 0.3s; margin-right: 8px;
          }
          .toggle-slider::after {
            content: ''; position: absolute; width: 16px; height: 16px;
            background: white; border-radius: 50%; top: 2px; left: 2px;
            transition: 0.3s;
          }
          .follow-toggle input:checked + .toggle-slider { background: #007AFF; }
          .follow-toggle input:checked + .toggle-slider::after { left: 22px; }
          .toggle-label { font-size: 12px; color: #333; }

          /* Modern Bus Stop Marker */
          .bus-stop-marker {
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .bus-stop-icon {
            width: 28px;
            height: 28px;
            background: white;
            border: 2px solid #333;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            font-size: 14px;
          }
          .bus-stop-label {
            background: white;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            margin-top: 4px;
            white-space: nowrap;
            max-width: 80px;
            overflow: hidden;
            text-overflow: ellipsis;
            box-shadow: 0 1px 4px rgba(0,0,0,0.15);
            color: #333;
          }
          .bus-stop-highlighted {
            background: #007AFF;
            border-color: #0051D5;
            width: 36px;
            height: 36px;
            font-size: 18px;
            box-shadow: 0 4px 12px rgba(0,122,255,0.4);
          }
          .bus-stop-highlighted-label {
            background: #007AFF;
            color: white;
          }
          /* User Popup */
          .user-popup {
            padding: 8px 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            color: #333;
            text-align: center;
          }
          #recenter-btn {
            position: absolute;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            width: 48px;
            height: 48px;
            background: white;
            border: none;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
          }
          #recenter-btn svg {
            fill: #333;
            pointer-events: none;
          }
          
          /* Production-Grade Bus Marker Architecture */
          .bus-marker-container {
            /* Reset Leaflet default positioning */
          }
          
          .bus-marker {
            position: relative;
            width: 48px;
            height: 60px;
            pointer-events: none;
            transform-origin: center center;
            transition: transform 0.3s ease;
          }
          
          /* Glow effect for followed bus */
          .bus-marker__glow {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 56px;
            height: 56px;
            transform: translate(-50%, -50%);
            background: radial-gradient(circle, rgba(0,122,255,0.4) 0%, transparent 70%);
            border-radius: 50%;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 1;
          }
          
          .bus-marker--followed {
            transform: scale(1.1);
          }
          
          .bus-marker--followed .bus-marker__glow {
            opacity: 1;
          }
          
          /* Main bus body - transit pill style */
          .bus-marker__body {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            padding: 4px 8px;
            background: #2563eb;
            border-radius: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            z-index: 2;
            min-width: 40px;
            height: 28px;
            transition: background-color 0.3s ease;
          }
          
          .bus-marker__icon {
            font-size: 16px;
            line-height: 1;
          }
          
          .bus-marker__route {
            font-size: 9px;
            font-weight: 700;
            color: white;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            white-space: nowrap;
          }
          
          /* Direction arrow */
          .bus-marker__direction {
            position: absolute;
            top: -8px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 14px;
            color: #333;
            text-shadow: 0 1px 2px rgba(255,255,255,0.8);
            z-index: 3;
            transition: transform 0.2s ease;
            line-height: 1;
          }
          
          /* ETA badge */
          .bus-marker__eta-badge {
            position: absolute;
            bottom: -6px;
            left: 50%;
            transform: translateX(-50%);
            background: #10b981;
            color: white;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 9px;
            font-weight: 600;
            white-space: nowrap;
            z-index: 3;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2);
            display: none;
          }
          
          /* SOS ring animation */
          .bus-marker__sos-ring {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 60px;
            height: 60px;
            border: 3px solid #ef4444;
            border-radius: 50%;
            z-index: 0;
            display: none;
            animation: sos-pulse 1s ease-out infinite;
          }
          
          .bus-marker--sos .bus-marker__sos-ring {
            display: block;
          }
          
          @keyframes sos-pulse {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
          }
          
          /* Offline state */
          .bus-marker--offline {
            opacity: 0.5;
            filter: grayscale(50%);
          }
          
          .bus-marker--offline .bus-marker__body {
            background: #9ca3af !important;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <!-- Speedometer overlay - shows speed of followed bus -->
        <div id="speedometer" style="
          position: absolute;
          left: 12px;
          bottom: 20px;
          z-index: 9999;
          background: rgba(0,0,0,0.7);
          color: white;
          padding: 8px 12px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: bold;
          backdrop-filter: blur(6px);
          display: none;
        ">
          Speed: -- km/h
        </div>
        <button id="recenter-btn">
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0-6v2a8 8 0 018 8h2A10 10 0 0012 2zm0 20v-2a8 8 0 01-8-8H2a10 10 0 0010 10zm10-10h-2a8 8 0 01-8 8v2a10 10 0 0010-10zM2 12h2a8 8 0 018-8V2A10 10 0 002 12z"/>
          </svg>
        </button>
        <script>
          document.addEventListener("DOMContentLoaded", function() {
            console.log("[WEBVIEW] DOMContentLoaded - Initializing...");

            // 1) CREATE MAP FIRST (all default controls disabled)
            const map = L.map('map', {
              zoomControl: false,
              attributionControl: false
            }).setView([${Number(center.latitude)}, ${Number(center.longitude)}], 14);
            window.map = map;

            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.map);

            // 2) REMOVE ANY INJECTED LAYER CONTROLS (safeguard)
            setTimeout(function() {
              document.querySelectorAll('.leaflet-control-layers').forEach(function(el) { el.remove(); });
              document.querySelectorAll('.leaflet-control-attribution').forEach(function(el) { el.remove(); });
            }, 0);

            // 2a) CREATE PANES FOR PROPER Z-ORDERING
            // Bus stops below buses for clean layering
            window.map.createPane('busStopsPane');
            window.map.getPane('busStopsPane').style.zIndex = 400;
            
            window.map.createPane('busesPane');
            window.map.getPane('busesPane').style.zIndex = 500;
            
            // Popup panes (above markers)
            window.map.createPane('busStopsPopupPane');
            window.map.getPane('busStopsPopupPane').style.zIndex = 600;
            
            window.map.createPane('busPopupPane');
            window.map.getPane('busPopupPane').style.zIndex = 650;
            
            // NOTE: Dragging map does NOT unfollow - follow is only controlled by SET_FOLLOW

            // 3) GLOBAL STATE (AFTER MAP INIT)
            window.busMarkers = {};
            window.userMarker = null;
            window.__followBusId = null;
            window.userLocation = null;
            window.__pendingBusStopRender = false;

            // 3) PRODUCTION-GRADE BUS MARKER ARCHITECTURE
            // Layered divIcon with DOM mutation-only updates
            // Supports: route color, heading, ETA, follow glow, SOS, offline states
            
            // Build bus marker HTML using string concatenation (no nested template literals)
            function buildBusMarkerHTML(color, shortName) {
              return '<div class="bus-marker" data-bus-id="">' +
                '<div class="bus-marker__glow"></div>' +
                '<div class="bus-marker__body" style="background: ' + color + ';">' +
                  '<span class="bus-marker__icon">🚌</span>' +
                  '<span class="bus-marker__route">' + shortName + '</span>' +
                '</div>' +
                '<div class="bus-marker__direction" style="transform: rotate(0deg);">➤</div>' +
                '<div class="bus-marker__eta-badge" style="display: none;">' +
                  '<span class="eta-time">--</span>' +
                '</div>' +
                '<div class="bus-marker__sos-ring" style="display: none;"></div>' +
              '</div>';
            }

            function createBusMarkerIcon(routeColor, routeName) {
              const color = routeColor || '#2563eb';
              const shortName = routeName ? routeName.substring(0, 3).toUpperCase() : 'BUS';
              
              return L.divIcon({
                html: buildBusMarkerHTML(color, shortName),
                className: 'bus-marker-container',
                iconSize: [48, 60],
                iconAnchor: [24, 30]
              });
            }
            
            // DOM element cache per marker for performance
            function getMarkerElements(marker) {
              if (!marker.__elements) {
                const el = marker.getElement();
                if (!el) return null;
                const container = el.querySelector('.bus-marker');
                if (!container) return null;
                
                marker.__elements = {
                  container,
                  glow: container.querySelector('.bus-marker__glow'),
                  body: container.querySelector('.bus-marker__body'),
                  direction: container.querySelector('.bus-marker__direction'),
                  etaBadge: container.querySelector('.bus-marker__eta-badge'),
                  etaTime: container.querySelector('.eta-time'),
                  route: container.querySelector('.bus-marker__route'),
                  sosRing: container.querySelector('.bus-marker__sos-ring')
                };
              }
              return marker.__elements;
            }
            
            // Update marker position (smooth animation ready)
            function updateBusPosition(marker, lat, lng) {
              marker.setLatLng([lat, lng]);
            }
            
            // Update heading direction (rotation only)
            function updateBusHeading(marker, heading) {
              const els = getMarkerElements(marker);
              if (els && els.direction && heading !== undefined) {
                els.direction.style.transform = 'rotate(' + heading + 'deg)';
              }
            }
            
            // Update ETA badge (text only, show/hide)
            function updateBusETA(marker, etaMinutes) {
              const els = getMarkerElements(marker);
              if (!els || !els.etaBadge) return;
              
              if (etaMinutes !== undefined && etaMinutes !== null && etaMinutes >= 0) {
                els.etaTime.textContent = etaMinutes + 'm';
                els.etaBadge.style.display = 'flex';
              } else {
                els.etaBadge.style.display = 'none';
              }
            }
            
            // Update follow state (CSS classes only)
            function updateBusFollowState(marker, isFollowing) {
              const els = getMarkerElements(marker);
              if (!els || !els.container) return;
              
              if (isFollowing) {
                els.container.classList.add('bus-marker--followed');
                els.glow.style.opacity = '1';
              } else {
                els.container.classList.remove('bus-marker--followed');
                els.glow.style.opacity = '0';
              }
            }
            
            // Update SOS state (CSS class + ring visibility)
            function updateBusSOS(marker, isSOS) {
              const els = getMarkerElements(marker);
              if (!els || !els.container) return;
              
              if (isSOS) {
                els.container.classList.add('bus-marker--sos');
                els.sosRing.style.display = 'block';
              } else {
                els.container.classList.remove('bus-marker--sos');
                els.sosRing.style.display = 'none';
              }
            }
            
            // Update offline state
            function updateBusOffline(marker, isOffline) {
              const els = getMarkerElements(marker);
              if (!els || !els.container) return;
              
              if (isOffline) {
                els.container.classList.add('bus-marker--offline');
              } else {
                els.container.classList.remove('bus-marker--offline');
              }
            }
            
            // Update route color (background only)
            function updateBusRouteColor(marker, routeColor) {
              const els = getMarkerElements(marker);
              if (els && els.body && routeColor) {
                els.body.style.background = routeColor;
              }
            }
            
            // Update route name text
            function updateBusRouteName(marker, routeName) {
              const els = getMarkerElements(marker);
              if (els && els.route && routeName) {
                els.route.textContent = routeName.substring(0, 3).toUpperCase();
              }
            }
            
            // Legacy speed badge functions (preserved for compatibility)
            const SPEED_MEDIUM = 5 / 3.6;
            const SPEED_HIGH = 20 / 3.6;
            const SPEED_VERY_HIGH = 40 / 3.6;
            
            function getSpeedClass(speedMps) {
              if (speedMps === undefined || speedMps === null) return '';
              if (speedMps < SPEED_MEDIUM) return 'speed-low';
              if (speedMps < SPEED_HIGH) return 'speed-medium';
              if (speedMps < SPEED_VERY_HIGH) return 'speed-high';
              return 'speed-very-high';
            }
            
            function updateSpeedBadge(busId, speed) {
              // Handled by main marker update - legacy function preserved
            }
            
            function hideSpeedBadge(busId) {
              // Handled by main marker update - legacy function preserved
            }
            
            function showSpeedBadge(busId) {
              // Handled by main marker update - legacy function preserved
            }

            // SOS emergency icon
            const sosIcon = L.icon({
              iconUrl: "https://cdn-icons-png.flaticon.com/512/1041/1041916.png",
              iconSize: [36, 36],
              iconAnchor: [18, 18]
            });

            // Initialize SOS markers storage (separate from bus markers)
            window.sosMarkers = window.sosMarkers || {};

            // 3a) CREATE POPUP HTML (dynamic follow/unfollow)
            // SPEEDOMETER UPDATE FUNCTION - UI only, no calculations
            function updateSpeedometer(busData) {
              if (!busData || typeof busData.speed === 'undefined') return;
              
              const el = document.getElementById('speedometer');
              if (!el) return;
              
              const speed = Math.round(busData.speed || 0);
              el.innerHTML = 'Speed: ' + speed + ' km/h';
              el.style.display = 'block';
            }
            
            // SPEEDOMETER RESET FUNCTION
            function resetSpeedometer() {
              const el = document.getElementById('speedometer');
              if (el) {
                el.innerHTML = 'Speed: -- km/h';
                el.style.display = 'none';
              }
            }

            // Route-aware popup with bus metadata and progression
            function createPopupHTML(bus) {
              const isFollowing = window.__followBusId === (bus.busId || bus.id);
              const checkedAttr = isFollowing ? 'checked' : '';
              const labelText = isFollowing ? 'Following' : 'Follow';
              const busId = bus.busId || bus.id || "Unknown";
              
              // Route info (fallback gracefully if missing)
              const routeName = bus.routeName || bus.route || null;
              const direction = bus.direction || null;
              const tripId = bus.tripId || null;
              
              // Speed (always show if available)
              const speedKmh = bus.speed !== undefined 
                ? Math.round(bus.speed * 3.6) 
                : null;
              
              // Tracking status
              const isTracking = bus.trackingActive !== false;
              const trackingStatus = isTracking ? "Active" : "Paused";
              
              // Progression data (backend-driven) - support both direct and nested progression
              const prog = bus.progression || bus;
              const progressPercent = prog.progressPercent !== undefined ? prog.progressPercent : null;
              const etaMinutes = prog.etaMinutes !== undefined ? prog.etaMinutes : null;
              const currentStopIndex = prog.currentStopIndex !== undefined ? prog.currentStopIndex : null;
              const nextStopIndex = prog.nextStopIndex !== undefined ? prog.nextStopIndex : null;
              const remainingDistanceKm = prog.remainingDistanceKm !== undefined ? prog.remainingDistanceKm : null;
              
              // Build route section
              let routeHtml = '';
              if (routeName) {
                routeHtml += '<div class="bus-popup-row bus-popup-route">' + routeName + '</div>';
              }
              if (direction) {
                routeHtml += '<div class="bus-popup-row bus-popup-direction">' + direction + '</div>';
              }
              
              // Build metadata section
              let metaHtml = '';
              if (speedKmh !== null) {
                metaHtml += '<div class="bus-popup-row">Speed: ' + speedKmh + ' km/h</div>';
              }
              metaHtml += '<div class="bus-popup-row">Trip: ' + trackingStatus + '</div>';
              if (tripId) {
                metaHtml += '<div class="bus-popup-row bus-popup-trip">ID: ' + tripId.slice(-6) + '</div>';
              }
              
              // Build progression section
              let progressHtml = '';
              if (progressPercent !== null) {
                progressHtml += '<div class="bus-popup-row">Progress: ' + progressPercent + '%</div>';
              }
              if (etaMinutes !== null) {
                progressHtml += '<div class="bus-popup-row">ETA: ' + etaMinutes + ' min</div>';
              }
              if (currentStopIndex !== null && nextStopIndex !== null && nextStopIndex >= 0) {
                progressHtml += '<div class="bus-popup-row">Next Stop: #' + (nextStopIndex + 1) + '</div>';
              }
              if (remainingDistanceKm !== null) {
                progressHtml += '<div class="bus-popup-row">Remaining: ' + remainingDistanceKm.toFixed(1) + ' km</div>';
              }
              
              return '<div class="bus-popup">' +
                '<div class="bus-popup-header">Bus: ' + busId + '</div>' +
                (routeName || direction ? '<div class="bus-popup-section">' + routeHtml + '</div>' : '') +
                '<div class="bus-popup-section">' + metaHtml + '</div>' +
                (progressHtml ? '<div class="bus-popup-section bus-popup-progress">' + progressHtml + '</div>' : '') +
                '<label class="follow-toggle">' +
                  '<input type="checkbox" ' + checkedAttr + ' data-bus-id="' + busId + '">' +
                  '<span class="toggle-slider"></span>' +
                  '<span class="toggle-label">' + labelText + '</span>' +
                '</label>' +
              '</div>';
            }

            // 3b) ETA CALCULATION
            function calculateETA(bus, user) {
              if (!bus.speed || bus.speed < 5) return null;
              const R = 6371000;
              const dLat = (user.lat - bus.lat) * Math.PI / 180;
              const dLng = (user.lng - bus.lng) * Math.PI / 180;
              const a = Math.sin(dLat/2)**2 + Math.cos(bus.lat * Math.PI/180) * Math.cos(user.lat * Math.PI/180) * Math.sin(dLng/2)**2;
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              const distance = R * c;
              const eta = distance / (bus.speed * (1000/3600));
              return Math.round(eta / 60);
            }

            // 3b) UPDATE BUS POPUP (keeps popup in sync with bus data)
            function updateBusPopup(marker, bus) {
              if (!marker || !marker.getPopup()) return;
              
              // Update popup content with latest data
              marker.setPopupContent(createPopupHTML(bus));
              
              // If following this bus, ensure popup stays open
              if (window.__followBusId === (bus.busId || bus.id)) {
                if (!marker.getPopup().isOpen()) {
                  marker.openPopup();
                }
              }
            }

            // 3c) TOGGLE FOLLOW (called from popup) with optimistic UI update
            window.toggleFollow = function(busId) {
              // Optimistic update: toggle immediately
              const wasFollowing = window.__followBusId === busId;
              window.__followBusId = wasFollowing ? null : busId;

              // Update popup content immediately if open
              const marker = window.busMarkers[busId];
              if (marker && marker.getPopup()?.isOpen() && marker.__busData) {
                marker.setPopupContent(createPopupHTML(marker.__busData));
              }

              // If unfollowing, close the popup
              if (wasFollowing && marker) {
                marker.closePopup();
              }

              // Send final follow state to React Native (not toggle)
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "SET_FOLLOW",
                busId: window.__followBusId // null if unfollowing, or busId if following
              }));
            };

            // POPUP EVENT DELEGATION - Handle checkbox clicks safely
            document.addEventListener('click', function(e) {
              const checkbox = e.target.closest('.bus-popup input[type="checkbox"]');
              if (checkbox) {
                const busId = checkbox.getAttribute('data-bus-id');
                if (busId) {
                  window.toggleFollow(busId);
                }
              }
            });

            // 3e) MAP CLICK HANDLER - Close popup only if not following
            window.map.on("click", () => {
              // Only close popup if not following (follow mode keeps popup open)
              if (!window.__followBusId) {
                window.map.closePopup();
              }
            });

            // 4) SINGLE MARKER FUNCTION - Source of truth
            function updateBusMarkers(buses) {
              if (!window.map || !buses) return;

              // Ensure persistent markers object (NEVER reassign)
              const markers = window.busMarkers || (window.busMarkers = {});

              // Add/update markers
              Object.entries(buses).forEach(function(entry) {
                const id = entry[0];
                const bus = entry[1];
                if (!bus?.lat || !bus?.lng) return;

                const latlng = [bus.lat, bus.lng];

                // Calculate ETA if user location exists
                let eta = null;
                if (window.userLocation) {
                  eta = calculateETA(bus, window.userLocation);
                }

                if (markers[id]) {
                  // UPDATE EXISTING MARKER - DOM mutation only, no recreation
                  const marker = markers[id];
                  
                  // 1. Update position
                  updateBusPosition(marker, bus.lat, bus.lng);
                  
                  // 2. Update heading (direction rotation only)
                  if (bus.heading !== undefined && bus.heading !== marker.__busData?.heading) {
                    updateBusHeading(marker, bus.heading);
                  }
                  
                  // 3. Update route color (if changed)
                  if (bus.routeColor !== marker.__busData?.routeColor) {
                    updateBusRouteColor(marker, bus.routeColor);
                  }
                  
                  // 4. Update route name (if changed)
                  if (bus.routeName !== marker.__busData?.routeName) {
                    updateBusRouteName(marker, bus.routeName);
                  }
                  
                  // 5. Update ETA badge (if progression data available)
                  const etaMinutes = bus.progression?.etaMinutes || bus.etaMinutes;
                  if (etaMinutes !== undefined) {
                    updateBusETA(marker, etaMinutes);
                  }
                  
                  // 6. Update follow state (CSS classes only)
                  const isFollowing = window.__followBusId === id;
                  const wasFollowing = marker.__isFollowing;
                  if (isFollowing !== wasFollowing) {
                    updateBusFollowState(marker, isFollowing);
                    marker.__isFollowing = isFollowing;
                    
                    // Update speedometer when follow state changes
                    if (isFollowing && bus.speed !== undefined) {
                      updateSpeedometer(bus);
                    }
                  }
                  
                  // 7. Update SOS state (if changed)
                  if (bus.sos !== marker.__busData?.sos) {
                    updateBusSOS(marker, bus.sos);
                  }
                  
                  // 8. Merge data for popup updates
                  marker.__busData = { ...marker.__busData, ...bus, id, eta };
                  
                  // 9. Update popup content (if open or following)
                  updateBusPopup(marker, marker.__busData);
                  
                  // 10. Update z-index based on state
                  if (window.__followBusId === id) {
                    marker.setZIndexOffset(1000);
                  } else if (bus.sos) {
                    marker.setZIndexOffset(2000);
                  } else {
                    marker.setZIndexOffset(0);
                  }
                  
                  // 11. Event-driven follow: camera tracks bus
                  if (window.__followBusId === id && !window.__isUserInteracting) {
                    throttledFollow(bus.lat, bus.lng);
                  }

                } else {
                  // CREATE NEW MARKER - only once per bus
                  const busData = { ...bus, id, eta };
                  
                  // Create production-grade divIcon with route color
                  const busIcon = createBusMarkerIcon(bus.routeColor, bus.routeName);
                  const marker = L.marker(latlng, { icon: busIcon, pane: 'busesPane' }).addTo(window.map);
                  
                  // Cache DOM element references for performance
                  getMarkerElements(marker);
                  
                  // Store full bus data on marker
                  marker.__busData = busData;
                  marker.__isFollowing = false;
                  
                  // Initialize visual states
                  if (bus.heading !== undefined) {
                    updateBusHeading(marker, bus.heading);
                  }
                  if (bus.sos) {
                    updateBusSOS(marker, true);
                  }
                  
                  // Show speed badge if this bus is already being followed
                  if (window.__followBusId === id) {
                    updateBusFollowState(marker, true);
                    marker.__isFollowing = true;
                    updateSpeedometer(busData);
                  }
                  
                  // Update ETA if available
                  const etaMinutes = bus.progression?.etaMinutes || bus.etaMinutes;
                  if (etaMinutes !== undefined) {
                    updateBusETA(marker, etaMinutes);
                  }

                  // Click to select
                  marker.on("click", function() {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: "BUS_SELECTED",
                      busId: id
                    }));
                  });

                  // Bind popup with modern UI (only once, in busPopupPane)
                  marker.bindPopup(createPopupHTML(busData), { 
                    pane: 'busPopupPane',
                    autoClose: false,
                    closeOnClick: false
                  });

                  // Set initial z-index
                  if (bus.sos) {
                    marker.setZIndexOffset(2000);
                  }

                  markers[id] = marker;

                  // Event-driven follow for newly created marker
                  if (window.__followBusId === id && !window.__isUserInteracting) {
                    throttledFollow(bus.lat, bus.lng);
                  }
                }
              });
            }

            // EVENT-DRIVEN FOLLOW with 500ms throttle
            let lastFollowTime = 0;
            function throttledFollow(lat, lng) {
              const now = Date.now();
              if (now - lastFollowTime < 500) return; // Throttle: max once per 500ms
              lastFollowTime = now;
              
              if (!window.map || !window.__followBusId || window.__isUserInteracting) return;
              
              window.map.flyTo([lat, lng], window.map.getZoom(), {
                animate: true,
                duration: 0.5
              });
            }

            // 5) USER LOCATION (unified beacon with CSS pulse)
            function setUserLocation(lat, lng) {
              if (!window.map) return;

              const pos = [lat, lng];
              window.userLocation = { lat, lng };

              // Marker (create once)
              if (!window.userMarker) {
                window.userMarker = L.circleMarker(pos, {
                  radius: 6,
                  color: "#007AFF",
                  fillColor: "#007AFF",
                  fillOpacity: 1,
                }).addTo(window.map);

                window.userMarker.bindPopup("📍 I am here");
              } else {
                window.userMarker.setLatLng(pos);
              }

              // CSS Pulse marker (create once) - zoom independent divIcon
              if (!window.userPulse) {
                const pulseIcon = L.divIcon({
                  className: 'beacon-container',
                  html: '<div class="beacon-dot"></div><div class="beacon-pulse"></div>',
                  iconSize: [20, 20],
                  iconAnchor: [10, 10]
                });
                window.userPulse = L.marker(pos, { icon: pulseIcon, zIndexOffset: -100 }).addTo(window.map);
              } else {
                window.userPulse.setLatLng(pos);
              }
            }

            // 6) BUS STOP MARKERS (fetched from backend, zoom-based rendering)
            // Initialize empty - will be populated via INIT_BUS_STOPS message
            window.__busStops = [];
window.__busStopMarkers = {};
window.__stopBusMap = {}; // stopId → [busIds]
window.__highlightedStopId = null; // Currently highlighted stop
window.__activeRouteStopId = null; // Persist route highlight across re-renders
window.__lastNearestDistance = Infinity; // For hysteresis
window.__nearestStopMarker = null; // Direct reference to nearest stop marker
window.__nearestStopData = null; // Stop data for nearest stop
window.__nearestDistance = Infinity; // Distance to nearest stop
window.__nearestRouteLayer = null; // Polyline for nearest stop route
window.__showNearestRoute = false; // Route toggle state
window.__lastUserLocation = null; // Cached user location
window.__lastOsrmRequest = 0; // Throttle OSRM requests
window.__osrmPending = false; // Prevent duplicate requests

// Bus stop icon
function createStopIcon(name) {
  return L.divIcon({
    html: '<div class="bus-stop-marker">' +
      '<div class="bus-stop-icon">🛑</div>' +
      '<div class="bus-stop-label">' + (name || 'Stop') + '</div>' +
      '</div>',
    className: '',
    iconSize: [80, 60],
    iconAnchor: [40, 60]
  });
}

// Highlighted bus stop icon for next stop
function createHighlightedStopIcon(name, etaMinutes) {
  const etaLabel = etaMinutes !== undefined && etaMinutes !== null 
    ? '<div class="stop-eta">ETA: ' + etaMinutes + ' min</div>' 
    : '';
  return L.divIcon({
    html: '<div class="bus-stop-marker highlighted-stop">' +
      '<div class="bus-stop-icon" style="background: #f59e0b; color: white; border-radius: 50%; padding: 4px;">📍</div>' +
      '<div class="bus-stop-label">' + (name || 'Stop') + '</div>' +
      etaLabel +
      '</div>',
    className: '',
    iconSize: [100, 80],
    iconAnchor: [50, 80]
  });
}

// Haversine distance in meters
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Compute nearest stop for each bus (50m threshold)
function computeStopBusMapping(buses) {
  if (!buses || !window.__busStops) return;

  // Reset mapping
  window.__stopBusMap = {};

  const busArray = Object.values(buses || {});
  busArray.forEach(function(bus) {
    if (!bus || !bus.lat || !bus.lng) return;

    let nearestStop = null;
    let minDistance = Infinity;

    window.__busStops.forEach(function(stop) {
      if (!stop.id || !stop.lat || !stop.lng) return;

      const distance = haversine(bus.lat, bus.lng, stop.lat, stop.lng);

      if (distance < minDistance && distance < 50) { // 50m threshold
        minDistance = distance;
        nearestStop = stop;
      }
    });

    if (nearestStop) {
      if (!window.__stopBusMap[nearestStop.id]) {
        window.__stopBusMap[nearestStop.id] = [];
      }
      window.__stopBusMap[nearestStop.id].push(bus.busId || bus.id);
    }
  });
}

// Update stop popup with buses
function updateStopPopups() {
  Object.keys(window.__busStopMarkers).forEach(function(stopId) {
    const marker = window.__busStopMarkers[stopId];
    if (!marker) return;

    const busIds = window.__stopBusMap[stopId] || [];
    const stopName = marker.__stopName || 'Bus Stop';

    let content = '<b>' + stopName + '</b><br>';

    if (busIds.length > 0) {
      content += '<span style="font-size:12px;color:#666;">Buses: ' + busIds.length + '</span>';
    } else {
      content += '<span style="font-size:12px;color:#999;">No buses nearby</span>';
    }

    if (marker.getPopup()) {
      marker.setPopupContent(content);
    }
  });
}

// Apply highlight to a marker
function applyHighlight(marker) {
  if (!marker || !marker.__stopName) return;
  marker.setIcon(L.divIcon({
    html: '<div class="bus-stop-marker">' +
      '<div class="bus-stop-icon bus-stop-highlighted">🛑</div>' +
      '<div class="bus-stop-label bus-stop-highlighted-label">' + marker.__stopName + '</div>' +
      '</div>',
    className: '',
    iconSize: [80, 60],
    iconAnchor: [40, 60]
  }));
}

// Remove highlight from current highlighted stop
function removeHighlight() {
  if (window.__highlightedStopId && window.__busStopMarkers[window.__highlightedStopId]) {
    const marker = window.__busStopMarkers[window.__highlightedStopId];
    const stopName = marker.__stopName || 'Stop';
    marker.setIcon(createStopIcon(stopName));
    window.__highlightedStopId = null;
    console.log("[WEBVIEW] Highlight removed from", stopName);
  }
}

// Draw route from user location to stop using OSRM
async function drawRouteToStop(userLat, userLng, stopLat, stopLng) {
  console.log("[WEBVIEW] drawRouteToStop:", userLat, userLng, "→", stopLat, stopLng);
  
  // Remove previous route if exists
  if (window.__focusRouteLayer) {
    window.map.removeLayer(window.__focusRouteLayer);
    window.__focusRouteLayer = null;
  }
  
  try {
    // Fetch OSRM route (using string concatenation to avoid nested template literal issues)
    const url =
      "https://router.project-osrm.org/route/v1/foot/" +
      userLng +
      "," +
      userLat +
      ";" +
      stopLng +
      "," +
      stopLat +
      "?overview=full&geometries=geojson";
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.routes || !data.routes[0]) {
      console.log("[WEBVIEW] No route found");
      return null;
    }
    
    const route = data.routes[0];
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lat, lng]
    
    // Draw polyline
    window.__focusRouteLayer = L.polyline(coords, {
      color: '#007AFF',
      weight: 5,
      opacity: 0.9,
      dashArray: '10, 10'
    }).addTo(window.map);
    
    // Calculate distance and ETA
    const distanceKm = (route.distance / 1000).toFixed(1);
    const etaMin = Math.ceil(route.duration / 60);
    
    console.log("[WEBVIEW] Route drawn:", distanceKm + "km,", etaMin + "min");
    
    return { distanceKm, etaMin };
  } catch (err) {
    console.error("[WEBVIEW] drawRouteToStop error:", err.message);
    return null;
  }
}

// Highlight nearest stop to user
function highlightNearestStop(userLat, userLng, shouldHighlight) {
  console.log("[WEBVIEW] highlightNearestStop called:", userLat, userLng, "shouldHighlight:", shouldHighlight, "markers:", Object.keys(window.__busStopMarkers || {}).length, "stops:", window.__busStops?.length);
  
  if (!window.__busStops || !window.__busStops.length) {
    console.log("[WEBVIEW] highlightNearestStop: no bus stops available");
    return;
  }
  
  if (!window.__busStopMarkers || Object.keys(window.__busStopMarkers).length === 0) {
    console.log("[WEBVIEW] highlightNearestStop: no bus stop markers rendered");
    return;
  }

  let nearestStop = null;
  let minDistance = Infinity;
  let nearestMarker = null;

  window.__busStops.forEach(function(stop) {
    if (!stop.id || !stop.lat || !stop.lng) return;
    
    // Only consider stops that have rendered markers
    const marker = window.__busStopMarkers[stop.id];
    if (!marker) return;

    const distance = haversine(userLat, userLng, stop.lat, stop.lng);
    
    // Always track closest stop (no distance threshold)
    if (distance < minDistance) {
      minDistance = distance;
      nearestStop = stop;
      nearestMarker = marker;
    }
  });
  
  console.log("[WEBVIEW] highlightNearestStop: closest=" + (nearestStop?.name || "none") + " distance=" + (minDistance !== Infinity ? minDistance.toFixed(0) + "m" : "N/A"));

  // Always update popup if we have a nearest stop
  if (nearestStop && nearestMarker) {
    // Reset previous highlight if stop changed
    if (window.__highlightedStopId && window.__highlightedStopId !== nearestStop.id && window.__busStopMarkers[window.__highlightedStopId]) {
      const prevMarker = window.__busStopMarkers[window.__highlightedStopId];
      const prevStopName = prevMarker.__stopName || 'Stop';
      prevMarker.setIcon(createStopIcon(prevStopName));
    }
    
    // Apply highlight only if shouldHighlight AND __showNearestRoute
    if (shouldHighlight && window.__showNearestRoute && window.__highlightedStopId !== nearestStop.id) {
      applyHighlight(nearestMarker);
      window.__highlightedStopId = nearestStop.id;
      console.log("[WEBVIEW] Highlight applied to:", nearestStop.name);
    } else if (!shouldHighlight || !window.__showNearestRoute) {
      // Store nearest but don't highlight
      window.__highlightedStopId = nearestStop.id;
    }

    // Check if nearest stop changed
    const stopChanged = window.__highlightedStopId && window.__highlightedStopId !== nearestStop.id;
    
    // Store data (always)
    window.__nearestStopMarker = nearestMarker;
    window.__nearestStopData = nearestStop;
    window.__nearestDistance = minDistance;
    
    // Only update popup if showNearestRoute is true
    if (window.__showNearestRoute) {
      updateNearestStopPopup(userLat, userLng);
      
      // If nearest stop changed, switch popup to new marker
      if (stopChanged && window.__busStopMarkers[window.__highlightedStopId]) {
        const prevMarker = window.__busStopMarkers[window.__highlightedStopId];
        if (prevMarker.isPopupOpen()) {
          prevMarker.closePopup();
        }
        nearestMarker.openPopup();
        console.log("[WEBVIEW] Popup switched to new nearest stop:", nearestStop.name);
      }
    }
  } else {
    // No stop found - clear highlight
    removeHighlight();
    window.__nearestStopMarker = null;
    window.__nearestStopData = null;
    window.__nearestDistance = Infinity;
    console.log("[WEBVIEW] highlightNearestStop: no nearest stop found");
  }
}

// Update nearest stop popup with distance and ETA
function updateNearestStopPopup(userLat, userLng) {
  // Return early if route toggle is off
  if (!window.__showNearestRoute) {
    return;
  }
  
  console.log("[WEBVIEW] updateNearestStopPopup called with:", userLat, userLng);
  
  if (!window.__nearestStopMarker) {
    console.log("[WEBVIEW] updateNearestStopPopup: no nearest marker stored");
    return;
  }
  
  const marker = window.__nearestStopMarker;
  if (!marker) {
    console.log("[WEBVIEW] updateNearestStopPopup: marker is null");
    return;
  }
  
  const stopName = marker.__stopName || 'Bus Stop';
  const stopLat = marker.getLatLng().lat;
  const stopLng = marker.getLatLng().lng;
  
  console.log("[WEBVIEW] updateNearestStopPopup: stopName=" + stopName + " stopLat=" + stopLat + " stopLng=" + stopLng);
  
  // Compute distance using Haversine
  const distance = haversine(userLat, userLng, stopLat, stopLng);
  
  // Compute ETA (walking speed: 1.4 m/s)
  const etaSeconds = Math.round(distance / 1.4);
  const etaMinutes = Math.ceil(etaSeconds / 60);
  
  // Format distance
  let distanceStr;
  if (distance < 1000) {
    distanceStr = Math.round(distance) + ' m';
  } else {
    distanceStr = (distance / 1000).toFixed(1) + ' km';
  }
  
  console.log("[WEBVIEW] updateNearestStopPopup: distance=" + distanceStr + " ETA=" + etaMinutes + "min");
  
  // Build popup content with distance and ETA
  let content = '<b>' + stopName + '</b><br>';
  content += '<span style="font-size:12px;color:#007AFF;">📍 ' + distanceStr + ' away</span><br>';
  content += '<span style="font-size:12px;color:#16a34a;">🚶 ' + etaMinutes + ' min walk</span>';
  
  // Get buses at this stop
  const busIds = window.__stopBusMap[window.__highlightedStopId] || [];
  if (busIds.length > 0) {
    content += '<br><span style="font-size:12px;color:#666;">🚌 ' + busIds.length + ' bus' + (busIds.length > 1 ? 'es' : '') + ' nearby</span>';
  }
  
  // Update popup content using setPopupContent (not bindPopup)
  if (marker.getPopup()) {
    marker.setPopupContent(content);
    // Force UI refresh if popup is open
    if (marker.isPopupOpen()) {
      marker.getPopup().update();
      console.log("[WEBVIEW] updateNearestStopPopup: popup content updated and UI refreshed");
    } else {
      console.log("[WEBVIEW] updateNearestStopPopup: popup content updated (popup closed)");
    }
  } else {
    console.log("[WEBVIEW] updateNearestStopPopup: no popup exists on marker");
  }
}

// Fetch OSRM route
async function fetchOsrmRoute(fromLat, fromLng, toLat, toLng) {
  if (Date.now() - window.__lastOsrmRequest < 1500) {
    console.log("[OSRM] throttled");
    return null;
  }

  window.__lastOsrmRequest = Date.now();

  try {
    const url =
      "https://router.project-osrm.org/route/v1/walking/" +
      fromLng + "," + fromLat + ";" +
      toLng + "," + toLat +
      "?overview=full&geometries=geojson";

    console.log("[OSRM URL]", url);

    const res = await fetch(url);
    const data = await res.json();

    console.log("[OSRM RESPONSE]", data);

    if (!data.routes || data.routes.length === 0) {
      return null;
    }

    const coords = data.routes[0].geometry.coordinates;

    return coords.map(function(c) {
      return [c[1], c[0]];
    });

  } catch (e) {
    console.log("[OSRM ERROR]", e);
    return null;
  }
}

// Draw straight line fallback
function drawStraightLine(lat, lng, nearest) {
  if (window.__nearestRouteLayer) {
    window.map.removeLayer(window.__nearestRouteLayer);
  }

  window.__nearestRouteLayer = L.polyline(
    [[lat, lng], [nearest.lat, nearest.lng]],
    {
      color: '#007AFF',
      weight: 4,
      dashArray: '8, 8'
    }
  ).addTo(window.map);
  console.log("[WEBVIEW] Drew straight line to:", nearest.name);
}

// Update nearest route polyline (with OSRM)
async function updateNearestRoute(lat, lng) {
  if (!window.map) return;
  if (!window.__busStops || window.__busStops.length === 0) return;

  console.log("[WEBVIEW] Stops:", window.__busStops?.length);
  console.log("[WEBVIEW] Location:", window.__lastUserLocation);

  let nearest = null;
  let minDist = Infinity;

  window.__busStops.forEach(stop => {
    if (!stop.lat || !stop.lng) return;

    const d = Math.sqrt(
      Math.pow(stop.lat - lat, 2) +
      Math.pow(stop.lng - lng, 2)
    );

    if (d < minDist) {
      minDist = d;
      nearest = stop;
    }
  });

  if (!nearest) return;

  const route = await fetchOsrmRoute(lat, lng, nearest.lat, nearest.lng);

  // Remove old route AFTER getting new one
  if (window.__nearestRouteLayer) {
    window.map.removeLayer(window.__nearestRouteLayer);
  }

  if (route && route.length > 0) {
    window.__nearestRouteLayer = L.polyline(route, {
      color: '#007AFF',
      weight: 5,
      opacity: 0.9
    }).addTo(window.map);

    console.log("[WEBVIEW] OSRM route drawn");
  } else {
    // fallback
    window.__nearestRouteLayer = L.polyline(
      [[lat, lng], [nearest.lat, nearest.lng]],
      {
        color: '#007AFF',
        weight: 4,
        dashArray: '8, 8'
      }
    ).addTo(window.map);

    console.log("[WEBVIEW] Fallback straight line used");
  }
}

// Render bus stops
function renderBusStops() {
  console.log("[WEBVIEW] renderBusStops received:", window.__busStops?.length, "stops");
  if (!window.map || !window.__busStops) return;

  const zoom = window.map.getZoom();

  if (zoom < 14) {
    Object.values(window.__busStopMarkers).forEach(m => {
      if (window.map.hasLayer(m)) window.map.removeLayer(m);
    });
    return;
  }

  window.__busStops.forEach(stop => {
    if (!stop.id || !stop.lat || !stop.lng) return;

    let marker = window.__busStopMarkers[stop.id];

    if (!marker) {
      marker = L.marker([stop.lat, stop.lng], {
        icon: createStopIcon(stop.name),
        pane: 'busStopsPane'
      }).addTo(window.map);

      marker.__stopName = stop.name;
      marker.bindPopup(
        '<b>' + stop.name + '</b><br><span style="font-size:12px;color:#999;">Loading...</span>'
      );

      window.__busStopMarkers[stop.id] = marker;
    } else {
      marker.setLatLng([stop.lat, stop.lng]);
      if (!window.map.hasLayer(marker)) marker.addTo(window.map);
    }
  });
}

// Zoom handler
window.map.on("zoomend", function() {
  renderBusStops();
});

            // 7) RECENTER FUNCTION
            function recenterToUser() {
              if (!window.map) return;

              if (window.userMarker) {
                const pos = window.userMarker.getLatLng();
                window.map.flyTo(pos, 15, { duration: 0.5 });
              }
            }

            // 8) ATTACH RECENTER BUTTON (guarded)
            if (!window.__recenterAdded) {
              window.__recenterAdded = true;
              document.getElementById("recenter-btn")?.addEventListener("click", recenterToUser);
            }

            // SOS ACKNOWLEDGE FUNCTION - sends to React Native
            function acknowledgeSos(busId) {
              if (!busId) return;
              
              // Prevent double-click
              if (window.__ackLock && window.__ackLock[busId]) {
                console.log("[WEBVIEW] ACK already pending for", busId);
                return;
              }
              
              // Set lock
              if (!window.__ackLock) window.__ackLock = {};
              window.__ackLock[busId] = true;
              
              // Disable button
              const btn = document.getElementById(\`ack-btn-\${busId}\`);
              if (btn) {
                btn.disabled = true;
                btn.textContent = "ACKNOWLEDGING...";
                btn.style.background = "#999";
              }
              
              // Send to React Native
              window.ReactNativeWebView?.postMessage(JSON.stringify({
                type: "SOS_ACK",
                busId: busId
              }));
              console.log("[WEBVIEW] SOS_ACK sent for", busId);
            }

            // 9) MESSAGE HANDLER (async to support await in handlers)
            async function handleMessage(event) {
              let data;
              try {
                data = JSON.parse(event.data || "{}");
              } catch (e) {
                return;
              }
              if (!data || !window.map) return;

              switch (data.type) {
                case "INIT_BUS_STOPS":
                  console.log("[WEBVIEW] INIT_BUS_STOPS received:", data.stops?.length);
                  if (!Array.isArray(data.stops)) {
                    console.log("[WEBVIEW] Invalid INIT_BUS_STOPS");
                    return;
                  }
                  window.__busStops = data.stops;

                  if (window.map) {
                    renderBusStops();
                  } else {
                    setTimeout(function() {
                      if (window.map) renderBusStops();
                    }, 300);
                  }

                  // Re-apply route highlight after stops are rendered
                  if (window.__activeRouteStopId) {
                    setTimeout(function() {
                      if (window.__busStopMarkers[window.__activeRouteStopId]) {
                        const marker = window.__busStopMarkers[window.__activeRouteStopId];
                        const stopName = marker.__stopName || 'Stop';
                        marker.setIcon(createHighlightedStopIcon(stopName));
                        window.__highlightedStopId = window.__activeRouteStopId;
                        console.log("[WEBVIEW] INIT_BUS_STOPS: re-applied route highlight for", window.__activeRouteStopId);
                      }
                    }, 350); // After renderBusStops completes
                  }
                  break;

                case "BUS_UPDATE":
                  // Normalize payload: handle both array and object formats
                  const buses = Array.isArray(data.buses)
                    ? Object.fromEntries(data.buses.map(b => [b.busId || b.id, b]))
                    : data.buses;
                  updateBusMarkers(buses || {});

                  // Compute stop-bus mapping and update popups
                  computeStopBusMapping(buses);
                  updateStopPopups();
                  break;

                case "USER_LOCATION":
                  console.log("[WEBVIEW] USER_LOCATION RECEIVED:", data.payload);
                  if (data.payload?.lat != null && data.payload?.lng != null) {
                    const lat = Number(data.payload.lat);
                    const lng = Number(data.payload.lng);
                    if (!isNaN(lat) && !isNaN(lng)) {
                      setUserLocation(lat, lng);
                      highlightNearestStop(lat, lng, false);
                      
                      // Store user location for route drawing
                      window.__lastUserLocation = {
                        lat: lat,
                        lng: lng
                      };
                      
                      if (window.__showNearestRoute) {
                        updateNearestRoute(lat, lng);
                      }
                    } else {
                      console.error("[WEBVIEW] Invalid lat/lng:", data.payload);
                    }
                  } else {
                    console.error("[WEBVIEW] Missing lat/lng in payload:", data.payload);
                  }
                  break;

                case "DRAW_ROUTE":
                  // Route corridor drawing (coordinates array)
                  if (data.coordinates && Array.isArray(data.coordinates)) {
                    // Skip if same route already active
                    if (window.__activeRouteId === data.routeId && window.__activeRouteLine) {
                      console.log("[WEBVIEW] DRAW_ROUTE: skip - same route active:", data.routeId);
                      break;
                    }
                    
                    // Check if this is a new route (for viewport fitting)
                    const isNewRoute = window.__activeRouteId !== data.routeId;
                    
                    // Remove previous route line if exists
                    if (window.__activeRouteLine) {
                      window.map.removeLayer(window.__activeRouteLine);
                      window.__activeRouteLine = null;
                      window.__activeRouteId = null;
                    }
                    
                    // Draw new route polyline
                    const routeLine = L.polyline(data.coordinates, {
                      color: data.routeColor || "#2563eb",
                      weight: 5,
                      opacity: 0.7,
                    }).addTo(window.map);
                    
                    window.__activeRouteLine = routeLine;
                    window.__activeRouteId = data.routeId;
                    
                    // One-time viewport fit: only fit on new route, not during GPS updates
                    if (isNewRoute) {
                      // Small delay to ensure polyline is fully rendered
                      setTimeout(() => {
                        if (window.__activeRouteLine && window.map) {
                          window.map.fitBounds(
                            routeLine.getBounds(),
                            { padding: [40, 40], animate: true }
                          );
                          console.log("[WEBVIEW] DRAW_ROUTE: fitted viewport to route", data.routeId);
                        }
                      }, 100);
                      window.__routeFittedOnce = true;
                    }
                    
                    console.log("[WEBVIEW] DRAW_ROUTE: drew route corridor", data.routeId, "with", data.coordinates.length, "points");
                    break;
                  }
                  
                  // Store route stop ID for persistent highlighting (legacy)
                  if (data.stopId) {
                    window.__activeRouteStopId = data.stopId;
                    // Apply highlight immediately if marker exists
                    if (window.__busStopMarkers[data.stopId]) {
                      const marker = window.__busStopMarkers[data.stopId];
                      if (window.__highlightedStopId && window.__highlightedStopId !== data.stopId) {
                        const prev = window.__busStopMarkers[window.__highlightedStopId];
                        if (prev) {
                          const prevStopName = prev.__stopName || 'Stop';
                          prev.setIcon(createStopIcon(prevStopName));
                        }
                      }
                      const stopName = marker.__stopName || 'Stop';
                      marker.setIcon(createHighlightedStopIcon(stopName));
                      window.__highlightedStopId = data.stopId;
                      console.log("[WEBVIEW] DRAW_ROUTE: highlighted stop", data.stopId);
                    }
                  }
                  break;

                case "CLEAR_ROUTE":
                  // Remove route corridor polyline
                  if (window.__activeRouteLine) {
                    window.map.removeLayer(window.__activeRouteLine);
                    window.__activeRouteLine = null;
                    window.__activeRouteId = null;
                    window.__routeFittedOnce = false; // Reset to allow refitting on next route
                    console.log("[WEBVIEW] CLEAR_ROUTE: removed route corridor");
                  }
                  
                  // Clear route stop highlight (legacy)
                  if (window.__activeRouteStopId) {
                    if (window.__highlightedStopId && window.__busStopMarkers[window.__highlightedStopId]) {
                      const marker = window.__busStopMarkers[window.__highlightedStopId];
                      const stopName = marker.__stopName || 'Stop';
                      marker.setIcon(createStopIcon(stopName));
                    }
                    window.__highlightedStopId = null;
                    window.__activeRouteStopId = null;
                    console.log("[WEBVIEW] CLEAR_ROUTE: highlight cleared");
                  }
                  break;

                case "STOP_PROGRESSION": {
                  const { busId, nextStopIndex, currentStopIndex, etaMinutes } = data;
                  console.log("[WEBVIEW] STOP_PROGRESSION:", busId, "next:", nextStopIndex);
                  
                  // Initialize next stop markers tracking
                  if (!window.__nextStopMarkers) window.__nextStopMarkers = {};
                  
                  // Remove previous highlight for this bus
                  const prevHighlight = window.__nextStopMarkers[busId];
                  if (prevHighlight && window.__busStopMarkers[prevHighlight]) {
                    const marker = window.__busStopMarkers[prevHighlight];
                    marker.setIcon(createStopIcon(marker.__stopName || 'Stop'));
                    console.log("[WEBVIEW] Removed previous highlight for", busId);
                  }
                  
                  // Highlight new next stop
                  if (nextStopIndex >= 0 && window.__busStops && window.__busStops[nextStopIndex]) {
                    const stop = window.__busStops[nextStopIndex];
                    const stopId = stop.id;
                    
                    if (window.__busStopMarkers[stopId]) {
                      const marker = window.__busStopMarkers[stopId];
                      marker.setIcon(createHighlightedStopIcon(marker.__stopName || 'Stop', etaMinutes));
                      window.__nextStopMarkers[busId] = stopId;
                      console.log("[WEBVIEW] Highlighted next stop:", stopId, "for bus:", busId);
                    }
                  }
                  break;
                }

                case "FOCUS_STOP": {
                  const stop = data.stop;
                  const userLocation = data.userLocation;
                  console.log("[WebView] FOCUS_STOP:", stop?.name);

                  if (!stop || !window.map) return;

                  const lat = Number(stop.latitude);
                  const lng = Number(stop.longitude);

                  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

                  // Fly to stop location
                  window.map.flyTo([lat, lng], 18, {
                    duration: 1.2,
                  });

                  // Draw route and update popup if user location available
                  if (userLocation && userLocation.latitude && userLocation.longitude) {
                    const userLat = Number(userLocation.latitude);
                    const userLng = Number(userLocation.longitude);
                    
                    if (Number.isFinite(userLat) && Number.isFinite(userLng)) {
                      drawRouteToStop(userLat, userLng, lat, lng).then(function(result) {
                        if (result && window.__busStopMarkers[stop.id]) {
                          const marker = window.__busStopMarkers[stop.id];
                          const stopName = marker.__stopName || stop.name || 'Bus Stop';
                          
                          // Update popup content with distance and ETA
                          const popupContent = 
                            '<div style="font-size:14px;">' +
                              '<strong>' + stopName + '</strong><br/>' +
                              '<span style="color:#007AFF;">📍 ' + result.distanceKm + ' km away</span><br/>' +
                              '<span style="color:#16a34a;">🚶 ' + result.etaMin + ' min walk</span>' +
                            '</div>';
                          
                          marker.setPopupContent(popupContent);
                          marker.openPopup();
                          console.log("[WEBVIEW] FOCUS_STOP: route drawn, popup updated");
                        }
                      });
                    }
                  } else {
                    // Just open popup without route if no user location
                    if (window.__busStopMarkers[stop.id]) {
                      window.__busStopMarkers[stop.id].openPopup();
                    }
                  }

                  break;
                }

                case "TOGGLE_NEAREST_ROUTE":
                  window.__showNearestRoute = data.enabled;
                  console.log("[WEBVIEW] Toggle:", window.__showNearestRoute);
                  console.log("[WEBVIEW] Stops:", window.__busStops?.length);
                  console.log("[WEBVIEW] Last location:", window.__lastUserLocation);
                  
                  if (!data.enabled) {
                    // Remove highlight when toggled off
                    removeHighlight();
                    // Reset popup to default (no ETA/distance)
                    if (window.__nearestStopMarker) {
                      const marker = window.__nearestStopMarker;
                      const stopName = marker.__stopName || 'Bus Stop';
                      marker.setPopupContent('<b>' + stopName + '</b>');
                    }
                    if (window.__nearestRouteLayer) {
                      window.map.removeLayer(window.__nearestRouteLayer);
                      window.__nearestRouteLayer = null;
                    }
                  } else {
                    // Highlight nearest stop when toggled on
                    if (window.__lastUserLocation) {
                      highlightNearestStop(
                        window.__lastUserLocation.lat,
                        window.__lastUserLocation.lng,
                        true
                      );
                      updateNearestRoute(
                        window.__lastUserLocation.lat,
                        window.__lastUserLocation.lng
                      );
                      // Open popup for nearest stop
                      if (window.__nearestStopMarker) {
                        window.__nearestStopMarker.openPopup();
                      }
                    }
                  }
                  break;

                case "FOCUS_NEAREST_STOP":
                  // Open popup and center map on nearest stop
                  if (!window.__nearestStopMarker) {
                    console.log("[WEBVIEW] FOCUS_NEAREST_STOP: no nearest marker");
                    break;
                  }
                  
                  const nearestMarker = window.__nearestStopMarker;
                  
                  // Get marker position
                  const markerPos = nearestMarker.getLatLng();
                  if (!markerPos) {
                    console.log("[WEBVIEW] FOCUS_NEAREST_STOP: invalid marker position");
                    break;
                  }
                  
                  // Update popup with latest distance/ETA before opening
                  if (window.__lastUserLocation) {
                    console.log("[WEBVIEW] FOCUS_NEAREST_STOP: updating popup before open");
                    updateNearestStopPopup(window.__lastUserLocation.lat, window.__lastUserLocation.lng);
                  }
                  
                  // Fly to marker, then open popup after animation completes
                  window.map.once("moveend", function() {
                    // Guards before opening popup
                    if (!nearestMarker) {
                      console.log("[WEBVIEW] FOCUS_NEAREST_STOP: marker lost during fly");
                      return;
                    }
                    if (!nearestMarker.getPopup()) {
                      console.log("[WEBVIEW] FOCUS_NEAREST_STOP: marker has no popup");
                      return;
                    }
                    if (!window.map.hasLayer(nearestMarker)) {
                      console.log("[WEBVIEW] FOCUS_NEAREST_STOP: marker not on map");
                      return;
                    }
                    
                    nearestMarker.openPopup();
                    console.log("[WEBVIEW] FOCUS_NEAREST_STOP: popup opened after flyTo");
                  });
                  
                  window.map.flyTo(markerPos, 16, {
                    duration: 1.5,
                    easeLinearity: 0.25
                  });
                  
                  console.log("[WEBVIEW] FOCUS_NEAREST_STOP: flying to nearest stop");
                  break;

                case "FOLLOW_UPDATE":
                  const prevBusId = window.__followBusId;
                  const newBusId = data.followBusId || null;
                  
                  // Hide previous badge only if ID actually changed
                  if (prevBusId && prevBusId !== newBusId) {
                    hideSpeedBadge(prevBusId);
                  }
                  
                  // Update state only if changed
                  if (prevBusId !== newBusId) {
                    window.__followBusId = newBusId;
                    console.log("[WEBVIEW] FOLLOW_UPDATE:", window.__followBusId);
                  }
                  
                  // ALWAYS enforce UI state (handles reloads, late markers, lost refs)
                  if (!newBusId) {
                    resetSpeedometer();
                  } else {
                    showSpeedBadge(newBusId);
                  }
                  break;

                case "BUS_OFFLINE":
                  // Remove marker for offline bus
                  if (data.busId && window.busMarkers[data.busId]) {
                    const marker = window.busMarkers[data.busId];
                    window.map.removeLayer(marker);
                    delete window.busMarkers[data.busId];
                    console.log("[WEBVIEW] Removed marker for offline bus:", data.busId);
                  }
                  // Clear next stop highlight for offline bus
                  if (data.busId && window.__nextStopMarkers?.[data.busId]) {
                    const prevStopId = window.__nextStopMarkers[data.busId];
                    if (window.__busStopMarkers[prevStopId]) {
                      const marker = window.__busStopMarkers[prevStopId];
                      marker.setIcon(createStopIcon(marker.__stopName || 'Stop'));
                      console.log("[WEBVIEW] Removed next stop highlight for offline bus:", data.busId);
                    }
                    delete window.__nextStopMarkers[data.busId];
                  }
                  // Clear follow ONLY if this bus was being followed
                  if (window.__followBusId === data.busId) {
                    window.__followBusId = null;
                    resetSpeedometer();
                    console.log("[WEBVIEW] Cleared follow for offline bus:", data.busId);
                  }
                  break;

                case "SOS_TRIGGERED":
                  // Emergency: remove bus marker, add SOS marker
                  if (!data.busId) {
                    console.log("[WEBVIEW] SOS_TRIGGERED: missing busId");
                    return;
                  }
                  const sosBusId = data.busId;
                  const sosLat = data.lat;
                  const sosLng = data.lng;
                  
                  // Remove bus marker if exists
                  if (window.busMarkers && window.busMarkers[sosBusId]) {
                    window.map.removeLayer(window.busMarkers[sosBusId]);
                    delete window.busMarkers[sosBusId];
                    console.log("[WEBVIEW] SOS_TRIGGERED: bus marker removed", sosBusId);
                  }
                  
                  // Clear follow if this bus was being followed
                  if (window.__followBusId === sosBusId) {
                    window.__followBusId = null;
                    resetSpeedometer();
                    console.log("[WEBVIEW] SOS_TRIGGERED: cleared follow", sosBusId);
                  }
                  
                  // Add SOS marker at location
                  if (sosLat != null && sosLng != null) {
                    if (!window.sosMarkers) window.sosMarkers = {};
                    if (!window.__ackLock) window.__ackLock = {};
                    
                    // Remove existing SOS marker for this bus if any
                    if (window.sosMarkers[sosBusId]) {
                      window.map.removeLayer(window.sosMarkers[sosBusId]);
                    }
                    
                    const sosMarker = L.marker([sosLat, sosLng], { 
                      icon: sosIcon,
                      zIndexOffset: 2000
                    }).addTo(window.map);
                    
                    // Create popup content with ACK button
                    const popupContent = \`
                      <div style="text-align: center; min-width: 150px;">
                        <div style="color: #dc2626; font-weight: bold; margin-bottom: 8px;">
                          🚨 SOS EMERGENCY
                        </div>
                        <div style="font-size: 14px; margin-bottom: 12px;">
                          Bus \${sosBusId}
                        </div>
                        <button id="ack-btn-\${sosBusId}" onclick="acknowledgeSos('\${sosBusId}')" 
                          style="background: #007AFF; color: white; border: none; padding: 8px 16px; 
                                 border-radius: 6px; cursor: pointer; font-size: 14px;">
                          ACKNOWLEDGE
                        </button>
                      </div>
                    \`;
                    
                    sosMarker.bindPopup(popupContent, { autoClose: false });
                    sosMarker.__sosBusId = sosBusId;
                    sosMarker.__acknowledged = false;
                    window.sosMarkers[sosBusId] = sosMarker;
                    
                    // Open popup immediately
                    sosMarker.openPopup();
                    console.log("[WEBVIEW] SOS_TRIGGERED: marker added", sosBusId);
                  }
                  break;

                case "SOS_ACKNOWLEDGED":
                  // Update popup to show acknowledged state
                  if (!data.busId) {
                    console.log("[WEBVIEW] SOS_ACKNOWLEDGED: missing busId");
                    return;
                  }
                  const ackBusId = data.busId;
                  
                  if (window.sosMarkers && window.sosMarkers[ackBusId]) {
                    const marker = window.sosMarkers[ackBusId];
                    marker.__acknowledged = true;
                    
                    // Update popup content
                    const acknowledgedContent = \`
                      <div style="text-align: center; min-width: 150px;">
                        <div style="color: #16a34a; font-weight: bold; margin-bottom: 8px;">
                          ✅ ACKNOWLEDGED
                        </div>
                        <div style="font-size: 14px; margin-bottom: 8px;">
                          Bus \${ackBusId}
                        </div>
                        <div style="font-size: 12px; color: #666;">
                          Emergency is being handled
                        </div>
                      </div>
                    \`;
                    
                    marker.setPopupContent(acknowledgedContent);
                    console.log("[WEBVIEW] SOS_ACKNOWLEDGED: popup updated", ackBusId);
                  } else {
                    console.log("[WEBVIEW] SOS_ACKNOWLEDGED: no marker found", ackBusId);
                  }
                  break;

                case "ACK_FAILED":
                  // Re-enable ACK button on failure
                  if (!data.busId) return;
                  const failedBusId = data.busId;
                  
                  // Clear lock to allow retry
                  if (window.__ackLock) {
                    delete window.__ackLock[failedBusId];
                  }
                  
                  // Update button if popup is open
                  const btn = document.getElementById(\`ack-btn-\${failedBusId}\`);
                  if (btn) {
                    btn.disabled = false;
                    btn.textContent = "ACKNOWLEDGE";
                    btn.style.background = "#007AFF";
                  }
                  console.log("[WEBVIEW] ACK_FAILED: button re-enabled", failedBusId);
                  break;

                case "SOS_CLEARED":
                  // Remove SOS marker
                  if (!data.busId) {
                    console.log("[WEBVIEW] SOS_CLEARED: missing busId");
                    return;
                  }
                  const clearBusId = data.busId;
                  
                  if (window.sosMarkers && window.sosMarkers[clearBusId]) {
                    window.map.removeLayer(window.sosMarkers[clearBusId]);
                    delete window.sosMarkers[clearBusId];
                    console.log("[WEBVIEW] SOS_CLEARED: marker removed", clearBusId);
                  } else {
                    console.log("[WEBVIEW] SOS_CLEARED: no marker found", clearBusId);
                  }
                  break;

                case "RECENTER":
                  recenterToUser();
                  break;
              }
            }

            // 9) ATTACH LISTENER (ONCE)
            if (!window.__BUS_LISTENER__) {
              window.__BUS_LISTENER__ = true;
              document.addEventListener("message", handleMessage);
              window.addEventListener("message", handleMessage);
            }

            // 10) USER INTERACTION GUARD (pauses follow during drag, doesn't stop it)
            window.__isUserInteracting = false;
            window.map.on("dragstart", () => {
              window.__isUserInteracting = true;
            });
            window.map.on("dragend", () => {
              setTimeout(() => {
                window.__isUserInteracting = false;
              }, 2000);
            });

            // 11) MAP READY
            window.__MAP_READY_SENT__ = false;
            function sendMapReady() {
              if (window.__MAP_READY_SENT__) return;
              if (!window.ReactNativeWebView) return;
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: "MAP_READY" }));
              window.__MAP_READY_SENT__ = true;
              console.log("[WEBVIEW] MAP_READY sent");
            }
            window.map.whenReady(function() {
              console.log("[WEBVIEW] Map is ready");
              // Initial render only
              if (window.__busStops && window.__busStops.length > 0) {
                console.log("[WEBVIEW] Calling renderBusStops after map ready");
                if (window.renderBusStops) window.renderBusStops();
              }
              
              sendMapReady();
              
              // Re-apply route highlight after map is ready
              if (window.__activeRouteStopId) {
                setTimeout(function() {
                  if (window.__busStopMarkers[window.__activeRouteStopId]) {
                    const marker = window.__busStopMarkers[window.__activeRouteStopId];
                    const stopName = marker.__stopName || 'Stop';
                    marker.setIcon(createHighlightedStopIcon(stopName));
                    window.__highlightedStopId = window.__activeRouteStopId;
                    console.log("[WEBVIEW] MAP_READY: re-applied route highlight for", window.__activeRouteStopId);
                  }
                }, 400); // After sendMapReady and renderBusStops
              }
            });
            setTimeout(() => { if (!window.__MAP_READY_SENT__) sendMapReady(); }, 1000);

            console.log("[WEBVIEW] Init complete");
          });
        </script>
      </body>
      </html>
    `,
    [center.latitude, center.longitude, userLocation]
  );

  // isRecentering state for recenter button
  const [isRecentering, setIsRecentering] = useState(false);
  const [selectedBusId, setSelectedBusId] = useState(null);

  const handleRecenter = () => {
    if (!webViewRef.current) return;
    setIsRecentering(true);
    webViewRef.current.postMessage(JSON.stringify({ type: "RECENTER" }));
    setTimeout(() => setIsRecentering(false), 800);
  };

  const handleToggleFollow = () => {
    if (!selectedBusId) return;
    // Toggle: if already following this bus, stop; otherwise start following
    const newFollowId = followBusId === selectedBusId ? null : selectedBusId;
    setFollowBusId(newFollowId);
  };

  const handleCloseSelection = () => {
    setSelectedBusId(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: mapHTML }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mixedContentMode="always"
        onMessage={handleWebViewMessage}
        style={{ flex: 1 }}
      />
      {/* Bottom Action Bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={handleRecenter}
          activeOpacity={0.8}
        >
          <Text style={styles.recenterIcon}>⌖</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.routeButton}
          onPress={() => {
            setShowNearestRoute(prev => {
              const newValue = !prev;
              console.log("[RN] Toggle:", newValue);
              return newValue;
            });
          }}
        >
          <Text style={styles.routeButtonText}>
            {showNearestRoute ? 'Hide Route' : 'Show Route'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  actionBar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  recenterButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  recenterButtonActive: {
    backgroundColor: '#e0e0e0',
  },
  recenterIcon: {
    fontSize: 20,
  },
  routeButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  routeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  selectionPanel: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  closeIcon: {
    fontSize: 18,
    color: '#666',
  },
  followButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  followButtonActive: {
    backgroundColor: '#FF3B30',
  },
  followButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
