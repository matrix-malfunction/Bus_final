import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { StyleSheet, View, TouchableOpacity, Text } from "react-native";
import { WebView } from "react-native-webview";
import { useBus } from "./BusContext";

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
  const [webViewReady, setWebViewReady] = useState(false);

  // Default center (Chennai) - prevents crash when no route params
  const DEFAULT_CENTER = { latitude: 13.0827, longitude: 80.2707 };
  const { buses: contextBuses, followBusId, setFollowBusId, setUserLocation } = useBus();
  const { buses: routeBuses, userLocation: routeUserLocation, center: routeCenter } = route?.params || {};

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
        return {
          ...bus,
          latitude,
          longitude,
          lat: latitude,
          lng: longitude,
          busId: bus.busId || bus._id
        };
      })
      .filter(Boolean);
  }, [routeBuses, contextBuses]);

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
        // Use 50ms delay to ensure state is fresh, then read from contextBuses directly
        setTimeout(() => {
          if (!webViewRef.current) return;

          // Get latest buses directly from context to avoid stale closure
          const latestBuses = Object.values(contextBuses || {});
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

      // FOLLOW_STOPPED from WebView (user dragged map)
      if (data.type === "FOLLOW_STOPPED") {
        console.log("[FullMap] FOLLOW_STOPPED from WebView");
        setFollowBusId(null);
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
            
            // 2b) SMOOTH CAMERA FOLLOW STATE
            window.__followState = {
              lastUpdate: 0,
              lastLat: null,
              lastLng: null,
              isAnimating: false,
              isFollowing: false
            };
            
            // Stop follow on user drag
            window.map.on('dragstart', function() {
              if (window.__followBusId) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'FOLLOW_STOPPED',
                  reason: 'USER_DRAG'
                }));
              }
            });

            // 3) GLOBAL STATE (AFTER MAP INIT)
            window.busMarkers = {};
            window.userMarker = null;
            window.__followBusId = null;
            window.userLocation = null;
            window.__pendingBusStopRender = false;

            // 3) BUS ICON with embedded speed badge (static - never recreated)
            // Badge is hidden by default, shown/hidden via DOM manipulation only
            const busIconWithBadge = L.divIcon({
              html: '<div style="position:relative;">' +
                      '<div style="font-size:28px;background:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(0,0,0,0.3);cursor:pointer;">🚌</div>' +
                      '<div class="speed-badge" style="display:none;position:absolute;top:-20px;left:50%;transform:translateX(-50%);background:#007AFF;color:white;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:bold;white-space:nowrap;z-index:1000;"></div>' +
                    '</div>',
              className: 'bus-marker-with-speed',
              iconSize: [36, 50],
              iconAnchor: [18, 36]
            });
            
            // SPEED BADGE UPDATE FUNCTIONS
            // Rebind element if missing (defensive)
            function bindSpeedEl(marker) {
              if (!marker.__speedEl) {
                const el = marker.getElement();
                if (el) {
                  marker.__speedEl = el.querySelector('.speed-badge');
                }
              }
              return marker.__speedEl;
            }
            
            // Speed thresholds (m/s)
            const SPEED_MEDIUM = 5 / 3.6;   // ~1.39 m/s = 5 km/h
            const SPEED_HIGH = 20 / 3.6;    // ~5.56 m/s = 20 km/h
            const SPEED_VERY_HIGH = 40 / 3.6; // ~11.11 m/s = 40 km/h
            
            function getSpeedClass(speedMps) {
              if (speedMps === undefined || speedMps === null) return '';
              if (speedMps < SPEED_MEDIUM) return 'speed-low';
              if (speedMps < SPEED_HIGH) return 'speed-medium';
              if (speedMps < SPEED_VERY_HIGH) return 'speed-high';
              return 'speed-very-high';
            }
            
            function updateSpeedBadge(busId, speed) {
              const marker = window.busMarkers[busId];
              if (!marker) return;
              
              const speedEl = bindSpeedEl(marker);
              if (!speedEl) return;
              
              if (window.__followBusId === busId) {
                // Update text (placeholder if speed undefined)
                speedEl.textContent = speed !== undefined ? Math.round(speed * 3.6) + ' km/h' : '-- km/h';
                speedEl.style.display = 'block';
                
                // Remove old speed classes
                speedEl.classList.remove('speed-low', 'speed-medium', 'speed-high', 'speed-very-high');
                
                // Add new speed class (only if speed defined)
                if (speed !== undefined) {
                  const newClass = getSpeedClass(speed);
                  if (newClass) {
                    speedEl.classList.add(newClass);
                  }
                }
              }
            }
            
            function hideSpeedBadge(busId) {
              const marker = window.busMarkers[busId];
              if (!marker) return;
              
              const speedEl = bindSpeedEl(marker);
              if (speedEl) {
                speedEl.style.display = 'none';
              }
            }
            
            // SMOOTH CAMERA FOLLOW with event-based synchronization
            function smoothFollowCamera(lat, lng) {
              if (!window.map) return;
              
              const state = window.__followState;
              
              // Skip if animation in progress (prevent overlap/jitter)
              if (state.isAnimating) return;
              
              const now = Date.now();
              
              // Calculate distance from last position
              let distance = 0;
              if (state.lastLat !== null && state.lastLng !== null) {
                distance = haversineMeters(state.lastLat, state.lastLng, lat, lng);
              }
              
              // Hybrid throttle: time (300ms) OR distance (>20m)
              const timeOk = now - state.lastUpdate > 300;
              const distanceOk = distance > 20;
              if (!timeOk && !distanceOk && state.lastLat !== null) return;
              
              // Always ignore tiny movements (<5m)
              if (distance < 5 && state.lastLat !== null) return;
              
              // Update state
              state.lastLat = lat;
              state.lastLng = lng;
              state.lastUpdate = now;
              state.isFollowing = true;
              
              // Determine animation duration based on distance
              // Large jumps (>30m) = faster (0.5s), small moves = slower (0.8s)
              const duration = distance > 30 ? 0.5 : 0.8;
              
              // Lock animation to prevent overlapping
              state.isAnimating = true;
              
              // Event-based unlock: reset when animation completes
              const onMoveEnd = function() {
                state.isAnimating = false;
                window.map.off('moveend', onMoveEnd);
              };
              window.map.once('moveend', onMoveEnd);
              
              // Smooth flyTo with dynamic duration, keep zoom constant
              const currentZoom = window.map.getZoom();
              window.map.flyTo([lat, lng], currentZoom, {
                animate: true,
                duration: duration,
                easeLinearity: 0.25
              });
            }
            
            function showSpeedBadge(busId) {
              const marker = window.busMarkers[busId];
              if (!marker) return;
              
              const speedEl = bindSpeedEl(marker);
              if (!speedEl) return;
              
              const speed = marker.__busData?.speed;
              
              if (speed === undefined) {
                // Speed not available yet - show placeholder
                speedEl.textContent = '-- km/h';
                speedEl.style.display = 'block';
              } else {
                // Speed available - use updateSpeedBadge for full styling
                updateSpeedBadge(busId, speed);
              }
            }
            
            // Legacy busIcon for fallback (not used with badge system)
            const busIcon = L.divIcon({
              html: '<div style="font-size:28px;background:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(0,0,0,0.3);cursor:pointer;">🚌</div>',
              className: '',
              iconSize: [36, 36],
              iconAnchor: [18, 36]
            });

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

            // Speed shown only for followed bus
            function createPopupHTML(bus) {
              const eta = bus.eta ? Math.round(bus.eta) : "--";
              const isFollowing = window.__followBusId === (bus.busId || bus.id);
              const checkedAttr = isFollowing ? 'checked' : '';
              const labelText = isFollowing ? 'Following' : 'Follow';
              const busId = bus.busId || bus.id;
              
              // Speed visible only for followed bus
              const speedHtml = isFollowing && bus.speed !== undefined
                ? '<div class="bus-popup-row">Speed: ' + Math.round(bus.speed * 3.6) + ' km/h</div>'
                : '';
              
              return '<div class="bus-popup">' +
                '<div class="bus-popup-header">' + (bus.name || busId || "Bus") + '</div>' +
                '<div class="bus-popup-row">ETA: ' + eta + ' min</div>' +
                speedHtml +
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

              const activeIds = new Set(Object.keys(buses));

              // Followed bus went offline - reset follow state
              if (window.__followBusId && !activeIds.has(window.__followBusId)) {
                // Reset speedometer when followed bus goes offline
                resetSpeedometer();
                
                window.__followBusId = null;
                
                // Reset camera follow state
                const offlineState = window.__followState;
                offlineState.lastLat = null;
                offlineState.lastLng = null;
                offlineState.lastUpdate = 0;
                offlineState.isAnimating = false;
                offlineState.isFollowing = false;

                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "FOLLOW_STOPPED",
                  reason: "BUS_OFFLINE"
                }));
              }

              // Remove stale markers
              Object.keys(window.busMarkers).forEach(function(id) {
                if (!activeIds.has(id)) {
                  window.map.removeLayer(window.busMarkers[id]);
                  delete window.busMarkers[id];
                }
              });

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
                const busData = { ...bus, eta, busId: id };

                if (window.busMarkers[id]) {
                  // UPDATE EXISTING MARKER - no recreation
                  const marker = window.busMarkers[id];
                  marker.setLatLng(latlng);

                  // Store full bus data on marker for optimistic updates
                  marker.__busData = { ...bus, id, eta: busData.eta };

                  // Update popup content for all markers (keeps popup in sync)
                  updateBusPopup(marker, busData);

                  // Update speed badge if this is the followed bus
                  if (window.__followBusId === id) {
                    updateSpeedBadge(id, bus.speed);
                  }

                  // Update z-index based on follow state
                  if (window.__followBusId === id) {
                    marker.setZIndexOffset(1000);
                  } else if (bus.sos) {
                    marker.setZIndexOffset(2000);
                  } else {
                    marker.setZIndexOffset(0);
                  }
                } else {
                  // CREATE NEW MARKER - only once (in busesPane for z-order)
                  // Use busIconWithBadge for speed badge support
                  const marker = L.marker(latlng, { icon: busIconWithBadge, pane: 'busesPane' }).addTo(window.map);
                  
                  // Cache speed element reference immediately
                  const el = marker.getElement();
                  if (el) {
                    marker.__speedEl = el.querySelector('.speed-badge');
                  }

                  // Store full bus data on marker for optimistic updates
                  marker.__busData = { ...bus, id, eta: busData.eta };

                  // Show speed badge if this bus is already being followed
                  if (window.__followBusId === id) {
                    showSpeedBadge(id);
                  }

                  // Update speedometer ONLY if this bus is being followed
                  if (window.__followBusId === id && bus.speed !== undefined) {
                    updateSpeedometer(busData);
                  }

                  // Click to select
                  marker.on("click", function() {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: "BUS_SELECTED",
                      busId: id
                    }));
                  });

                  // Bind popup with modern UI (only once, in busPopupPane)
                  // autoClose: false and closeOnClick: false for persistent popup
                  marker.bindPopup(createPopupHTML(busData), { 
                    pane: 'busPopupPane',
                    autoClose: false,
                    closeOnClick: false
                  });

                  // Set z-index
                  if (bus.sos) {
                    marker.setZIndexOffset(2000);
                  }

                  window.busMarkers[id] = marker;
                }

                // Update popup content for all markers (keeps popup in sync)
                updateBusPopup(window.busMarkers[id], busData);

                // SMOOTH CAMERA FOLLOW for followed bus
                if (window.__followBusId === id) {
                  smoothFollowCamera(bus.lat, bus.lng);
                }
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

// Bus stop icon (lightweight small circle)
function createStopIcon(name) {
  return L.divIcon({
    html: '<div style="width:12px;height:12px;background:#e74c3c;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
    className: 'bus-stop-marker',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
}

// Create popup for bus stop
function createStopPopup(stop) {
  return '<b>' + (stop.name || 'Bus Stop') + '</b><br>' +
    '<div style="margin-top:8px;font-size:12px;color:#666;">Buses at this stop:</div>' +
    '<div style="margin-top:4px;font-size:11px;color:#999;">Loading...</div>';
}

            // Get zoom bucket category
            function getZoomBucket(zoom) {
              if (zoom < 14) return "none";
              return "all";
            }

            // Render function with zoom-based filtering (optimized)
            window.renderBusStops = function() {
              if (!window.map || !window.__busStops.length) return;

              const zoom = window.map.getZoom();
              const bucket = getZoomBucket(zoom);

              // Skip render if bucket hasn't changed (but always render first time)
              if (bucket === window.__busStopZoomBucket && window.__busStopInitialized) return;

              // Update bucket
              window.__busStopZoomBucket = bucket;

              // zoom < 14: hide all stops
              if (bucket === "none") {
                window.map.removeLayer(window.busStopLayer);
                return;
              }

              // Show all stops at zoom >= 14
              const stopsToShow = window.__busStops;

              // Build set of visible stop IDs
              const visibleIds = {};
              stopsToShow.forEach(function(stop) {
                if (!stop || !stop.id) return;
                visibleIds[stop.id] = true;
              });

              // Hide markers not in current zoom bucket
              Object.keys(window.__busStopMarkers).forEach(function(stopId) {
                if (!visibleIds[stopId]) {
                  window.busStopLayer.removeLayer(window.__busStopMarkers[stopId]);
                }
              });

              // Show/create markers for visible stops
              stopsToShow.forEach(function(stop) {
                if (!stop || !stop.id || !stop.lat || !stop.lng) return;

                if (window.__busStopMarkers[stop.id]) {
                  // Marker exists, just show it
                  window.busStopLayer.addLayer(window.__busStopMarkers[stop.id]);
                } else {
                  // Create new marker and cache it
                  const marker = L.marker([stop.lat, stop.lng], {
                    icon: createStopIcon(stop.name),
                    pane: 'busStopsPane'
                  }).bindPopup(createStopPopup(stop), {
                    pane: 'busStopsPopupPane',
                    autoClose: true,
                    closeOnClick: true
                  });
                  window.__busStopMarkers[stop.id] = marker;
                  window.busStopLayer.addLayer(marker);
                }
              });

              // Show layer (only add if not already on map)
              if (!window.map.hasLayer(window.busStopLayer)) {
                window.map.addLayer(window.busStopLayer);
              }

              // Mark as initialized after first render
              window.__busStopInitialized = true;
            };

            // Zoom listener for dynamic filtering
            window.map.on('zoomend', window.renderBusStops);

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

            // 9) MESSAGE HANDLER
            function handleMessage(event) {
              let data;
              try {
                data = JSON.parse(event.data || "{}");
              } catch (e) {
                return;
              }
              if (!data || !window.map) return;

              switch (data.type) {
                case "INIT_BUS_STOPS":
                  if (!Array.isArray(data.stops)) {
                    console.log("[WEBVIEW] Invalid INIT_BUS_STOPS");
                    return;
                  }
                  window.__busStops = data.stops;
                  
                  // Check if map is ready
                  if (!window.map) {
                    console.log("[WEBVIEW] Map not ready, queuing bus stops");
                    window.__pendingBusStopRender = true;
                    return;
                  }
                  
                  // Reset for fresh render
                  window.__busStopZoomBucket = null;
                  window.__busStopInitialized = false;
                  window.renderBusStops();
                  console.log("[WEBVIEW] Bus stops loaded:", data.stops.length);
                  break;

                case "BUS_UPDATE":
                  // Normalize payload: handle both array and object formats
                  const buses = Array.isArray(data.buses)
                    ? Object.fromEntries(data.buses.map(b => [b.busId || b.id, b]))
                    : data.buses;
                  updateBusMarkers(buses || {});
                  break;

                case "USER_LOCATION":
                  console.log("[WEBVIEW] USER_LOCATION RECEIVED:", data.payload);
                  if (data.payload?.lat != null && data.payload?.lng != null) {
                    const lat = Number(data.payload.lat);
                    const lng = Number(data.payload.lng);
                    if (!isNaN(lat) && !isNaN(lng)) {
                      setUserLocation(lat, lng);
                    } else {
                      console.error("[WEBVIEW] Invalid lat/lng:", data.payload);
                    }
                  } else {
                    console.error("[WEBVIEW] Missing lat/lng in payload:", data.payload);
                  }
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
                    
                    // Reset camera follow state for new bus (prevents stale position interference)
                    const state = window.__followState;
                    state.lastLat = null;
                    state.lastLng = null;
                    state.lastUpdate = 0;
                    state.isAnimating = false;
                  }
                  
                  // ALWAYS enforce UI state (handles reloads, late markers, lost refs)
                  if (!newBusId) {
                    resetSpeedometer();
                  } else {
                    showSpeedBadge(newBusId);
                  }
                  break;

                case "FOLLOW_STOPPED":
                  // Hide speed badge for previously followed bus
                  if (window.__followBusId) {
                    hideSpeedBadge(window.__followBusId);
                  }
                  
                  window.__followBusId = null;
                  
                  // Reset camera follow state
                  const stopState = window.__followState;
                  stopState.lastLat = null;
                  stopState.lastLng = null;
                  stopState.lastUpdate = 0;
                  stopState.isAnimating = false;
                  stopState.isFollowing = false;
                  
                  // Reset speedometer when follow stops
                  resetSpeedometer();

                  if (data.reason === "BUS_OFFLINE") {
                    if (window.userMarker && window.map) {
                      const pos = window.userMarker.getLatLng();
                      window.map.flyTo(pos, 15, {
                        animate: true,
                        duration: 0.6
                      });
                    }
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

            // 10) STOP FOLLOW ON DRAG
            window.map.on("dragstart", () => {
              if (window.__followBusId) {
                window.__followBusId = null;
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "FOLLOW_STOPPED",
                  reason: "USER_DRAG"
                }));
              }
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
              
              // Process any pending bus stop render
              if (window.__pendingBusStopRender && window.__busStops && window.__busStops.length) {
                console.log("[WEBVIEW] Processing pending bus stop render");
                window.__pendingBusStopRender = false;
                if (window.renderBusStops) window.renderBusStops();
              }
              
              sendMapReady();
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
    <View style={styles.container}>
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
      <TouchableOpacity
        style={[styles.recenterButton, isRecentering && styles.recenterButtonActive]}
        onPress={handleRecenter}
        activeOpacity={0.8}
      >
        <Text style={styles.recenterIcon}>⌖</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  recenterButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 30,
    padding: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  recenterButtonActive: {
    backgroundColor: '#e0e0e0',
    transform: [{ scale: 0.9 }],
  },
  recenterIcon: {
    fontSize: 20,
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
