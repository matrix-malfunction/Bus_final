import { useMemo, useEffect, useRef, useState } from "react";
import { StyleSheet, View, TouchableOpacity, Text, DeviceEventEmitter } from "react-native";
import { WebView } from "react-native-webview";
import { useNavigation } from "@react-navigation/native";
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
  const navigation = useNavigation();
  const webViewRef = useRef(null);
  const lastUserLocationRef = useRef(null); // Cache for resend on WebView load
  const busStopsRef = useRef(null); // Cache bus stops for resend
  const lastDrawnRouteRef = useRef(null); // Track last drawn route to prevent redraw spam
  const lastFittedRouteRef = useRef(null); // Track last fitted route to prevent camera spam
  const pendingSelectedStopRef = useRef(null); // Deferred SELECT_STOP pending bridge ready
  const webViewReadyRef = useRef(false); // Stable ref for immediate-send checks
  const [webViewReady, setWebViewReady] = useState(false);
  const [showNearestRoute, setShowNearestRoute] = useState(false);

  // Default center (Chennai) - prevents crash when no route params
  const DEFAULT_CENTER = { latitude: 13.0827, longitude: 80.2707 };
  const { buses: contextBuses, socket, followBusId, setFollowBusId, setUserLocation, busStops, busProgress, userLocation, selectedStopRoute, setSelectedStopRoute, stopArrivalsMap } = useBus();

  // Sync webViewReadyRef with state for stable checks in effects
  useEffect(() => {
    webViewReadyRef.current = webViewReady;
    console.log("[RN FullMap] webViewReadyRef synced:", webViewReady);
  }, [webViewReady]);
  const { buses: routeBuses, userLocation: routeUserLocation, center: routeCenter, focusStop, highlightedStop } = route?.params || {};

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
        
        // Progression fields already in bus from BUS_LOCATION_UPDATE:
        // currentStopName, nextStopName, nextStopEtaMinutes, routeProgressIndex
        // Preserve them in the spread above, ensure they are not undefined
        const busWithProgression = {
          ...bus,
          latitude,
          longitude,
          lat: latitude,
          lng: longitude,
          busId: bus.busId || bus._id,
          // Ensure progression fields are explicitly set (not lost)
          currentStopName: bus.currentStopName || null,
          nextStopName: bus.nextStopName || null,
          nextStopEtaMinutes: bus.nextStopEtaMinutes ?? null,
          routeProgressIndex: bus.routeProgressIndex ?? null,
          routeId: bus.routeId || null,
          routeName: bus.routeName || null,
          direction: bus.direction || null
        };

        return busWithProgression;
      })
      .filter(Boolean);
  }, [routeBuses, contextBuses, busProgress]);

  const center =
    routeCenter &&
    Number.isFinite(Number(routeCenter.latitude)) &&
    Number.isFinite(Number(routeCenter.longitude))
      ? routeCenter
      : DEFAULT_CENTER;
  const routeUserLocationValue =
    routeUserLocation &&
    Number.isFinite(Number(routeUserLocation.latitude)) &&
    Number.isFinite(Number(routeUserLocation.longitude))
      ? routeUserLocation
      : null;

  // Handle MAP_READY from WebView - idempotent, always resend USER_LOCATION
  const handleWebViewMessage = (event) => {
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
            lat: lastUserLocationRef.current.lat,
            lng: lastUserLocationRef.current.lng
          }));
          console.log("[RN] USER_LOCATION resent on MAP_READY");
        }

        // ALWAYS resend BUS_UPDATE on MAP_READY (recovery mechanism)
        // Send BEFORE FOLLOW_UPDATE so markers exist
        setTimeout(() => {
          if (!webViewRef.current) return;

          // FILTER: only active buses
          const latestBuses = Object.values(contextBuses || {})
            .filter((bus) => bus?.trackingActive !== false)
            .map(bus => ({
              ...bus,
              progression: busProgress?.[bus.busId] || null,
            }));
          console.log("[FullMap RN] Sending BUS_UPDATE after MAP_READY:", latestBuses.length, "buses");
          console.log("[FULLMAP POSTMESSAGE]", latestBuses.map(b => ({
            busId: b.busId,
            currentStopName: b.currentStopName,
            nextStopName: b.nextStopName,
            nextStopEtaMinutes: b.nextStopEtaMinutes,
            direction: b.direction,
            derivedSpeed: b.derivedSpeed,
            speed: b.speed,
          })));

          webViewRef.current.postMessage(
            JSON.stringify({
              type: "BUS_UPDATE",
              buses: latestBuses
            })
          );

          // FOLLOW_UPDATE sent AFTER BUS_UPDATE so marker registry is ready
          setTimeout(() => {
            if (!webViewRef.current) return;

            console.log("[FullMap RN] Sending FOLLOW_UPDATE after MAP_READY:", followBusId);
            webViewRef.current.postMessage(JSON.stringify({
              type: "FOLLOW_UPDATE",
              payload: followBusId
            }));
          }, 50);
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
        const { busId, follow } = data;

        console.log(
          "[FullMap] SET_FOLLOW:",
          busId,
          follow
        );

        const nextFollowBusId =
          follow ? busId : null;

        // Prevent duplicate follow updates
        if (followBusId === nextFollowBusId) {
          console.log(
            "[FOLLOW] Ignored duplicate follow state",
            nextFollowBusId
          );

          return;
        }

        setFollowBusId(nextFollowBusId);
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
  };

  // Reactive user location sync (live from BusContext)
  // Flat schema: { type: "USER_LOCATION", lat, lng }
  useEffect(() => {
    if (
      !webViewReady ||
      !webViewRef.current ||
      !userLocation
    ) {
      return;
    }

    const lat = Number(userLocation.latitude);
    const lng = Number(userLocation.longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return;
    }

    lastUserLocationRef.current = { lat, lng };

    console.log("[FullMap] Context userLocation:", lat, lng);
    console.log("[RN FullMap] Sending USER_LOCATION", lat, lng);

    webViewRef.current.postMessage(JSON.stringify({
      type: "USER_LOCATION",
      lat,
      lng
    }));
  }, [
    userLocation?.latitude,
    userLocation?.longitude,
    webViewReady
  ]);

  // Send BUS_UPDATE to WebView whenever buses change
  // ONLY send when WebView is ready to prevent lost messages
  // FILTER: only active buses (trackingActive !== false)
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;

    const activeBuses = (buses || []).filter(
      (bus) => bus?.trackingActive !== false
    );

    console.log("[FullMap RN] Sending BUS_UPDATE:", activeBuses.length, "buses");
    console.log("[FULLMAP POSTMESSAGE]", activeBuses.map(b => ({
      busId: b.busId,
      currentStopName: b.currentStopName,
      nextStopName: b.nextStopName,
      nextStopEtaMinutes: b.nextStopEtaMinutes,
      direction: b.direction,
      derivedSpeed: b.derivedSpeed,
      speed: b.speed,
    })));
    webViewRef.current.postMessage(
      JSON.stringify({
        type: "BUS_UPDATE",
        buses: activeBuses
      })
    );
  }, [buses, webViewReady]);

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
            tripId: progress.tripId, // For route switch detection
            nextStopIndex: progress.nextStopIndex,
            currentStopIndex: progress.currentStopIndex,
            passedStopIds: progress.passedStopIds || [],
            etaMinutes: progress.etaMinutes,
          })
        );
        console.log("[FullMap RN] STOP_PROGRESSION sent for", busId, "next stop:", progress.nextStopIndex, "passed:", progress.passedStopIds?.length || 0);
      }
    });
  }, [busProgress, webViewReady]);

  // ACTIVE ROUTE CORRIDOR: Draw route for followed/selected bus only
  // Uses backend-provided routeCoords (no HTTP fetch)
  useEffect(() => {
    // Determine active bus from follow or selection
    const activeBusId = followBusId || selectedBusId;
    const activeBus = buses.find(b => b.busId === activeBusId || b.id === activeBusId);
    
    // Guard 1: No active bus - clear route and exit
    if (!activeBusId || !activeBus || !webViewRef.current || !webViewReady) {
      if (lastDrawnRouteRef.current) {
        webViewRef.current?.postMessage(JSON.stringify({ type: "CLEAR_ROUTE" }));
        lastDrawnRouteRef.current = null;
      }
      return;
    }
    
    const activeRouteId = activeBus.routeId;
    const routeCoords = activeBus.routeCoords;
    
    // Guard 2: No route assigned to this bus
    if (!activeRouteId || !routeCoords || !Array.isArray(routeCoords)) {
      if (lastDrawnRouteRef.current) {
        webViewRef.current?.postMessage(JSON.stringify({ type: "CLEAR_ROUTE" }));
        lastDrawnRouteRef.current = null;
      }
      return;
    }
    
    // Guard 3: Skip if same bus+route already drawn (prevents redraw spam)
    const routeKey = `${activeBusId}:${activeRouteId}`;
    if (lastDrawnRouteRef.current === routeKey) {
      console.log("[Route Corridor] Skip - already drawn:", routeKey);
      return;
    }
    
    // Send DRAW_ROUTE to WebView with backend-provided coordinates
    webViewRef.current.postMessage(JSON.stringify({
      type: "DRAW_ROUTE",
      busId: activeBusId,
      routeId: activeRouteId,
      routeColor: activeBus.routeColor || "#2563eb",
      coordinates: routeCoords,
    }));
    
    // Mark as drawn (track by busId:routeId combo)
    lastDrawnRouteRef.current = routeKey;
    console.log("[Route Corridor] Drew route:", routeKey, "with", routeCoords.length, "points");
    
    // FIT_ROUTE: Auto-frame route corridor once (skip in follow mode)
    const fitKey = `${activeBusId}_${activeRouteId}`;
    if (!followBusId && lastFittedRouteRef.current !== fitKey) {
      console.log("[Route Corridor] Fitting route bounds:", fitKey);
      webViewRef.current.postMessage(JSON.stringify({
        type: "FIT_ROUTE",
        coordinates: routeCoords
      }));
      lastFittedRouteRef.current = fitKey;
    } else if (followBusId) {
      console.log("[Route Corridor] Skip fit - follow mode active for:", followBusId);
    } else {
      console.log("[Route Corridor] Skip fit - already fitted:", fitKey);
    }
    
    // Cleanup: clear route when effect re-runs with different bus/route
    return () => {
      // Route will be cleared by next effect run or component unmount
    };
  }, [followBusId, selectedBusId, buses]); // Dependencies: only bus selection/follow changes

  // Send STOP_PROGRESS_UPDATE to WebView when bus stop progression changes
  // Backend-driven route stop visualization (passed, current, next)
  useEffect(() => {
    if (!webViewRef.current || !webViewReady) return;
    if (!buses || buses.length === 0) return;
    
    // Find buses with progression data
    buses.forEach(bus => {
      if (bus.currentStopId || bus.nextStopId || (bus.passedStopIds && bus.passedStopIds.length > 0)) {
        // Create hash to prevent spam
        const progressHash = `${bus.busId}:${bus.currentStopId}:${bus.nextStopId}:${(bus.passedStopIds || []).join(',')}`;
        const lastHash = window.__lastProgressHash?.[bus.busId];
        
        if (lastHash === progressHash) return;
        
        // Store hash globally
        if (!window.__lastProgressHash) window.__lastProgressHash = {};
        window.__lastProgressHash[bus.busId] = progressHash;
        
        console.log("[RN FullMap] Sending STOP_PROGRESS_UPDATE:", bus.busId, {
          passed: bus.passedStopIds?.length || 0,
          current: bus.currentStopId,
          next: bus.nextStopId
        });
        
        webViewRef.current.postMessage(
          JSON.stringify({
            type: "STOP_PROGRESS_UPDATE",
            busId: bus.busId,
            passedStopIds: bus.passedStopIds || [],
            currentStopId: bus.currentStopId,
            nextStopId: bus.nextStopId,
            routeProgressIndex: bus.routeProgressIndex
          })
        );
      }
    });
  }, [buses, webViewReady]);

  // Send FOCUS_STOP to WebView when navigating from nearest stops
  useEffect(() => {
    if (!focusStop || !webViewRef.current) return;

    console.log("[RN FullMap] Focusing stop:", focusStop.name);

    webViewRef.current.postMessage(
      JSON.stringify({
        type: "FOCUS_STOP",
        stop: focusStop,
        userLocation: routeUserLocationValue,
      })
    );
  }, [focusStop, routeUserLocationValue]);

  // Send HIGHLIGHT_STOP to WebView when navigating from HomeScreen nearest stops
  useEffect(() => {
    if (!highlightedStop || !webViewRef.current) return;

    console.log("[RN FullMap] Highlighting stop:", highlightedStop.name);

    webViewRef.current.postMessage(
      JSON.stringify({
        type: "HIGHLIGHT_STOP",
        stop: highlightedStop
      })
    );
  }, [highlightedStop]);

  // One-time DRAW_STOP_ROUTE: draw temporary route from user to selected stop
  useEffect(() => {
    console.log(
      "[RN FullMap] selectedStopRoute state:",
      selectedStopRoute
    );

    console.log(
      "[RN FullMap] DRAW_STOP_ROUTE effect triggered",
      {
        selectedStopRoute,
        userLocation,
        webViewReady
      }
    );

    // HARD GUARDS
    if (
      !selectedStopRoute ||
      !webViewReady ||
      !webViewRef.current ||
      !userLocation
    ) {
      console.log(
        "[RN FullMap] DRAW_STOP_ROUTE blocked",
        {
          hasStop: !!selectedStopRoute,
          hasUserLocation: !!userLocation,
          webViewReady
        }
      );

      return;
    }

    // NORMALIZE stop coordinates
    const stopLatitude =
      selectedStopRoute.latitude ??
      selectedStopRoute.lat;

    const stopLongitude =
      selectedStopRoute.longitude ??
      selectedStopRoute.lng;

    // VALIDATE coordinates
    if (
      typeof stopLatitude !== "number" ||
      typeof stopLongitude !== "number"
    ) {
      console.log(
        "[RN FullMap] Invalid stop coordinates"
      );

      return;
    }

    const payload = {
      type: "DRAW_STOP_ROUTE",

      payload: {
        stop: {
          ...selectedStopRoute,

          latitude: stopLatitude,
          longitude: stopLongitude,
        },

        userLocation: {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        }
      }
    };

    console.log(
      "[RN FullMap] Sending DRAW_STOP_ROUTE",
      payload
    );

    webViewRef.current.postMessage(
      JSON.stringify(payload)
    );

    console.log(
      "[RN FullMap] DRAW_STOP_ROUTE sent successfully"
    );

    // CLEAR ONLY AFTER SUCCESSFUL SEND
    setSelectedStopRoute(null);

  }, [
    selectedStopRoute,
    userLocation,
    webViewReady
  ]);

  // Send stop arrivals map to WebView on change
  useEffect(() => {
    if (!webViewReady || !webViewRef.current || !stopArrivalsMap) return;
    console.log("[FULLMAP STOP ARRIVALS]", Object.keys(stopArrivalsMap).length);
    webViewRef.current.postMessage(JSON.stringify({
      type: "STOP_ARRIVALS_UPDATE",
      stopArrivalsMap
    }));
  }, [stopArrivalsMap, webViewReady]);

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
      const reason = data?.reason || "unknown";
      console.log("[FullMap RN] BUS_OFFLINE:", busId, "reason:", reason);

      if (webViewRef.current && webViewReady) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "BUS_OFFLINE",
          busId: busId,
          reason: reason,
          timestamp: data?.timestamp
        }));
      }

      // Clear follow ONLY if this bus was being followed
      if (followBusId === busId) {
        console.log("[FullMap RN] Clearing follow for offline bus:", busId);
        setFollowBusId(null);
      }

      // Clear selection ONLY if this bus was selected
      if (selectedBusId === busId) {
        console.log("[FullMap RN] Clearing selection for offline bus:", busId);
        setSelectedBusId(null);
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
          .bus-popup-direction {
            color: #666;
            font-size: 11px;
          }
          .heading-arrow {
            color: #999;
            font-size: 11px;
            margin-left: 4px;
          }
          .tracking-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 500;
          }
          .tracking-badge-active {
            background: #10B981;
            color: white;
          }
          .tracking-badge-paused {
            background: #999;
            color: white;
          }
          .bus-popup-current-stop {
            color: #007AFF;
            font-weight: 500;
          }
          .bus-popup-next-stop {
            color: #10B981;
            font-weight: 500;
          }
          .bus-popup-section {
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid #f0f0f0;
          }
          .bus-popup-section:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
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
          /* Passed stop styling - dimmed */
          .passed-stop .bus-stop-icon {
            background: #e5e7eb;
            border-color: #9ca3af;
            color: #6b7280;
            opacity: 0.4;
            transform: scale(0.9);
          }
          .passed-stop .bus-stop-label {
            background: #e5e7eb;
            color: #6b7280;
            opacity: 0.5;
            transform: scale(0.9);
          }
          /* Next stop highlight styling - emphasized */
          .highlighted-stop .bus-stop-icon {
            background: #f59e0b;
            border-color: #d97706;
            color: white;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
            transform: scale(1.15);
          }
          .highlighted-stop .bus-stop-label {
            background: #f59e0b;
            color: white;
            font-weight: 600;
            transform: scale(1.1);
          }
          .stop-eta {
            background: #10b981;
            color: white;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 9px;
            font-weight: 600;
            margin-top: 2px;
            white-space: nowrap;
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
          /* Route corridor styling - reduced visual dominance */
          .route-corridor {
            color: #007AFF;
            weight: 5;
            opacity: 0.35;
          }
          .bus-marker {
            position: relative;
            width: 48px;
            height: 60px;
            pointer-events: none;
            transform-origin: center center;
            transition: transform 0.3s ease;
          }
          
          /* Scale wrapper for followed bus (separate from heading rotation) */
          .bus-marker__scale-wrapper {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            transform-origin: center center;
            transition: transform 0.3s ease;
            z-index: 2;
          }
          
          /* Glow effect for followed bus */
          .bus-marker__glow {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 70px;
            height: 70px;
            transform: translate(-50%, -50%);
            background: radial-gradient(circle, rgba(0,122,255,0.6) 0%, transparent 70%);
            border-radius: 50%;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 1;
          }
          
          /* Pulse animation for followed bus */
          .bus-marker__pulse {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 60px;
            height: 60px;
            transform: translate(-50%, -50%);
            border: 2px solid rgba(0,122,255,0.8);
            border-radius: 50%;
            z-index: 0;
            display: none;
            animation: pulse-ring 2s ease-out infinite;
          }
          
          @keyframes pulse-ring {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
          }
          
          .bus-marker--followed .bus-marker__scale-wrapper {
            transform: translate(-50%, -50%) scale(1.3);
          }
          
          .bus-marker--followed .bus-marker__glow {
            opacity: 1;
          }
          
          .bus-marker--followed .bus-marker__pulse {
            display: block;
          }

          /* MOVING BUS STATE - speed > 5 km/h */
          .bus-marker--moving .bus-marker__scale-wrapper {
            transform: translate(-50%, -50%) scale(1.05);
          }
          .bus-marker--moving .bus-marker__direction {
            opacity: 1;
            filter: brightness(1.2);
          }
          .bus-marker--moving .bus-marker__pulse {
            animation-duration: 1.5s;
            border-color: rgba(0,122,255,0.9);
          }

          /* STOPPED BUS STATE - speed <= 5 km/h */
          .bus-marker--stopped {
            opacity: 0.8;
          }
          .bus-marker--stopped .bus-marker__pulse {
            animation-duration: 3s;
            border-color: rgba(0,122,255,0.4);
          }
          .bus-marker--stopped .bus-marker__body {
            filter: grayscale(0.2);
          }

          /* ARRIVING BUS STATE - remainingDistanceKm < 0.2 */
          .bus-marker--arriving .bus-marker__scale-wrapper {
            transform: translate(-50%, -50%) scale(1.15);
          }
          .bus-marker--arriving .bus-marker__pulse {
            animation-duration: 1s;
            border-color: rgba(16,185,129,0.9);
            border-width: 3px;
          }
          .bus-marker--arriving .bus-marker__glow {
            background: radial-gradient(circle, rgba(16,185,129,0.5) 0%, transparent 70%);
          }

          /* SOS BUS STATE - emergency */
          .bus-marker--sos .bus-marker__scale-wrapper {
            transform: translate(-50%, -50%) scale(1.2);
          }
          .bus-marker--sos .bus-marker__pulse {
            display: block;
            animation-duration: 0.8s;
            border-color: rgba(220,38,38,0.9);
            border-width: 3px;
          }
          .bus-marker--sos .bus-marker__glow {
            background: radial-gradient(circle, rgba(220,38,38,0.6) 0%, transparent 70%);
            opacity: 1;
          }

          /* SOS + FOLLOW MERGED STATE - prevent transform conflicts */
          .bus-marker--followed.bus-marker--sos .bus-marker__scale-wrapper {
            transform: translate(-50%, -50%) scale(1.25); /* Controlled combined scale */
          }
          .bus-marker--followed.bus-marker--sos .bus-marker__pulse {
            animation-duration: 0.6s; /* Faster SOS pulse takes precedence */
            border-color: rgba(220,38,38,1);
            border-width: 3px;
          }
          .bus-marker--followed.bus-marker--sos .bus-marker__glow {
            background: radial-gradient(circle, rgba(220,38,38,0.7) 0%, rgba(0,122,255,0.3) 70%, transparent 100%);
            opacity: 1;
          }
          .bus-marker--sos .bus-marker__sos-ring {
            display: block;
            position: absolute;
            top: 50%;
            left: 50%;
            width: 80px;
            height: 80px;
            transform: translate(-50%, -50%);
            border: 3px solid #dc2626;
            border-radius: 50%;
            animation: sos-pulse 1s ease-in-out infinite;
            z-index: 3;
          }
          @keyframes sos-pulse {
            0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.5; }
          }

          /* OFFLINE TRANSITION STATE */
          .bus-marker--offline {
            opacity: 0;
            transform: scale(0.8);
            transition: opacity 0.3s ease, transform 0.3s ease;
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
          
          /* LIVE/STALE freshness states */
          .bus-marker--stale {
            opacity: 0.6;
            filter: grayscale(30%);
          }
          
          .bus-marker--live {
            opacity: 1;
          }
          
          /* Freshness badges in popup */
          .freshness-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 500;
          }
          .freshness-badge-live {
            background: #10B981;
            color: white;
          }
          .freshness-badge-stale {
            background: #F59E0B;
            color: white;
  }
          .freshness-badge-offline {
    background: #EF4444;
    color: white;
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
          // GLOBAL ERROR HANDLER - Catch WebView crashes and report to RN
          window.onerror = function(message, source, lineno, colno, error) {
            console.error("[WEBVIEW ERROR]", message, "at line", lineno, "col", colno);
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "WEBVIEW_ERROR",
                message: message,
                source: source,
                lineno: lineno,
                colno: colno,
                stack: error && error.stack ? error.stack : null
              }));
            }
            return true; // Prevent default error handling
          };
          
          document.addEventListener("DOMContentLoaded", function() {
            console.log("[WEBVIEW] DOMContentLoaded - Initializing...");

            // 1) CREATE MAP FIRST (all default controls disabled)
            const map = L.map('map', {
              zoomControl: false,
              attributionControl: false
            }).setView([${Number(center.latitude)}, ${Number(center.longitude)}], 14);
            window.map = map;

            // Follow button delegated listener (attached once)
            if (!window.__followListenerAttached) {
              window.__followListenerAttached = true;

              document.addEventListener(
                "click",
                function(e) {
                  const btn = e.target.closest(".follow-btn");

                  if (!btn) return;

                  // Ignore synthetic/non-user events
                  if (!e.isTrusted) {
                    console.log(
                      "[FOLLOW] Ignored synthetic click"
                    );
                    return;
                  }

                  // Prevent Leaflet popup bubbling
                  e.preventDefault();
                  e.stopPropagation();

                  const busId = btn.dataset.busid;

                  const follow =
                    btn.dataset.follow === "true";

                  // Prevent rapid duplicate taps
                  const now = Date.now();

                  if (
                    window.__lastFollowClick &&
                    now - window.__lastFollowClick < 500
                  ) {
                    console.log(
                      "[FOLLOW] Ignored rapid duplicate click"
                    );
                    return;
                  }

                  window.__lastFollowClick = now;

                  console.log("[FOLLOW CLICK]", {
                    busId,
                    follow,
                  });

                  window.ReactNativeWebView.postMessage(
                    JSON.stringify({
                      type: "SET_FOLLOW",
                      busId,
                      follow,
                    })
                  );
                },
                true
              );
            }

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
            window.__busAnimations = {}; // RAF animation tracking per bus
            window.activeRouteLine = null; // Single active route polyline
            window.highlightedStopMarker = null; // Single highlighted stop marker

            // 3) PRODUCTION-GRADE BUS MARKER ARCHITECTURE
            // Layered divIcon with DOM mutation-only updates
            // Supports: route color, heading, ETA, follow glow, SOS, offline states
            
            // Build bus marker HTML using string concatenation (no nested template literals)
            function buildBusMarkerHTML(color, shortName) {
              return '<div class="bus-marker" data-bus-id="">' +
                '<div class="bus-marker__pulse"></div>' +
                '<div class="bus-marker__glow"></div>' +
                '<div class="bus-marker__scale-wrapper">' +
                  '<div class="bus-marker__body" style="background: ' + color + ';">' +
                    '<span class="bus-marker__icon">🚌</span>' +
                    '<span class="bus-marker__route">' + shortName + '</span>' +
                  '</div>' +
                  '<div class="bus-marker__direction" style="transform: rotate(0deg);">➤</div>' +
                  '<div class="bus-marker__eta-badge" style="display: none;">' +
                    '<span class="eta-time">--</span>' +
                  '</div>' +
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
            
            // GPS TELEPORT PROTECTION - Skip animation if jump is too large
            const TELEPORT_THRESHOLD_METERS = 200;
            
            function haversineDistance(lat1, lng1, lat2, lng2) {
              const R = 6371000; // Earth radius in meters
              const dLat = (lat2 - lat1) * Math.PI / 180;
              const dLng = (lng2 - lng1) * Math.PI / 180;
              const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                        Math.sin(dLng/2) * Math.sin(dLng/2);
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              return R * c;
            }
            
            // Cancel existing animation for a bus
            function cancelBusAnimation(busId) {
              if (window.__busAnimations[busId]) {
                cancelAnimationFrame(window.__busAnimations[busId].rafId);
                delete window.__busAnimations[busId];
              }
            }
            
            // Smooth marker position animation with teleport protection
            function animateBusMarker(busId, marker, targetLat, targetLng, duration) {
              duration = duration || 800; // Default 800ms for smooth transit feel

              if (!marker || !marker.setLatLng) {
                console.log("[ANIMATE] Invalid marker", busId);
                return;
              }

              const currentLatLng = marker.getLatLng();
              const startLat = currentLatLng.lat;
              const startLng = currentLatLng.lng;
              
              // GPS Teleport Protection: Skip animation if distance is too large
              const distance = haversineDistance(startLat, startLng, targetLat, targetLng);
              if (distance > TELEPORT_THRESHOLD_METERS) {
                marker.setLatLng([targetLat, targetLng]);
                return;
              }
              
              // Cancel any existing animation for this bus
              cancelBusAnimation(busId);
              
              const startTime = performance.now();
              
              function step(currentTime) {
                // Safety guard: stop animation if marker no longer exists (BUS_OFFLINE)
                if (!window.busMarkers[busId]) {
                  cancelBusAnimation(busId);
                  return;
                }

                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Easing function: easeOutCubic for natural deceleration
                const eased = 1 - Math.pow(1 - progress, 3);

                const newLat = startLat + (targetLat - startLat) * eased;
                const newLng = startLng + (targetLng - startLng) * eased;

                marker.setLatLng([newLat, newLng]);
                
                if (progress < 1) {
                  window.__busAnimations[busId] = {
                    rafId: requestAnimationFrame(step),
                    startLat, startLng, targetLat, targetLng
                  };
                } else {
                  delete window.__busAnimations[busId];
                }
              }
              
              window.__busAnimations[busId] = {
                rafId: requestAnimationFrame(step),
                startLat, startLng, targetLat, targetLng
              };
            }
            
            // Update marker position (with smooth animation)
            function updateBusPosition(marker, busId, lat, lng) {
              if (
                !marker ||
                typeof lat !== "number" ||
                typeof lng !== "number" ||
                isNaN(lat) ||
                isNaN(lng)
              ) {
                console.log("[POSITION] Invalid update", { busId, lat, lng });
                return;
              }
              animateBusMarker(busId, marker, lat, lng, 800);
            }
            
            // Update heading direction with smooth rotation
            function updateBusHeading(marker, heading) {
              const els = getMarkerElements(marker);
              if (els && els.direction && heading !== undefined) {
                // Normalize heading to 0-360
                let normalizedHeading = heading % 360;
                if (normalizedHeading < 0) normalizedHeading += 360;
                
                // Get current rotation
                const currentTransform = els.direction.style.transform || '';
                const match = currentTransform.match(/rotate\(([-\d.]+)deg\)/);
                let currentHeading = match ? parseFloat(match[1]) : 0;
                
                // Shortest path rotation (handle 350 -> 10 transition)
                let delta = normalizedHeading - currentHeading;
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
                
                const finalHeading = currentHeading + delta;
                els.direction.style.transform = 'rotate(' + finalHeading + 'deg)';
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
            
            // Calculate freshness state based on timestamp age
            function calculateFreshnessState(timestamp) {
              if (!timestamp) return 'live';
              
              const ageMs = Date.now() - new Date(timestamp).getTime();
              
              if (ageMs < 15000) { // < 15s
                return 'live';
              } else if (ageMs < 45000) { // 15s–45s
                return 'stale';
              } else { // > 45s
                return 'offline';
              }
            }
            
            // Update freshness state (CSS classes)
            function updateBusFreshness(marker, freshnessState) {
              const els = getMarkerElements(marker);
              if (!els || !els.container) return;
              
              // Remove previous freshness classes
              els.container.classList.remove('bus-marker--live', 'bus-marker--stale');
              
              // Apply new freshness class (not for offline, BUS_OFFLINE handles that)
              if (freshnessState === 'live') {
                els.container.classList.add('bus-marker--live');
              } else if (freshnessState === 'stale') {
                els.container.classList.add('bus-marker--stale');
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

            // Track pending offline removal timeouts to prevent race conditions
            window.__offlineTimeouts = window.__offlineTimeouts || {};

            // Helper: Reset bus visual state to prevent conflicting classes
            function resetBusVisualState(markerEl) {
              if (!markerEl) return;
              markerEl.classList.remove('bus-marker--moving');
              markerEl.classList.remove('bus-marker--stopped');
              markerEl.classList.remove('bus-marker--arriving');
              markerEl.classList.remove('bus-marker--sos');
              markerEl.classList.remove('bus-marker--offline');
            }

            // 3a) CREATE POPUP HTML (dynamic follow/unfollow)
            // SPEEDOMETER UPDATE FUNCTION - Backend-authoritative speed only
            function updateSpeedometer(busData) {
              if (!busData) return;
              
              // Use backend-derived speed (stable) with fallback to raw GPS speed
              const displaySpeed = Number.isFinite(busData.derivedSpeed)
                ? Math.round(busData.derivedSpeed)
                : Math.round((busData.speed || 0) * 3.6);
              
              const el = document.getElementById('speedometer');
              if (!el) return;
              
              el.innerHTML = 'Speed: ' + displaySpeed + ' km/h';
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
              const speed = bus.derivedSpeed ?? bus.speed ?? 0;
              const eta = bus.nextStopEtaMinutes;
              const currentStop = bus.currentStopName || "N/A";
              const nextStop = bus.nextStopName || "N/A";
              const direction = bus.direction || "N/A";
              const isFollowing = window.__followBusId === bus.busId;

              // Harden speed display
              const safeSpeed = Number.isFinite(speed) ? Math.max(0, Math.round(speed)) : 0;

              return (
                '<div class="bus-popup" style="min-width:220px;padding:4px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                    '<div style="font-weight:bold;font-size:16px;">' +
                      (bus.busId || "Unknown Bus") +
                    '</div>' +
                    '<div style="background:' + (bus.routeColor || "#2563eb") + ';color:white;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:bold;">' +
                      direction +
                    '</div>' +
                  '</div>' +
                  '<div style="margin-top:4px;">' +
                    '<strong>Speed:</strong> ' + safeSpeed + ' km/h' +
                  '</div>' +
                  '<div style="margin-top:4px;">' +
                    '<strong>Current Stop:</strong> ' + currentStop +
                  '</div>' +
                  '<div style="margin-top:4px;">' +
                    '<strong>Next Stop:</strong> ' + nextStop +
                  '</div>' +
                  '<div style="margin-top:4px;">' +
                    '<strong>ETA:</strong> ' + (eta != null ? eta + ' min' : '-- min') +
                  '</div>' +
                  '<button class="follow-btn" data-busid="' + bus.busId + '" data-follow="' + !isFollowing + '" style="margin-top:10px;width:100%;padding:10px;border:none;border-radius:10px;background:' + (isFollowing ? '#dc2626' : '#2563eb') + ';color:white;font-weight:bold;cursor:pointer;">' +
                    (isFollowing ? 'Stop Following' : 'Follow Bus') +
                  '</button>' +
                '</div>'
              );
            }

            // 3b) ETA CALCULATION - Backend-authoritative speed
            function calculateETA(bus, user) {
              // Use backend-derived speed (stable) with fallback to raw GPS speed
              const speedMps = Number.isFinite(bus.derivedSpeed)
                ? (bus.derivedSpeed / 3.6)  // Convert km/h to m/s
                : bus.speed;
              
              if (!speedMps || speedMps < (5 / 3.6)) return null;
              
              const R = 6371000;
              const dLat = (user.lat - bus.lat) * Math.PI / 180;
              const dLng = (user.lng - bus.lng) * Math.PI / 180;
              const a = Math.sin(dLat/2)**2 + Math.cos(bus.lat * Math.PI/180) * Math.cos(user.lat * Math.PI/180) * Math.sin(dLng/2)**2;
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              const distance = R * c;
              const eta = distance / speedMps;
              return Math.round(eta / 60);
            }

            // 3b) TOGGLE FOLLOW (called from popup) with optimistic UI update
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

              // REMOVE stale markers not in incoming payload
              const incomingIds = new Set(Object.keys(buses || {}));
              Object.keys(markers).forEach(function(busId) {
                if (!incomingIds.has(busId)) {
                  console.log("[WEBVIEW] removing stale bus:", busId);
                  const marker = markers[busId];
                  if (marker && window.map) {
                    try { window.map.removeLayer(marker); } catch (e) {}
                  }
                  delete markers[busId];
                }
              });

              // Add/update markers
              Object.entries(buses).forEach(function(entry) {
                const id = entry[0];
                const bus = entry[1];
                if (!bus?.lat || !bus?.lng) return;

                // Ghost protection: skip inactive buses
                if (bus.trackingActive !== true) {
                  console.log("[WEBVIEW] Skip inactive bus:", id);
                  return;
                }

                const latlng = [bus.lat, bus.lng];

                // Calculate ETA if user location exists
                let eta = null;
                if (window.userLocation) {
                  eta = calculateETA(bus, window.userLocation);
                }

                if (markers[id]) {
                  // UPDATE EXISTING MARKER - DOM mutation only, no recreation
                  const marker = markers[id];

                  // Fix #4: Cancel pending offline timeout if bus comes back online
                  if (window.__offlineTimeouts[id]) {
                    clearTimeout(window.__offlineTimeouts[id]);
                    delete window.__offlineTimeouts[id];
                    console.log("[WEBVIEW] Cancelled offline timeout for revived bus:", id);
                  }
                  
                  // Update marker position with smooth interpolation
                  updateBusPosition(marker, id, bus.lat, bus.lng);

                  // 2. Update heading (direction rotation only, with smoothing)
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
                    if (isFollowing && (bus.derivedSpeed !== undefined || bus.speed !== undefined)) {
                      updateSpeedometer(bus);
                    }
                  }
                  
                  // 7. Update SOS state (if changed)
                  if (bus.sos !== marker.__busData?.sos) {
                    updateBusSOS(marker, bus.sos);
                  }

                  // 8. Apply visual state classes based on bus conditions
                  const els = getMarkerElements(marker);
                  if (els && els.container) {
                    // Fix #4: Remove offline class before applying new states
                    els.container.classList.remove('bus-marker--offline');
                    resetBusVisualState(els.container);

                    // Fix #3: Use backend-derived speed for reliable movement detection
                    const speedKmh = bus.derivedSpeed !== undefined ? bus.derivedSpeed : (bus.speed || 0);
                    const remainingDistance = bus.progression?.remainingDistanceKm || Infinity;
                    const isSos = bus.sos === true;

                    // Priority: SOS > Arriving > Moving > Stopped
                    if (isSos) {
                      els.container.classList.add('bus-marker--sos');
                    } else if (remainingDistance < 0.2) {
                      els.container.classList.add('bus-marker--arriving');
                    } else if (speedKmh > 5) {
                      els.container.classList.add('bus-marker--moving');
                    } else {
                      els.container.classList.add('bus-marker--stopped');
                    }
                    
                    // 8b. Apply freshness state (LIVE/STALE)
                    const freshnessState = calculateFreshnessState(bus.timestamp || bus.lastUpdate);
                    updateBusFreshness(marker, freshnessState);
                    marker.__freshnessState = freshnessState; // Store for popup updates
                  }

                  marker.__busData = {
                    ...marker.__busData,
                    ...bus,
                    id,
                    eta,
                  };

                  console.log("[MARKER UPDATE]", {
                    busId: marker.__busData.busId,
                    currentStopName: marker.__busData.currentStopName,
                    nextStopName: marker.__busData.nextStopName,
                    nextStopEtaMinutes: marker.__busData.nextStopEtaMinutes,
                    derivedSpeed: marker.__busData.derivedSpeed,
                    speed: marker.__busData.speed,
                  });

                  if (marker.isPopupOpen()) {
                    const freshHtml = createPopupHTML(marker.__busData);

                    marker.setPopupContent(freshHtml);

                    console.log(
                      "[POPUP REFRESHED]",
                      marker.__busData.busId
                    );
                  }

                  // 11. Update z-index based on marker hierarchy
                  // Hierarchy: Followed bus > Arriving > SOS > Normal buses > Stops > Corridor
                  const remainingDistance = bus.progression?.remainingDistanceKm || Infinity;
                  if (window.__followBusId === id) {
                    marker.setZIndexOffset(2000); // Highest priority
                  } else if (remainingDistance < 0.2) {
                    marker.setZIndexOffset(1800); // Arriving priority
                  } else if (bus.sos) {
                    marker.setZIndexOffset(1500); // Emergency priority
                  } else {
                    marker.setZIndexOffset(1000); // Normal bus priority
                  }

                  // 12. Event-driven follow: camera tracks bus (use snapped coords if available)
                  if (window.__followBusId === id && !window.__isUserInteracting) {
                    const followLat = bus.snappedLat !== undefined && bus.snappedLat !== null ? bus.snappedLat : bus.lat;
                    const followLng = bus.snappedLng !== undefined && bus.snappedLng !== null ? bus.snappedLng : bus.lng;
                    throttledFollow(followLat, followLng);
                  }

                } else {
                  // CREATE NEW MARKER - only once per bus
                  // Use snapped coordinates if available, otherwise raw GPS
                  const displayLat = bus.snappedLat !== undefined && bus.snappedLat !== null ? bus.snappedLat : bus.lat;
                  const displayLng = bus.snappedLng !== undefined && bus.snappedLng !== null ? bus.snappedLng : bus.lng;
                  const latlng = [displayLat, displayLng];
                  
                  const busData = { ...bus, id, eta, lat: displayLat, lng: displayLng };
                  
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

                  // Apply initial visual state class
                  const els = getMarkerElements(marker);
                  if (els && els.container) {
                    // Fix #3: Use backend-derived speed for reliable movement detection
                    const speedKmh = bus.derivedSpeed !== undefined ? bus.derivedSpeed : (bus.speed || 0);
                    const remainingDistance = bus.progression?.remainingDistanceKm || Infinity;
                    const isSos = bus.sos === true;

                    // Priority: SOS > Arriving > Moving > Stopped
                    if (isSos) {
                      els.container.classList.add('bus-marker--sos');
                    } else if (remainingDistance < 0.2) {
                      els.container.classList.add('bus-marker--arriving');
                    } else if (speedKmh > 5) {
                      els.container.classList.add('bus-marker--moving');
                    } else {
                      els.container.classList.add('bus-marker--stopped');
                    }
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

                  // Set initial z-index based on hierarchy
                  const remainingDistance = bus.progression?.remainingDistanceKm || Infinity;
                  if (window.__followBusId === id) {
                    marker.setZIndexOffset(2000); // Highest priority
                  } else if (remainingDistance < 0.2) {
                    marker.setZIndexOffset(1800); // Arriving priority
                  } else if (bus.sos) {
                    marker.setZIndexOffset(1500); // Emergency priority
                  } else {
                    marker.setZIndexOffset(1000); // Normal bus priority
                  }

                  markers[id] = marker;

                  console.log(
                    "[WEBVIEW] BUS marker registered:",
                    id
                  );

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

              console.log("[WEBVIEW] userMarker updated:", lat, lng);

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
                console.log("[WEBVIEW] userMarker created");
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
            window.__busStopMarkers = {}; // Registry of all stop markers by ID
            window.__stopBusMap = {}; // stopId → [busIds]
            window.stopArrivalsMap = {}; // Realtime arrivals cache: stopId → { arrivals }
            window.__stopRouteLine = null; // Temporary route line layer
            window.__stopsReady = false; // Flag: markers fully rendered
            window.__pendingSelectedStop = null; // Queue for early SELECT_STOP
window.__highlightedStopId = null; // Currently highlighted stop
window.__activeRouteStopId = null; // Persist route highlight across re-renders
window.__activeRouteLine = null; // Active route corridor polyline (single)
window.__activeRouteId = null; // Currently displayed route ID
window.__activeBusId = null; // Bus ID that owns the active route
window.__routeFittedOnce = false; // Prevent repeated fitBounds
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

// Passed stop icon - dimmed appearance
function createPassedStopIcon(name) {
  return L.divIcon({
    html: '<div class="bus-stop-marker passed-stop">' +
      '<div class="bus-stop-icon" style="background: #e5e7eb; border-color: #9ca3af; color: #6b7280;">✓</div>' +
      '<div class="bus-stop-label" style="background: #e5e7eb; color: #6b7280;">' + (name || 'Stop') + '</div>' +
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

// Build arrival-aware stop popup HTML (reads from window.stopArrivalsMap)
function createStopPopupHTML(stopId, stopName) {
  const stopData = window.stopArrivalsMap && window.stopArrivalsMap[stopId];
  const arrivals = (stopData && stopData.arrivals) ? stopData.arrivals : [];

  const statusColors = { AT_STOP: '#007AFF', ARRIVING: '#10B981', UPCOMING: '#FF9500', DEPARTED: '#9CA3AF' };
  const statusDots  = { AT_STOP: '🔵', ARRIVING: '🟢', UPCOMING: '🟡', DEPARTED: '⚫' };

  let html = '<div style="min-width:160px;">';
  html += '<div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#1f2937;">' + (stopName || 'Bus Stop') + '</div>';

  if (arrivals.length === 0) {
    html += '<div style="font-size:12px;color:#9CA3AF;">No buses arriving</div>';
  } else {
    arrivals.slice(0, 5).forEach(function(a) {
      const dot   = statusDots[a.status]  || '⚪';
      const color = statusColors[a.status] || '#6B7280';
      const eta   = a.status === 'AT_STOP' ? 'At Stop' : (a.etaMinutes != null ? a.etaMinutes + ' min' : '—');
      const label = a.routeName || a.busId;
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">';
      html += '<span style="font-size:12px;">' + dot + ' ' + label + '</span>';
      html += '<span style="font-size:12px;font-weight:600;color:' + color + ';margin-left:8px;">' + eta + '</span>';
      html += '</div>';
      if (a.currentStopName) {
        html += '<div style="font-size:10px;color:#6B7280;margin-left:16px;margin-bottom:2px;">Now: ' + a.currentStopName + '</div>';
      }
    });
  }

  html += '</div>';
  return html;
}

// Update stop popup with arrivals data
function updateStopPopups() {
  Object.keys(window.__busStopMarkers).forEach(function(stopId) {
    const marker = window.__busStopMarkers[stopId];
    if (!marker || !marker.getPopup()) return;
    marker.setPopupContent(createStopPopupHTML(stopId, marker.__stopName || 'Bus Stop'));
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
      opacity: 0.35,
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
    // Normalize stop.id vs stop._id safely
    const stopId = stop.id || stop._id;
    if (!stopId || !stop.lat || !stop.lng) return;
    
    // Only consider stops that have rendered markers
    const marker = window.__busStopMarkers[stopId];
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
    const nearestStopId = nearestStop.id || nearestStop._id;
    // Reset previous highlight if stop changed
    if (window.__highlightedStopId && window.__highlightedStopId !== nearestStopId && window.__busStopMarkers[window.__highlightedStopId]) {
      const prevMarker = window.__busStopMarkers[window.__highlightedStopId];
      const prevStopName = prevMarker.__stopName || 'Stop';
      prevMarker.setIcon(createStopIcon(prevStopName));
    }
    
    // Apply highlight only if shouldHighlight AND __showNearestRoute
    if (shouldHighlight && window.__showNearestRoute && window.__highlightedStopId !== nearestStopId) {
      applyHighlight(nearestMarker);
      window.__highlightedStopId = nearestStopId;
      console.log("[WEBVIEW] Highlight applied to:", nearestStop.name);
    } else if (!shouldHighlight || !window.__showNearestRoute) {
      // Store nearest but don't highlight
      window.__highlightedStopId = nearestStopId;
    }

    // Check if nearest stop changed
    const stopChanged = window.__highlightedStopId && window.__highlightedStopId !== nearestStopId;
    
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
      opacity: 0.35,
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
      opacity: 0.35
    }).addTo(window.map);

    console.log("[WEBVIEW] OSRM route drawn");
  } else {
    // fallback
    window.__nearestRouteLayer = L.polyline(
      [[lat, lng], [nearest.lat, nearest.lng]],
      {
        color: '#007AFF',
        weight: 4,
        opacity: 0.35,
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

  let added = 0;
  let reused = 0;
  
  window.__busStops.forEach(stop => {
    // Normalize stop.id vs stop._id safely
    const stopId = stop.id || stop._id;
    if (!stopId || !stop.lat || !stop.lng) {
      console.log("[WEBVIEW] renderBusStops: skipping stop - missing id or coords");
      return;
    }

    let marker = window.__busStopMarkers[stopId];

    if (!marker) {
      marker = L.marker([stop.lat, stop.lng], {
        icon: createStopIcon(stop.name),
        pane: 'busStopsPane'
      }).addTo(window.map);

      marker.__stopName = stop.name;
      marker.__stopId = stopId; // Store normalized ID on marker
      marker.bindPopup(createStopPopupHTML(stopId, stop.name));

      window.__busStopMarkers[stopId] = marker;
      added++;
    } else {
      marker.setLatLng([stop.lat, stop.lng]);
      if (!window.map.hasLayer(marker)) marker.addTo(window.map);
      reused++;
    }
  });
  
  // Mark stops as ready and log telemetry
  window.__stopsReady = true;
  const markerCount = Object.keys(window.__busStopMarkers).length;
  console.log("[WEBVIEW] renderBusStops complete: added=" + added + ", reused=" + reused + ", total=" + markerCount);
  
  // Process any pending SELECT_STOP that arrived before markers were ready
  if (window.__pendingSelectedStop) {
    console.log("[WEBVIEW] Processing pending SELECT_STOP for", window.__pendingSelectedStop.id);
    window.__pendingSelectedStop = null;
  }
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
              console.log("[WEBVIEW] RAW MESSAGE:", event.data);
              
              let data;
              try {
                data = typeof event.data === "string" 
                  ? JSON.parse(event.data || "{}") 
                  : event.data;
              } catch (e) {
                console.log("[WEBVIEW] MESSAGE ERROR:", e.message);
                return;
              }
              
              if (!data || !window.map) return;
              
              console.log("[WEBVIEW] PARSED TYPE:", data.type);

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

                case "BUS_LOCATION_UPDATE":
                  // Live individual bus update from socket
                  if (!data.busId || data.lat == null || data.lng == null) return;
                  
                  // Initialize markers storage
                  if (!window.busMarkers) window.busMarkers = {};
                  
                  const latlng = [data.lat, data.lng];
                  const busId = data.busId;
                  
                  if (window.busMarkers[busId]) {
                    // Update existing marker
                    updateBusPosition(window.busMarkers[busId], busId, data.lat, data.lng);
                  } else {
                    // Create new marker
                    const marker = L.marker(latlng, {
                      icon: window.busIcon,
                      zIndexOffset: 1000
                    }).addTo(window.map);
                    marker.__busId = busId;
                    marker.__busData = { busId, lat: data.lat, lng: data.lng };
                    window.busMarkers[busId] = marker;
                  }
                  break;

                case "USER_LOCATION":
                  console.log("[WEBVIEW] USER_LOCATION received", data.lat, data.lng);
                  if (data.lat != null && data.lng != null) {
                    const lat = Number(data.lat);
                    const lng = Number(data.lng);
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
                      console.error("[WEBVIEW] Invalid lat/lng:", data);
                    }
                  } else {
                    console.error("[WEBVIEW] Missing lat/lng:", data);
                  }
                  break;

                case "DRAW_ROUTE":
                  // Route corridor drawing with coordinate normalization
                  console.log("[WEBVIEW] DRAW_ROUTE received for bus:", data.busId, "route:", data.routeId);
                  
                  if (data.coordinates && Array.isArray(data.coordinates)) {
                    try {
                      // Remove previous route line if exists
                      if (window.activeRouteLine) {
                        window.map.removeLayer(window.activeRouteLine);
                        window.activeRouteLine = null;
                        console.log("[WEBVIEW] DRAW_ROUTE: removed previous polyline");
                      }
                      
                      // Normalize coordinates: [lng,lat] → [lat,lng] for Leaflet
                      const normalizedCoords = data.coordinates.map(coord => {
                        if (Array.isArray(coord) && coord.length >= 2) {
                          return [coord[1], coord[0]]; // Swap to [lat, lng]
                        } else if (typeof coord === 'object' && coord !== null) {
                          return [coord.lat, coord.lng];
                        }
                        return coord;
                      });
                      
                      console.log("[WEBVIEW] DRAW_ROUTE: normalized", normalizedCoords.length, "coordinates");
                      
                      // Draw single L.polyline
                      const routeLine = L.polyline(normalizedCoords, {
                        color: data.routeColor || "#2563eb",
                        weight: 5,
                        opacity: 0.35,
                      }).addTo(window.map);
                      
                      window.activeRouteLine = routeLine;
                      
                      console.log("[WEBVIEW] DRAW_ROUTE: success - drew route corridor", data.routeId, "with", normalizedCoords.length, "points");
                    } catch (drawError) {
                      console.error("[WEBVIEW] DRAW_ROUTE error:", drawError.message);
                      // Safe fallback - ensure window.activeRouteLine is null on error
                      window.activeRouteLine = null;
                    }
                  } else {
                    console.error("[WEBVIEW] DRAW_ROUTE: invalid coordinates");
                  }
                  break;

                case "FIT_ROUTE":
                  // Auto-frame route corridor bounds
                  console.log("[WEBVIEW] FIT_ROUTE received with", data.coordinates?.length, "coordinates");
                  
                  if (data.coordinates && Array.isArray(data.coordinates)) {
                    try {
                      // Normalize coordinates: [lng,lat] → [lat,lng] for Leaflet
                      const normalizedCoords = data.coordinates.map(coord => {
                        if (Array.isArray(coord) && coord.length >= 2) {
                          return [coord[1], coord[0]]; // Swap to [lat, lng]
                        } else if (typeof coord === 'object' && coord !== null) {
                          return [coord.lat, coord.lng];
                        }
                        return coord;
                      });
                      
                      // Build LatLng bounds from normalized coordinates
                      const bounds = L.latLngBounds(normalizedCoords);
                      
                      // Fit map to route bounds with padding
                      window.map.fitBounds(bounds, {
                        padding: [40, 40],
                        animate: true
                      });
                      
                      console.log("[WEBVIEW] FIT_ROUTE: success - bounds fitted");
                    } catch (fitError) {
                      console.error("[WEBVIEW] FIT_ROUTE error:", fitError.message);
                    }
                  } else {
                    console.error("[WEBVIEW] FIT_ROUTE: invalid coordinates");
                  }
                  break;
                  
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
                  // Remove route corridor polyline safely
                  console.log("[WEBVIEW] CLEAR_ROUTE received");
                  if (window.activeRouteLine) {
                    try {
                      window.map.removeLayer(window.activeRouteLine);
                      window.activeRouteLine = null;
                      console.log("[WEBVIEW] CLEAR_ROUTE: removed route corridor");
                    } catch (clearError) {
                      console.error("[WEBVIEW] CLEAR_ROUTE error:", clearError.message);
                      window.activeRouteLine = null; // Ensure cleanup even on error
                    }
                  } else {
                    console.log("[WEBVIEW] CLEAR_ROUTE: no active route to remove");
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

                case "HIGHLIGHT_STOP":
                  // Highlight stop marker from HomeScreen navigation
                  console.log("[WEBVIEW] HIGHLIGHT_STOP received:", data.stop?.name);
                  
                  if (data.stop && window.map) {
                    try {
                      // Remove previous highlighted marker if exists
                      if (window.highlightedStopMarker) {
                        window.map.removeLayer(window.highlightedStopMarker);
                        window.highlightedStopMarker = null;
                      }
                      
                      const stopLat = data.stop.latitude || data.stop.lat;
                      const stopLng = data.stop.longitude || data.stop.lng;
                      
                      if (stopLat !== undefined && stopLng !== undefined) {
                        // Draw highlighted circle marker
                        const highlightedMarker = L.circleMarker([stopLat, stopLng], {
                          radius: 15,
                          fillColor: '#007AFF',
                          color: '#0051D5',
                          weight: 3,
                          opacity: 1,
                          fillOpacity: 0.3
                        }).addTo(window.map);
                        
                        // Open popup with stop name
                        highlightedMarker.bindPopup('<div style="text-align:center;font-weight:600;color:#333;">' + 
                          escapeText(data.stop.name || 'Stop') + '</div>');
                        highlightedMarker.openPopup();
                        
                        // Store marker reference
                        window.highlightedStopMarker = highlightedMarker;
                        
                        // Fly to stop
                        window.map.flyTo([stopLat, stopLng], 16, {
                          animate: true,
                          duration: 1
                        });
                        
                        console.log("[WEBVIEW] HIGHLIGHT_STOP: success - marker drawn and flew to stop");
                      }
                    } catch (highlightError) {
                      console.error("[WEBVIEW] HIGHLIGHT_STOP error:", highlightError.message);
                      window.highlightedStopMarker = null; // Ensure cleanup on error
                    }
                  }
                  break;

                case "STOP_PROGRESSION": {
                  const { busId, tripId, nextStopIndex, currentStopIndex, passedStopIds, etaMinutes } = data;
                  console.log("[WEBVIEW] STOP_PROGRESSION:", busId, "trip:", tripId, "next:", nextStopIndex, "passed:", passedStopIds?.length || 0);

                  // Initialize tracking objects
                  if (!window.__nextStopMarkers) window.__nextStopMarkers = {};
                  if (!window.__passedStopMarkers) window.__passedStopMarkers = {};
                  if (!window.__busTripIds) window.__busTripIds = {};

                  // Route switch detection: clear all stop state if trip changed
                  const prevTripId = window.__busTripIds[busId];
                  if (prevTripId && prevTripId !== tripId) {
                    console.log("[WEBVIEW] Trip switch detected for", busId, ":", prevTripId, "→", tripId);

                    // Clear passed stop styling
                    const prevPassed = window.__passedStopMarkers[busId] || [];
                    prevPassed.forEach(function(stopId) {
                      if (window.__busStopMarkers[stopId]) {
                        const marker = window.__busStopMarkers[stopId];
                        marker.setIcon(createStopIcon(marker.__stopName || 'Stop'));
                        marker._isPassed = false;
                      }
                    });
                    delete window.__passedStopMarkers[busId];

                    // Clear next stop highlight
                    const prevNextStop = window.__nextStopMarkers[busId];
                    if (prevNextStop && window.__busStopMarkers[prevNextStop]) {
                      const marker = window.__busStopMarkers[prevNextStop];
                      marker.setIcon(createStopIcon(marker.__stopName || 'Stop'));
                    }
                    delete window.__nextStopMarkers[busId];
                  }

                  // Update stored tripId
                  window.__busTripIds[busId] = tripId;
                  
                  // 1. Restore previous passed stops for this bus
                  const prevPassed = window.__passedStopMarkers[busId] || [];
                  prevPassed.forEach(function(stopId) {
                    if (window.__busStopMarkers[stopId]) {
                      const marker = window.__busStopMarkers[stopId];
                      // Restore to default stop icon (not passed, not highlighted)
                      marker.setIcon(createStopIcon(marker.__stopName || 'Stop'));
                      marker._isPassed = false;
                    }
                  });
                  
                  // 2. Remove previous next-stop highlight for this bus
                  const prevHighlight = window.__nextStopMarkers[busId];
                  if (prevHighlight && window.__busStopMarkers[prevHighlight]) {
                    const marker = window.__busStopMarkers[prevHighlight];
                    // Only restore if NOT in new passed list
                    if (!passedStopIds || !passedStopIds.includes(prevHighlight)) {
                      marker.setIcon(createStopIcon(marker.__stopName || 'Stop'));
                    }
                    console.log("[WEBVIEW] Removed previous highlight for", busId);
                  }
                  
                  // 3. Apply passed-stop styling
                  const currentPassed = [];
                  if (passedStopIds && passedStopIds.length > 0) {
                    passedStopIds.forEach(function(stopId) {
                      if (window.__busStopMarkers[stopId]) {
                        const marker = window.__busStopMarkers[stopId];
                        marker.setIcon(createPassedStopIcon(marker.__stopName || 'Stop'));
                        marker._isPassed = true;
                        currentPassed.push(stopId);
                      }
                    });
                  }
                  window.__passedStopMarkers[busId] = currentPassed;
                  
                  // 4. Highlight new next stop (unless it's in passed list)
                  if (nextStopIndex >= 0 && window.__busStops && window.__busStops[nextStopIndex]) {
                    const stop = window.__busStops[nextStopIndex];
                    // Normalize stop.id vs stop._id safely
                    const stopId = stop.id || stop._id;
                    if (!stopId) {
                      console.log("[WEBVIEW] STOP_PROGRESS_UPDATE: skip - no stop ID");
                      break;
                    }
                    
                    if (window.__busStopMarkers[stopId] && !window.__busStopMarkers[stopId]._isPassed) {
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
                  
                  // Normalize stop.id vs stop._id safely
                  const stopId = stop.id || stop._id;
                  if (!stopId) {
                    console.log("[WEBVIEW] FOCUS_STOP: failed - no stop ID");
                    return;
                  }

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
                        if (result && window.__busStopMarkers[stopId]) {
                          const marker = window.__busStopMarkers[stopId];
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
                    if (window.__busStopMarkers[stopId]) {
                      window.__busStopMarkers[stopId].openPopup();
                    }
                  }

                  break;
                }

                case "DRAW_STOP_ROUTE": {
                  const payload = data.payload;

                  console.log(
                    "[WEBVIEW] DRAW_STOP_ROUTE RECEIVED",
                    JSON.stringify(payload)
                  );

                  if (!window.map) {
                    console.log("[WEBVIEW] window.map missing");
                    break;
                  }

                  console.log("[WEBVIEW] map exists");

                  // NORMALIZE coordinates
                  const userLat = Number(
                    payload?.userLocation?.latitude
                  );

                  const userLng = Number(
                    payload?.userLocation?.longitude
                  );

                  const stopLat = Number(
                    payload?.stop?.latitude
                  );

                  const stopLng = Number(
                    payload?.stop?.longitude
                  );

                  console.log(
                    "[WEBVIEW] normalized coords:",
                    {
                      userLat,
                      userLng,
                      stopLat,
                      stopLng
                    }
                  );

                  // HARD VALIDATION
                  if (
                    Number.isNaN(userLat) ||
                    Number.isNaN(userLng) ||
                    Number.isNaN(stopLat) ||
                    Number.isNaN(stopLng)
                  ) {
                    console.log(
                      "[WEBVIEW] invalid route coordinates"
                    );
                    break;
                  }

                  // REMOVE old route
                  if (window.__stopRouteLine) {
                    console.log("[WEBVIEW] removing old route");

                    window.map.removeLayer(
                      window.__stopRouteLine
                    );

                    window.__stopRouteLine = null;
                  }

                  const routeCoords = [
                    [userLat, userLng],
                    [stopLat, stopLng]
                  ];

                  console.log(
                    "[WEBVIEW] routeCoords:",
                    JSON.stringify(routeCoords)
                  );

                  window.__stopRouteLine = L.polyline(
                    routeCoords,
                    {
                      color: "#007AFF",
                      weight: 6,
                      opacity: 0.9
                    }
                  ).addTo(window.map);

                  console.log(
                    "[WEBVIEW] polyline added"
                  );

                  // FORCE ROUTE TO FRONT
                  window.__stopRouteLine.bringToFront();

                  console.log(
                    "[WEBVIEW] polyline brought to front"
                  );

                  // FIT ROUTE
                  window.map.fitBounds(
                    window.__stopRouteLine.getBounds(),
                    {
                      padding: [60, 60]
                    }
                  );

                  console.log(
                    "[WEBVIEW] fitBounds applied"
                  );

                  // OPEN EXISTING STOP POPUP
                  const stopId =
                    payload?.stop?.id;

                  const marker =
                    window.__busStopMarkers?.[stopId];

                  console.log(
                    "[WEBVIEW] stop marker exists:",
                    !!marker,
                    stopId
                  );

                  if (marker) {
                    marker.setZIndexOffset(1000);

                    setTimeout(() => {
                      marker.openPopup();

                      console.log(
                        "[WEBVIEW] stop popup opened"
                      );
                    }, 400);
                  }

                  break;
                }
                
                case "CLEAR_STOP_ROUTE": {
                  console.log("[WEBVIEW] CLEAR_STOP_ROUTE");
                  console.log("[WEBVIEW] Removing temporary route");
                  
                  if (window.__stopRouteLine && window.map) {
                    try {
                      window.map.removeLayer(window.__stopRouteLine);
                    } catch (e) {}
                    window.__stopRouteLine = null;
                  }
                  
                  break;
                }

                case "STOP_PROGRESS_UPDATE": {
                  const { busId, passedStopIds, currentStopId, nextStopId, routeProgressIndex } = data;
                  console.log("[WEBVIEW] STOP_PROGRESS_UPDATE:", busId, {
                    passed: passedStopIds?.length || 0,
                    current: currentStopId,
                    next: nextStopId
                  });
                  
                  // Update stop marker icons based on progression state
                  if (window.__busStopMarkers) {
                    // Update passed stops → gray
                    if (passedStopIds && passedStopIds.length > 0) {
                      passedStopIds.forEach(stopId => {
                        const marker = window.__busStopMarkers[stopId];
                        if (marker) {
                          marker.setIcon(L.divIcon({
                            className: 'bus-stop-marker',
                            html: '<div style="width:24px;height:24px;background:#9CA3AF;border-radius:50%;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">✓</div>',
                            iconSize: [24, 24],
                            iconAnchor: [12, 12]
                          }));
                          marker.__stopStatus = 'passed';
                        }
                      });
                    }
                    
                    // Update current stop → green pulse
                    if (currentStopId) {
                      const marker = window.__busStopMarkers[currentStopId];
                      if (marker) {
                        marker.setIcon(L.divIcon({
                          className: 'bus-stop-marker current',
                          html: '<div style="width:28px;height:28px;background:#22C55E;border-radius:50%;border:3px solid white;box-shadow:0 0 0 4px rgba(34,197,94,0.4),0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;animation:pulse 2s infinite;">●</div>',
                          iconSize: [28, 28],
                          iconAnchor: [14, 14]
                        }));
                        marker.__stopStatus = 'current';
                      }
                    }
                    
                    // Update next stop → orange
                    if (nextStopId) {
                      const marker = window.__busStopMarkers[nextStopId];
                      if (marker) {
                        marker.setIcon(L.divIcon({
                          className: 'bus-stop-marker next',
                          html: '<div style="width:24px;height:24px;background:#F97316;border-radius:50%;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">➜</div>',
                          iconSize: [24, 24],
                          iconAnchor: [12, 12]
                        }));
                        marker.__stopStatus = 'next';
                      }
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

                case "FOLLOW_UPDATE": {
                  const payload =
                    data.payload ??
                    data.followBusId ??
                    null;

                  console.log(
                    "[WEBVIEW FULLMAP] FOLLOW_UPDATE received:",
                    payload
                  );

                  if (
                    window.__followBusId === payload
                  ) {
                    console.log(
                      "[WEBVIEW FULLMAP] follow unchanged"
                    );
                    break;
                  }

                  const prevBusId = window.__followBusId;
                  const newBusId = payload;

                  window.__followBusId = newBusId;

                  // Hide previous badge only if ID actually changed
                  if (prevBusId && prevBusId !== newBusId) {
                    hideSpeedBadge(prevBusId);
                  }

                  if (!newBusId) {
                    console.log(
                      "[WEBVIEW FULLMAP] FOLLOW cleared"
                    );
                    resetSpeedometer();
                    break;
                  }

                  showSpeedBadge(newBusId);

                  const marker =
                    window.busMarkers?.[newBusId];

                  console.log(
                    "[WEBVIEW FULLMAP] follow marker exists:",
                    !!marker,
                    newBusId
                  );

                  if (!marker) {
                    console.log(
                      "[WEBVIEW FULLMAP] marker missing"
                    );
                    break;
                  }

                  const latLng = marker.getLatLng();

                  console.log(
                    "[WEBVIEW FULLMAP] centering:",
                    { lat: latLng.lat, lng: latLng.lng }
                  );

                  window.map.flyTo(
                    [latLng.lat, latLng.lng],
                    17,
                    {
                      duration: 0.8
                    }
                  );

                  marker.setZIndexOffset(2000);

                  setTimeout(() => {
                    marker.openPopup();

                    console.log(
                      "[WEBVIEW FULLMAP] popup opened"
                    );
                  }, 400);

                  break;
                }

                case "BUS_OFFLINE":
                  // Cancel any ongoing animation for offline bus
                  cancelBusAnimation(data.busId);

                  // Clear any pending offline timeout for this bus
                  if (window.__offlineTimeouts[data.busId]) {
                    clearTimeout(window.__offlineTimeouts[data.busId]);
                    delete window.__offlineTimeouts[data.busId];
                    console.log("[WEBVIEW] Cleared pending offline timeout for:", data.busId);
                  }

                  // Clear route corridor if this was the active followed bus
                  if (window.activeRouteLine) {
                    window.map.removeLayer(window.activeRouteLine);
                    window.activeRouteLine = null;
                    console.log("[WEBVIEW] Cleared route corridor for offline bus:", data.busId);
                  }
                  // Also clear legacy route variables if present
                  if (window.__activeRouteLine) {
                    window.map.removeLayer(window.__activeRouteLine);
                    window.__activeRouteLine = null;
                    window.__activeRouteId = null;
                    window.__activeBusId = null;
                    window.__routeFittedOnce = false;
                  }

                  // Apply offline transition before removal
                  if (data.busId && window.busMarkers[data.busId]) {
                    const marker = window.busMarkers[data.busId];
                    const els = getMarkerElements(marker);

                    if (els && els.container) {
                      els.container.classList.add('bus-marker--offline');
                      console.log("[WEBVIEW] Applied offline transition to:", data.busId);

                      // Fix #3: Capture target marker identity for timeout callback
                      const targetMarker = marker;

                      // Remove marker after 300ms transition
                      const timeoutId = setTimeout(function() {
                        // Fix #3: Verify marker identity matches (not just existence)
                        // Prevents deletion of fresh marker after reconnect
                        if (window.busMarkers[data.busId] === targetMarker) {
                          window.map.removeLayer(targetMarker);
                          delete window.busMarkers[data.busId];
                          console.log("[WEBVIEW] Removed marker for offline bus:", data.busId);
                        } else {
                          console.log("[WEBVIEW] Skipped removal - marker identity changed (reconnect):", data.busId);
                        }
                        // Cleanup timeout ref
                        if (window.__offlineTimeouts[data.busId] === timeoutId) {
                          delete window.__offlineTimeouts[data.busId];
                        }
                      }, 300);
                      window.__offlineTimeouts[data.busId] = timeoutId;
                    } else {
                      // Fallback: remove immediately if no DOM refs
                      window.map.removeLayer(marker);
                      delete window.busMarkers[data.busId];
                      console.log("[WEBVIEW] Removed marker for offline bus (fallback):", data.busId);
                    }
                  }
                  // Clear passed stop styling for offline bus
                  if (data.busId && window.__passedStopMarkers?.[data.busId]) {
                    const prevPassed = window.__passedStopMarkers[data.busId];
                    prevPassed.forEach(function(stopId) {
                      if (window.__busStopMarkers[stopId]) {
                        const marker = window.__busStopMarkers[stopId];
                        marker.setIcon(createStopIcon(marker.__stopName || 'Stop'));
                        marker._isPassed = false;
                      }
                    });
                    delete window.__passedStopMarkers[data.busId];
                    console.log("[WEBVIEW] Removed passed stop styling for offline bus:", data.busId, "count:", prevPassed.length);
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

                case "STOP_ARRIVALS_UPDATE":
                  window.stopArrivalsMap = data.stopArrivalsMap || {};
                  console.log("[WEBVIEW] STOP_ARRIVALS_UPDATE:", Object.keys(window.stopArrivalsMap).length, "stops");
                  // Refresh only open stop popups — no marker recreation
                  Object.keys(window.__busStopMarkers || {}).forEach(function(stopId) {
                    const marker = window.__busStopMarkers[stopId];
                    if (marker && marker.isPopupOpen()) {
                      marker.setPopupContent(createStopPopupHTML(stopId, marker.__stopName));
                    }
                  });
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
              console.log("[WEBVIEW] MESSAGE LISTENERS ATTACHED");
            }
            console.log("[WEBVIEW] BRIDGE LISTENERS READY");

            window.__messageHandlerReady = true;

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
