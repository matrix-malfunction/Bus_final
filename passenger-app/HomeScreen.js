import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  DeviceEventEmitter,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";
import { fetchNearbyBuses, expandBusData } from "./api/busApi";
import { useBus } from "./BusContext";
import Speedometer from "./components/Speedometer";

const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";
const DEFAULT_CENTER = { latitude: 13.1044, longitude: 79.9079 };

// Nearest Bus Stop Card Component
const BusStopCard = ({ stopName, distance, nextBusTime, onPress }) => (
  <TouchableOpacity style={styles.stopCard} onPress={onPress}>
    <View style={styles.stopIconContainer}>
      <Text style={styles.stopIcon}>🚏</Text>
    </View>
    <View style={styles.stopInfo}>
      <Text style={styles.stopName}>{stopName}</Text>
      <Text style={styles.stopDistance}>{distance} away</Text>
      <Text style={styles.nextBus}>Next bus: {nextBusTime}</Text>
    </View>
    <Text style={styles.chevron}>›</Text>
  </TouchableOpacity>
);

// Mini Map Component - VIEW ONLY
const MiniMap = React.memo(({ webViewRef, setWebViewReady, onPress, buses, userLocation, followBusId, setFollowBusId, busStops, showNearestRoute, setShowNearestRoute }) => {
  const mapHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
    #map { position: absolute; top: 0; bottom: 0; left: 0; right: 0; }
    /* Beacon pulse animation - Google Maps style (same as FullMap) */
    .beacon-container { position: relative; }
    .beacon-dot {
      width: 12px; height: 12px; background: #007AFF; border-radius: 50%;
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2;
    }
    .beacon-pulse {
      width: 20px; height: 20px; background: rgba(0,122,255,0.3); border-radius: 50%;
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      animation: pulse-ring 1.5s ease-out infinite; z-index: 1;
    }
    @keyframes pulse-ring {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }
    /* Bus stop markers - visible and interactive like FullMap */
    .bus-stop-marker { display: flex; justify-content: center; align-items: center; }
    .stop-dot {
      width: 18px;
      height: 18px;
      background: #dc2626;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 0 6px rgba(0,0,0,0.6);
    }
    /* Bus markers - view-only mode */
    .bus-marker { display: flex; justify-content: center; align-items: center; }
    .bus-dot {
      width: 14px;
      height: 14px;
      background: #007AFF;
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", function() {
  // DEBUG: Make body visible
  document.body.style.background = "#f0f0f0";
  
  function send(msg) {
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({ type: "LOG", message: msg })
    );
  }

  // Global error handler
  window.onerror = function(msg, url, line) {
    send("JS ERROR: " + msg + " at line " + line);
    return true;
  };

  send("SCRIPT STARTED");

  // Guard: Leaflet must be loaded
  if (typeof L === "undefined") {
    send("Leaflet FAILED - L is undefined");
    return;
  }

  // Message queue for early messages
  window.__messageQueue = window.__messageQueue || [];
  window.__messageHandlerAttached = window.__messageHandlerAttached || false;
  window.__queueProcessed = window.__queueProcessed || false;

  try {
    // Validate map: check if it's a valid Leaflet map instance (multiple methods)
    const isValidMap = window.map && 
                       typeof window.map.eachLayer === "function" &&
                       typeof window.map.setView === "function" &&
                       typeof window.map.addLayer === "function";

    // Create or recreate map if invalid
    if (!isValidMap) {
      send("Creating new map (invalid or missing)");
      
      // Reset user marker so it gets recreated on new map
      window.__userMarker = null;
      
      window.map = L.map("map", {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,  // Enable canvas rendering for performance
        zoomAnimation: false,  // Disable zoom animations
        fadeAnimation: false,  // Disable tile fade animations
        markerZoomAnimation: false  // Disable marker zoom animations
      }).setView([13.0827, 80.2707], 15);

      send("MAP CREATED");
    } else {
      send("Map already valid, skipping creation");
    }

    // Ensure tile layer is attached (runs every time)
    if (window.map && typeof window.map.eachLayer === "function") {
      // Check if tile layer already exists
      let hasTileLayer = false;
      window.map.eachLayer(function(layer) {
        if (layer instanceof L.TileLayer) {
          hasTileLayer = true;
        }
      });

      // Only add tile layer if not present (optimized for performance)
      if (!hasTileLayer) {
        const tiles = L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            updateWhenIdle: false,
            updateWhenZooming: false,
            keepBuffer: 8,      // Increased buffer for faster panning
            reuseTiles: true,   // Reuse tiles from previous views
            crossOrigin: true   // Enable CORS for better caching
          }
        );

        // Comprehensive tile event logging
        tiles.on("loading", function() { send("TILES LOADING..."); });
        tiles.on("load", function(e) { send("TILES LOADED: " + (Object.keys(e?.target?._tiles || {}).length || "unknown") + " tiles"); });
        tiles.on("tileerror", function(e) { send("TILE ERROR: " + (e?.coords?.z + "/" + e?.coords?.x + "/" + e?.coords?.y || "unknown")); });

        tiles.addTo(window.map);
        send("TILE LAYER ADDED");

        // Event-based opacity control (tied to actual tile loading, not timeout)
        const mapEl = document.getElementById("map");
        if (mapEl) {
          mapEl.style.transition = "opacity 0.15s ease";
          
          tiles.on("loading", () => {
            mapEl.style.opacity = "0.5";
          });
          
          tiles.on("load", () => {
            mapEl.style.opacity = "1";
          });
        }

        // Map ready state - no invalidateSize to avoid forced layout
        window.map.whenReady(() => {
          send("MAP READY");
        });

        // Zoom-based visibility control for bus stop markers
        if (!window.__zoomListenerAttached) {
          window.__zoomListenerAttached = true;
          window.map.on("zoomend", () => {
            const zoom = window.map.getZoom();
            if (!window.__busStopMarkers) return;

            Object.values(window.__busStopMarkers).forEach(marker => {
              if (zoom >= 15) {
                if (!window.map.hasLayer(marker)) {
                  marker.addTo(window.map);
                }
              } else {
                if (window.map.hasLayer(marker)) {
                  window.map.removeLayer(marker);
                }
              }
            });
          });
        }
      } else {
        send("TILE LAYER ALREADY EXISTS");
      }
    } else {
      send("ERROR: window.map is not valid for tile layer");
    }

    // USER LOCATION with beacon - Exact GPS position (no prediction)
    window.__lastUserLocation = window.__lastUserLocation || null;
    window.__userMarker = window.__userMarker || null;
    
    // Define global bus icon for markers (visible in WebView)
    window.busIcon = L.icon({
      iconUrl: "https://cdn-icons-png.flaticon.com/512/3448/3448339.png",
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    
    // Define SOS emergency icon (red cross/alert)
    window.sosIcon = L.icon({
      iconUrl: "https://cdn-icons-png.flaticon.com/512/1041/1041916.png",
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    
    // Initialize SOS markers storage (separate from bus markers)
    window.sosMarkers = window.sosMarkers || {};
    
    function updateUserLocation(lat, lng) {
      // Validate map is a valid Leaflet instance
      if (!window.map || typeof window.map.addLayer !== "function") {
        // Queue for later if map not ready
        window.__messageQueue.push({ type: "USER_LOCATION", lat, lng });
        return;
      }
      
      const pos = [lat, lng];
      window.__lastUserLocation = { lat, lng };
      
      console.log("[MiniMap] updateUserLocation:", lat, lng, "marker exists:", !!window.__userMarker);
      
      // Create marker if missing (happens on first GPS or after map recreation)
      if (!window.__userMarker) {
        const pulseIcon = L.divIcon({
          className: 'beacon-container',
          html: '<div class="beacon-dot"></div><div class="beacon-pulse"></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        window.__userMarker = L.marker(pos, { icon: pulseIcon, zIndexOffset: 1000 }).addTo(window.map);
        
        console.log("[MiniMap] User marker CREATED at:", lat, lng);
        
        // Add tooltip - show on click, hide on map move
        window.__userMarker.bindTooltip("You are here", { 
          direction: "top", 
          offset: [0, -10],
          permanent: false,
          interactive: false
        });
        
        // Click to show tooltip
        window.__userMarker.on("click", function() {
          window.__userMarker.openTooltip();
        });
        
        // Map move hides tooltip (with guard to prevent duplicate listeners)
        if (!window.__tooltipMoveListenerAttached) {
          window.__tooltipMoveListenerAttached = true;
          window.map.on("movestart", function() {
            if (window.__userMarker) {
              window.__userMarker.closeTooltip();
            }
          });
        }
        
        send("USER MARKER CREATED: " + lat.toFixed(6) + ", " + lng.toFixed(6));
        // NO EARLY RETURN - continue to setLatLng below
      }
      
      // ALWAYS update marker to EXACT GPS position (handles creation and updates)
      if (window.__userMarker && window.__userMarker.setLatLng) {
        window.__userMarker.setLatLng(pos);
        send("USER LOCATION UPDATED: " + lat.toFixed(6) + ", " + lng.toFixed(6));
      }
    }
    
    // Process queued messages - ALWAYS run
    function processQueuedMessages() {
      while (window.__messageQueue.length > 0) {
        const msg = window.__messageQueue.shift();
        if (msg.type === "USER_LOCATION") {
          updateUserLocation(msg.lat, msg.lng);
        }
      }
    }
    
    // Message handler (ONLY ONE - hardened with document.addEventListener)
    if (!window.__messageHandlerAttached) {
      window.__messageHandlerAttached = true;
      document.addEventListener("message", function(event) {
        let data;

        try {
          data = JSON.parse(event.data);
        } catch (e) {
          send("INVALID MESSAGE: " + event.data);
          return;
        }

        if (!data || !data.type) {
          send("INVALID FORMAT: missing type");
          return;
        }

        send("RECEIVED: " + data.type);

        switch (data.type) {
          case "USER_LOCATION":
            if (data.lat != null && data.lng != null) {
              updateUserLocation(data.lat, data.lng);
              send("USER_LOCATION processed: " + data.lat + ", " + data.lng);
            } else {
              send("USER_LOCATION missing lat/lng");
            }
            break;

          case "BUS_UPDATE":
            // View-only bus marker rendering (no popups, no interaction)
            if (!window.map) {
              send("BUS_UPDATE failed: map not ready");
              return;
            }
            
            // Initialize bus markers storage
            if (!window.busMarkers) {
              window.busMarkers = {};
            }
            
            // Validate buses array
            if (!data.buses || !Array.isArray(data.buses) || data.buses.length === 0) {
              send("BUS_UPDATE: no buses to render");
              return;
            }
            
            send("BUS_UPDATE received: " + data.buses.length + " buses");
            
            // Process each bus in the array
            data.buses.forEach(function(bus) {
              // Validate bus data
              if (!bus || !bus.busId || bus.lat == null || bus.lng == null) {
                send("BUS_UPDATE: skip invalid bus");
                return;
              }
              
              const busId = bus.busId;
              const busPos = [bus.lat, bus.lng];
              
              if (window.busMarkers[busId]) {
                // Update existing marker position
                window.busMarkers[busId].setLatLng(busPos);
                send("BUS_UPDATE: " + busId + " moved");
              } else {
                // Create new marker (view-only, no popup, no interaction)
                const marker = L.marker(busPos, { 
                  icon: window.busIcon,
                  interactive: false,
                  zIndexOffset: 500
                }).addTo(window.map);
                
                window.busMarkers[busId] = marker;
                send("BUS_UPDATE: " + busId + " created");
              }
            });
            break;

          case "BUS_OFFLINE":
            // Remove bus marker from map
            if (!window.busMarkers || !data.busId) {
              send("BUS_OFFLINE: no marker to remove");
              return;
            }
            
            const busId = data.busId;
            if (window.busMarkers[busId]) {
              window.map.removeLayer(window.busMarkers[busId]);
              delete window.busMarkers[busId];
              send("BUS_OFFLINE: " + busId + " removed");
            } else {
              send("BUS_OFFLINE: " + busId + " not found");
            }
            break;

          case "SOS_TRIGGERED":
            // Emergency: remove bus marker, add SOS marker
            if (!data.busId) {
              send("SOS_TRIGGERED: missing busId");
              return;
            }
            const sosBusId = data.busId;
            const sosLat = data.lat;
            const sosLng = data.lng;
            
            // Remove bus marker if exists
            if (window.busMarkers && window.busMarkers[sosBusId]) {
              window.map.removeLayer(window.busMarkers[sosBusId]);
              delete window.busMarkers[sosBusId];
              send("SOS_TRIGGERED: bus marker " + sosBusId + " removed");
            }
            
            // Add SOS marker at location
            if (sosLat != null && sosLng != null) {
              if (!window.sosMarkers) window.sosMarkers = {};
              
              // Remove existing SOS marker for this bus if any
              if (window.sosMarkers[sosBusId]) {
                window.map.removeLayer(window.sosMarkers[sosBusId]);
              }
              
              const sosMarker = L.marker([sosLat, sosLng], { 
                icon: window.sosIcon,
                zIndexOffset: 2000
              }).addTo(window.map);
              
              sosMarker.bindPopup("SOS EMERGENCY - Bus " + sosBusId, { autoClose: false });
              window.sosMarkers[sosBusId] = sosMarker;
              send("SOS_TRIGGERED: marker added for " + sosBusId);
            }
            break;

          case "SOS_CLEARED":
            // Remove SOS marker
            if (!data.busId) {
              send("SOS_CLEARED: missing busId");
              return;
            }
            const clearBusId = data.busId;
            
            if (window.sosMarkers && window.sosMarkers[clearBusId]) {
              window.map.removeLayer(window.sosMarkers[clearBusId]);
              delete window.sosMarkers[clearBusId];
              send("SOS_CLEARED: marker removed for " + clearBusId);
            } else {
              send("SOS_CLEARED: no marker found for " + clearBusId);
            }
            break;

          case "SOS_ACKNOWLEDGED":
            // Update popup to show acknowledged state (MiniMap - simple version)
            if (!data.busId) {
              send("SOS_ACKNOWLEDGED: missing busId");
              return;
            }
            const ackBusId = data.busId;
            
            if (window.sosMarkers && window.sosMarkers[ackBusId]) {
              const marker = window.sosMarkers[ackBusId];
              marker.setPopupContent("✅ ACKNOWLEDGED - Bus " + ackBusId);
              send("SOS_ACKNOWLEDGED: popup updated for " + ackBusId);
            } else {
              send("SOS_ACKNOWLEDGED: no marker found for " + ackBusId);
            }
            break;

          case "RECENTER":
            send("RECENTER handler executing");
            if (!window.map) {
              send("RECENTER failed: map not ready");
              return;
            }

            // Spam guard: prevent rapid recenter clicks
            if (window.__lastRecenterTime && (Date.now() - window.__lastRecenterTime < 300)) {
              send("RECENTER skipped: too soon");
              return;
            }
            window.__lastRecenterTime = Date.now();

            if (window.__lastUserLocation) {
              const { lat, lng } = window.__lastUserLocation;
              const currentCenter = window.map.getCenter();
              const distance = currentCenter.distanceTo([lat, lng]);
              
              const TARGET_ZOOM = 15;
              
              // Distance-based behavior with zoom to 15
              if (distance < 500) {
                // Close distance - fly to location with zoom animation
                window.map.flyTo([lat, lng], TARGET_ZOOM, {
                  duration: 0.3
                });
                send("RECENTERED (flyTo): " + lat.toFixed(6) + ", " + lng.toFixed(6) + " zoom: " + TARGET_ZOOM + " dist: " + Math.round(distance) + "m");
              } else {
                // Far distance - instant jump with target zoom
                window.map.setView([lat, lng], TARGET_ZOOM, {
                  animate: false
                });
                send("RECENTERED (setView): " + lat.toFixed(6) + ", " + lng.toFixed(6) + " zoom: " + TARGET_ZOOM + " dist: " + Math.round(distance) + "m");
              }
            } else {
              send("RECENTER failed: no location available");
            }
            break;

          case "BUS_STOPS":
          case "INIT_BUS_STOPS":
            const msgType = data.type;
            send("RECEIVED: " + msgType + " with " + (data.stops?.length || 0) + " stops");
            if (!window.map) {
              send(msgType + " failed: map not ready");
              return;
            }
            
            // Initialize bus stop markers storage
            if (!window.__busStopMarkers) {
              window.__busStopMarkers = {};
            }
            
            // Render bus stops (prevent duplicates, validate structure)
            if (data.stops && Array.isArray(data.stops) && data.stops.length > 0) {
              let added = 0;
              data.stops.forEach(stop => {
                // Validate required fields
                if (!stop || !stop.id || !stop.lat || !stop.lng) {
                  send("SKIP: invalid stop structure");
                  return;
                }
                // Prevent duplicates
                if (window.__busStopMarkers[stop.id]) return;
                
                // Create visible marker with divIcon (like FullMap)
                const marker = L.marker([stop.lat, stop.lng], {
                  icon: L.divIcon({
                    className: "bus-stop-marker",
                    html: '<div class="stop-dot"></div>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                  })
                }).addTo(window.map);
                
                // Ensure markers are above tiles
                marker.setZIndexOffset(1000);
                
                // Add popup with detailed info
                marker.bindPopup(
                  '<div style="font-size:12px;">' +
                    '<strong>' + (stop.name || "Bus Stop") + '</strong><br/>' +
                    'Lat: ' + stop.lat.toFixed(5) + '<br/>' +
                    'Lng: ' + stop.lng.toFixed(5) +
                  '</div>'
                );
                
                window.__busStopMarkers[stop.id] = marker;
                added++;
              });
              
              // Fit map to show all stops (run once)
              if (!window.__stopsFitted && Object.keys(window.__busStopMarkers).length > 0) {
                const markers = Object.values(window.__busStopMarkers);
                const bounds = markers.map(function(m) { return m.getLatLng(); });
                window.map.fitBounds(bounds, { padding: [20, 20] });
                window.__stopsFitted = true;
                send(msgType + " fitBounds applied");
              }
              
              // Apply initial zoom-based visibility
              const currentZoom = window.map.getZoom();
              Object.values(window.__busStopMarkers).forEach(function(marker) {
                if (currentZoom < 15 && window.map.hasLayer(marker)) {
                  window.map.removeLayer(marker);
                }
              });
              
              send(msgType + " rendered: " + added + " new, " + Object.keys(window.__busStopMarkers).length + " total");
            } else {
              send(msgType + " no stops to render");
            }
            break;

          case "DRAW_ROUTE":
            // Pure renderer: only draws what RN sends, no calculations
            if (!window.map) {
              send("DRAW_ROUTE failed: map not ready");
              return;
            }
            
            if (!data.coords || !Array.isArray(data.coords)) {
              send("DRAW_ROUTE failed: no coordinates");
              return;
            }
            
            // Block straight-line artifacts (<= 2 points)
            if (data.coords.length <= 2) {
              send("DRAW_ROUTE blocked: too few points (straight-line artifact)");
              return;
            }
            
            // Remove previous route before drawing new
            if (window.__routeLayer) {
              window.map.removeLayer(window.__routeLayer);
              window.__routeLayer = null;
            }
            
            // Draw the route
            window.__routeLayer = L.polyline(data.coords, {
              color: '#007AFF',
              weight: 5,
              opacity: 0.9
            }).addTo(window.map);
            
            send("DRAW_ROUTE rendered: " + data.coords.length + " points");
            break;

          case "CLEAR_ROUTE":
            send("CLEAR_ROUTE received");
            // Remove route layer
            if (window.__routeLayer) {
              window.map.removeLayer(window.__routeLayer);
              window.__routeLayer = null;
            }
            send("Route cleared");
            break;

          default:
            send("UNKNOWN TYPE: " + data.type);
        }
      });
    }
    
    // Initialize route layer storage (pure renderer, no state)
    window.__routeLayer = null;
    
    // Initialize bus markers storage (view-only mode)
    window.busMarkers = {};
    
    // Process queued messages - ONLY ONCE
    if (!window.__queueProcessed) {
      window.__queueProcessed = true;
      processQueuedMessages();
    }

    // Send MAP_READY - ALWAYS (signals RN that WebView is ready)
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "MAP_READY" }));
    send("MAP READY"); // Also send log for debugging

  } catch (e) {
    send("ERROR: " + e.message);
  }
}); // DOMContentLoaded
  </script>
</body>
</html>
`;

  // Add ref for buses to resend on MAP_READY
  const busesRef = useRef(buses);

  // Keep ref in sync with props
  useEffect(() => {
    busesRef.current = buses;
  }, [buses]);

  // Compute nearest stop, fetch OSRM, and send DRAW_ROUTE
  useEffect(() => {
    if (!webViewRef.current) return;
    
    if (!showNearestRoute) {
      // Clear route when disabled
      webViewRef.current.postMessage(JSON.stringify({
        type: "CLEAR_ROUTE"
      }));
      return;
    }
    
    // Need user location and static stops
    if (!userLocation || !STATIC_STOPS || STATIC_STOPS.length === 0) {
      console.log("[RN] Cannot draw route: missing location or stops");
      return;
    }
    
    // Find nearest stop
    let nearest = null;
    let minDistance = Infinity;
    
    STATIC_STOPS.forEach(stop => {
      const dist = Math.sqrt(
        Math.pow(stop.lat - userLocation.latitude, 2) +
        Math.pow(stop.lng - userLocation.longitude, 2)
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearest = stop;
      }
    });
    
    if (!nearest) {
      console.log("[RN] No nearest stop found");
      return;
    }
    
    console.log("[RN] Nearest stop:", nearest.name, "distance:", minDistance);
    
    // Fetch OSRM route
    const osrmUrl = `https://router.project-osrm.org/route/v1/walking/` +
      `${userLocation.longitude},${userLocation.latitude};` +
      `${nearest.lng},${nearest.lat}` +
      `?overview=full&geometries=geojson`;
    
    console.log("[RN] Fetching OSRM route...");
    
    fetch(osrmUrl)
      .then(res => res.json())
      .then(data => {
        if (data.routes && data.routes.length > 0 && data.routes[0].geometry) {
          const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          
          // Send DRAW_ROUTE with OSRM coordinates
          webViewRef.current.postMessage(JSON.stringify({
            type: "DRAW_ROUTE",
            coords: coords
          }));
          console.log("[RN] DRAW_ROUTE sent with OSRM coords:", coords.length);
        } else {
          console.log("[RN] OSRM returned no route");
        }
      })
      .catch(err => {
        console.log("[RN] OSRM fetch error:", err.message);
      });
  }, [showNearestRoute, userLocation]);

  // Add refs for bounds debounce
  const boundsDebounceRef = useRef(null);
  const lastBoundsRef = useRef(null);

  // Fetch stops with bounds
  const fetchStopsWithBounds = async (bounds) => {
    try {
      const url = `${API_BASE_URL}/api/bus-stops?minLat=${bounds.minLat}&maxLat=${bounds.maxLat}&minLng=${bounds.minLng}&maxLng=${bounds.maxLng}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.success && webViewRef.current) {
        const mergedStops = mergeStops(data.stops);
        webViewRef.current.postMessage(JSON.stringify({
          type: "INIT_BUS_STOPS",
          stops: mergedStops
        }));
        console.log("[RN] Fetched stops with bounds:", data.count, "merged:", mergedStops.length);
      }
    } catch (error) {
      console.log("[RN] Bounds fetch error:", error.message);
    }
  };

  // Static bus stops (manual coordinates)
  const STATIC_STOPS = [
    // VELLORE DISTRICT
    { id: "vellore_1", name: "Vellore New Bus Station", lat: 12.9346, lng: 79.1366 },
    { id: "vellore_2", name: "Vellore Old Bus Stand", lat: 12.9223, lng: 79.1325 },
    { id: "vellore_3", name: "Vellore Smart City Bus Stand", lat: 12.9347, lng: 79.1376 },
    { id: "vellore_4", name: "CMC Jubilee Gate", lat: 12.9245, lng: 79.1376 },
    { id: "vellore_5", name: "Vallalar Bus Stop", lat: 12.9383, lng: 79.1669 },
    { id: "vellore_6", name: "Thottapalayam Bus Stand", lat: 12.9244, lng: 79.1273 },
    { id: "vellore_7", name: "TNSTC Depot Vellore", lat: 12.9245, lng: 79.1149 },
    { id: "vellore_8", name: "Sainathapuram Bus Stop", lat: 12.8970, lng: 79.1352 },
    { id: "vellore_9", name: "Katpadi Bus Stand", lat: 12.9672, lng: 79.1374 },
    // THIRUVALLUR DISTRICT
    { id: "tvlr_1", name: "Thiruvallur Bus Stand", lat: 13.1386, lng: 79.9076 },
    { id: "tvlr_2", name: "Thiruvallur Terminal", lat: 13.1405, lng: 79.9080 },
    { id: "tvlr_3", name: "Oil Mill Bus Stop", lat: 13.1227, lng: 79.9118 },
    { id: "tvlr_4", name: "Theradi Bus Stop", lat: 13.1433, lng: 79.9088 },
    { id: "tvlr_5", name: "Court Bus Stop", lat: 13.1370, lng: 79.9176 },
    { id: "tvlr_6", name: "Kakkalur Bus Stand", lat: 13.1227, lng: 79.9118 },
    { id: "tvlr_7", name: "Manavalanagar Bus Stop", lat: 13.1126, lng: 79.9133 },
    { id: "tvlr_8", name: "Ondikuppam Bus Stop", lat: 13.1104, lng: 79.9180 },
    { id: "tvlr_9", name: "SBI JN Road Bus Stop", lat: 13.1354, lng: 79.9087 }
  ];

  // Deduplicate stops by proximity (±0.0005)
  const mergeStops = (osmStops) => {
    if (!osmStops || !Array.isArray(osmStops)) return STATIC_STOPS;

    const merged = [...STATIC_STOPS];
    const proximityThreshold = 0.0005;

    osmStops.forEach(osmStop => {
      if (!osmStop || !osmStop.lat || !osmStop.lng) return;

      const isDuplicate = merged.some(staticStop => {
        const latDiff = Math.abs(staticStop.lat - osmStop.lat);
        const lngDiff = Math.abs(staticStop.lng - osmStop.lng);
        return latDiff < proximityThreshold && lngDiff < proximityThreshold;
      });

      if (!isDuplicate) {
        merged.push(osmStop);
      }
    });

    return merged;
  };

  // Handle messages from WebView - safe switch-based handler
  const handleWebViewMessage = (event) => {
    // Debug: Log all raw messages
    console.log("[RN MiniMap] RAW MESSAGE:", event?.nativeEvent?.data);

    let data;

    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      console.log("[RN MiniMap] Failed to parse message");
      return;
    }

    if (!data || !data.type) {
      console.log("[RN MiniMap] No data or type in message");
      return;
    }

    console.log("[RN MiniMap] Parsed type:", data.type);

    switch (data.type) {
      case "MAP_READY":
        console.log("[RN MiniMap] MAP_READY received - sending INIT_BUS_STOPS");
        setWebViewReady(true);
        
        // Send INIT_BUS_STOPS when map is ready
        if (webViewRef.current && STATIC_STOPS?.length > 0) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "INIT_BUS_STOPS",
            stops: STATIC_STOPS
          }));
          console.log("[RN MiniMap] INIT_BUS_STOPS sent:", STATIC_STOPS.length);
        }
        break;

      case "LOG":
        console.log("[WEBVIEW]", data.message);
        break;

      case "SET_FOLLOW":
        console.log("[RN MiniMap] SET_FOLLOW:", data.busId);
        setFollowBusId(data.busId || null);
        break;

      default:
        console.log("[RN MiniMap] Unknown message type:", data.type);
    }
  };

  // Fallback: Send INIT_BUS_STOPS after delay if MAP_READY wasn't received
  useEffect(() => {
    if (!webViewRef.current) return;

    const timer = setTimeout(() => {
      if (webViewRef.current && STATIC_STOPS?.length > 0) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "INIT_BUS_STOPS",
          stops: STATIC_STOPS
        }));
        console.log("[RN MiniMap] FALLBACK INIT_BUS_STOPS sent:", STATIC_STOPS.length);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View>
      <View style={{ height: 200 }}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          allowFileAccess
          allowUniversalAccessFromFileURLs
          allowFileAccessFromFileURLs
          androidLayerType="hardware"
          onMessage={handleWebViewMessage}
          source={{ html: mapHTML }}
          style={{ flex: 1 }}
        />
      </View>
      {/* Action Buttons Below Map */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
        <TouchableOpacity
          style={[styles.actionButton, { flex: 1 }]}
          onPress={() => {
            console.log("[RN] RECENTER pressed");
            console.log("WebView ref:", webViewRef.current);
            webViewRef.current?.postMessage(JSON.stringify({ type: "RECENTER" }));
          }}
        >
          <Text style={styles.actionButtonText}>⌖</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { flex: 2 }]}
          onPress={onPress}
        >
          <Text style={styles.actionButtonText}>Full Map</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}, () => true);

const HomeScreen = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState(DEFAULT_CENTER);
  const [showNearestRoute, setShowNearestRoute] = useState(false);
  const { buses, socket, busStops } = useBus();
  
  // Local follow state (single source of truth for this screen)
  const [followBusId, setFollowBusId] = useState(null);
  
  // Get followed bus data for speedometer
  const followedBus = followBusId ? buses[followBusId] : null;
  const [sosAlerts, setSosAlerts] = useState([]);
  const webViewRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const messageQueueRef = useRef({});
  const lastSentRef = useRef(null);
  const lastUserLocationRef = useRef(null); // Cache for resend on WebView load
  const busStopsRef = useRef(null); // Cache bus stops for resend
  const [webViewReady, setWebViewReady] = useState(false);
  const hasMapInitialized = useRef(false);

  // Track alerted SOS buses to prevent duplicate alerts
  const alertedSOS = useRef(new Set());

  // Send USER_LOCATION to MiniMap WebView when location changes
  useEffect(() => {
    if (!userLocation) return;

    // Cache in ref for resend on WebView load
    lastUserLocationRef.current = {
      lat: userLocation.latitude,
      lng: userLocation.longitude,
    };

    // Send to MiniMap WebView
    const msg = {
      type: "USER_LOCATION",
      lat: userLocation.latitude,
      lng: userLocation.longitude
    };

    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
      console.log("[RN] Sent USER_LOCATION to MiniMap:", userLocation.latitude, userLocation.longitude);
    }
  }, [userLocation, webViewReady]);

  // Send FOLLOW_UPDATE to MiniMap WebView when followBusId changes
  useEffect(() => {
    const msg = {
      type: "FOLLOW_UPDATE",
      busId: followBusId,
    };

    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
      console.log("[RN] Sent FOLLOW_UPDATE to MiniMap:", followBusId);
    }
  }, [followBusId]);

  // Send BUS_UPDATE to WebView when buses change
  useEffect(() => {
    if (!webViewRef.current) {
      console.log("[RN] Skipping bus update - no WebView ref");
      return;
    }

    // Convert buses object to array and filter active buses with valid coordinates

    const busesArray = buses ? Object.values(buses) : [];

    console.log("[RN] Buses state raw:", buses);

    console.log("[RN] Buses array count:", busesArray.length);

    console.log("[RN] Buses sample:", busesArray.slice(0, 2));
    
    const activeBuses = busesArray.filter(bus =>
      bus &&
      bus.busId &&
      bus.lat &&
      bus.lng
    );
    
    console.log("[RN] Active buses for MiniMap:", activeBuses.length);

    // ORDER-INDEPENDENT + NOISE-REDUCED SIGNATURE
    const signature = activeBuses
      .slice()
      .sort((a, b) => (a.busId > b.busId ? 1 : -1))
      .map(b =>
        b.busId +
        "_" +
        b.lat.toFixed(5) +
        "_" +
        b.lng.toFixed(5)
      )
      .join("|");

    // Skip identical updates
    if (lastSentRef.current === signature) return;
    lastSentRef.current = signature;

    const payload = JSON.stringify({
      type: "BUS_UPDATE",
      buses: activeBuses,
    });

    console.log("[RN] Sending BUS_UPDATE - count:", activeBuses.length);
    console.log("[RN] Payload preview:", payload.substring(0, 200));

    // Primary send
    webViewRef.current.postMessage(payload);
    console.log("[RN] postMessage called for BUS_UPDATE");
    activeBuses.forEach(function(bus) {
      console.log("[RN → MiniMap BUS_UPDATE]", bus.busId, bus.lat, bus.lng);
    });

    // Clear previous retry (prevents stacking under rapid updates)
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    // Retry with LATEST data (prevents stale resend)
    retryTimeoutRef.current = setTimeout(() => {
      const ref = webViewRef.current;
      if (!ref) return;

      const latestBusesArray = buses ? Object.values(buses) : [];
      const latestActiveBuses = latestBusesArray.filter(bus =>
        bus &&
        bus.busId &&
        bus.lat &&
        bus.lng
      );

      const latestPayload = JSON.stringify({
        type: "BUS_UPDATE",
        buses: latestActiveBuses,
      });

      ref.postMessage(latestPayload);
      console.log("[RN] Retry send active buses:", latestActiveBuses.length);
    }, 300);
  }, [buses]);

  // Socket listener for BUS_LOCATION_UPDATE - forward to MiniMap WebView
  useEffect(() => {
    if (!socket) return;

    const handleBusLocationUpdate = (data) => {
      console.log("[RN HomeScreen] BUS_LOCATION_UPDATE received:", data);
      
      // Forward to MiniMap WebView
      if (webViewRef.current && data && data.busId && data.lat != null && data.lng != null) {
        webViewRef.current.postMessage(JSON.stringify({
          type: "BUS_LOCATION_UPDATE",
          busId: data.busId,
          lat: data.lat,
          lng: data.lng
        }));
        console.log("[RN → MiniMap] BUS_LOCATION_UPDATE forwarded:", data.busId);
      }
    };

    socket.on("BUS_LOCATION_UPDATE", handleBusLocationUpdate);
    console.log("[RN HomeScreen] BUS_LOCATION_UPDATE listener registered");

    return () => {
      socket.off("BUS_LOCATION_UPDATE", handleBusLocationUpdate);
    };
  }, [socket, webViewReady]);

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Fetch bus stops once and send to WebView
  useEffect(() => {
    const fetchBusStops = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/bus-stops`);
        const data = await response.json();

        if (data.success && data.stops) {
          const mergedStops = mergeStops(data.stops);
          console.log("[RN] Fetched bus stops:", data.count, "merged:", mergedStops.length);

          // Store for resend on WebView reload
          busStopsRef.current = mergedStops;

          // Send to WebView if ready
          if (webViewRef.current && webViewReady) {
            webViewRef.current.postMessage(JSON.stringify({
              type: "INIT_BUS_STOPS",
              stops: mergedStops
            }));
          }
        }
      } catch (err) {
        console.log("[RN] Failed to fetch bus stops:", err.message);
      }
    };
    
    fetchBusStops();
  }, []); // Fetch only once on mount
  
  // Sync busStopsRef with prop when it changes (from useBus hook)
  useEffect(() => {
    if (busStops && busStops.length > 0) {
      busStopsRef.current = busStops;
      console.log("[RN MiniMap] busStopsRef updated:", busStops.length);
    }
  }, [busStops]);
  
  // Fetch user location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  // Safe sender to WebView with deduplicated queue
  const sendToWebView = useCallback((msg) => {
    if (!webViewRef.current || !webViewReady) {
      // Store only latest per key (prevents stale replay)
      const key = msg.busId || msg.type || "default";
      messageQueueRef.current[key] = msg;
      console.log("[RN] WebView not ready, message queued:", msg.type, key);
      return;
    }
    webViewRef.current.postMessage(JSON.stringify(msg));
  }, [webViewReady]);

  // Flush queued messages when WebView becomes ready
  useEffect(() => {
    if (!webViewReady || !webViewRef.current) return;
    
    const queue = messageQueueRef.current;
    const keys = Object.keys(queue);
    if (keys.length > 0) {
      console.log("[RN] Flushing", keys.length, "queued messages");
      keys.forEach(key => {
        webViewRef.current.postMessage(JSON.stringify(queue[key]));
      });
      messageQueueRef.current = {};
    }
  }, [webViewReady]);

  // Socket listener for BUS_OFFLINE - instant marker removal
  useEffect(() => {
    if (!socket) return;

    const handleBusOffline = (data) => {
      const busId = data?.busId;
      console.log("[RN] Bus offline:", busId);
      // Send to MiniMap WebView
      sendToWebView({ type: "BUS_OFFLINE", busId });
      // Emit global event for FullMap to receive
      DeviceEventEmitter.emit("BUS_OFFLINE_GLOBAL", { busId });
    };

    socket.on("BUS_OFFLINE", handleBusOffline);

    // SOS Triggered - emergency state
    const handleSosTriggered = (data) => {
      const busId = data?.busId;
      console.log("[RN] SOS triggered:", busId, "lat:", data?.lat, "lng:", data?.lng);
      // Send to MiniMap WebView
      sendToWebView({ type: "SOS_TRIGGERED", busId, lat: data?.lat, lng: data?.lng });
      // Emit global event for FullMap
      DeviceEventEmitter.emit("SOS_TRIGGERED_GLOBAL", { busId, lat: data?.lat, lng: data?.lng });
    };
    socket.on("SOS_TRIGGERED", handleSosTriggered);

    // SOS Cleared - emergency resolved
    const handleSosCleared = (data) => {
      const busId = data?.busId;
      console.log("[RN] SOS cleared:", busId);
      // Send to MiniMap WebView
      sendToWebView({ type: "SOS_CLEARED", busId });
      // Emit global event for FullMap
      DeviceEventEmitter.emit("SOS_CLEARED_GLOBAL", { busId });
    };
    socket.on("SOS_CLEARED", handleSosCleared);

    // SOS Acknowledged - popup update only
    const handleSosAcknowledged = (data) => {
      const busId = data?.busId;
      console.log("[RN] SOS acknowledged:", busId);
      // Send to MiniMap WebView (popup update only)
      sendToWebView({ type: "SOS_ACKNOWLEDGED", busId });
      // Emit global event for FullMap
      DeviceEventEmitter.emit("SOS_ACKNOWLEDGED_GLOBAL", { busId });
    };
    socket.on("SOS_ACKNOWLEDGED", handleSosAcknowledged);

    return () => {
      socket.off("BUS_OFFLINE", handleBusOffline);
      socket.off("SOS_TRIGGERED", handleSosTriggered);
      socket.off("SOS_CLEARED", handleSosCleared);
      socket.off("SOS_ACKNOWLEDGED", handleSosAcknowledged);
    };
  }, [socket, sendToWebView]);

  // Convert buses object to array and filter active buses
  const busesArray = buses && typeof buses === 'object' && !Array.isArray(buses) 
    ? Object.values(buses) 
    : (buses || []);
  
  const filteredBuses = busesArray.filter(
    bus => bus && bus.trackingActive === true
  );

  // Navigate to full map
  const handleMapPress = () => {
    navigation.navigate("FullMap", {
      buses: filteredBuses,
      userLocation: userLocation
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>V-Bus</Text>
          <Text style={styles.subtitle}>Smart Campus Transport</Text>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search bus or route..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Nearest Bus Stop Card */}
        <BusStopCard
          stopName="VIT Main Gate"
          distance="200m"
          nextBusTime="2 min"
          onPress={() => console.log("Stop pressed")}
        />

        {/* Mini Map */}
        <View style={styles.mapSection}>
          <Text style={styles.sectionTitle}>Live Tracking</Text>
          <Text style={styles.busCount}>{filteredBuses.length} buses nearby</Text>
          <MiniMap
            webViewRef={webViewRef}
            setWebViewReady={setWebViewReady}
            onPress={handleMapPress}
            buses={filteredBuses}
            userLocation={userLocation}
            followBusId={followBusId}
            setFollowBusId={setFollowBusId}
            busStops={busStops}
            showNearestRoute={showNearestRoute}
            setShowNearestRoute={setShowNearestRoute}
          />
        </View>
      </ScrollView>
      
      {/* Speedometer Overlay - only visible when following a bus */}
      {followBusId && followedBus && (
        <Speedometer
          key={followBusId}
          speed={followedBus.speed}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5D7A1",
  },

  scrollView: {
    flex: 1,
  },

  header: {
    padding: 16,
    paddingTop: 40,
  },

  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#000",
  },

  subtitle: {
    fontSize: 12,
    color: "#333",
  },

  searchContainer: {
    margin: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  searchInput: {
    fontSize: 16,
  },

  stopCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  stopIconContainer: {
    marginRight: 10,
  },

  stopIcon: {                 
    fontSize: 18,
  },

  stopInfo: {
    flex: 1,
  },

  stopName: {
    fontWeight: "bold",
    fontSize: 14,
  },

  stopDistance: {
    fontSize: 12,
    color: "#666",
  },

  nextBus: {
    fontSize: 12,
    color: "#333",
  },

  chevron: {
    fontSize: 18,
  },

  mapSection: {
    marginTop: 10,
  },

  sectionTitle: {
    marginLeft: 16,
    marginBottom: 6,
    fontWeight: "bold",
    fontSize: 16,
  },

  busCount: {
    marginLeft: 16,
    fontSize: 12,
    color: "#666",
  },

  miniMap: {
    height: 180,
    margin: 16,
    borderRadius: 12,
    overflow: "hidden",
  },

  mapContainer: {
    height: 200,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },

  zoomControls: {
    position: "absolute",
    right: 8,
    top: 8,
    flexDirection: "column",
    gap: 4,
  },

  actionButton: {
    backgroundColor: "white",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },

  actionButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },

  zoomButton: {
    width: 32,
    height: 32,
    backgroundColor: "white",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },

  zoomText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },

  fullMapButton: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },

  fullMapText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },

});

export default HomeScreen;
