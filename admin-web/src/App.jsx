import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import io from "socket.io-client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const API_BASE_URL = "http://localhost:5000";

function App() {
  const [drivers, setDrivers] = useState([]);
  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [routeSchedule, setRouteSchedule] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadRouteName, setUploadRouteName] = useState("");
  const [liveBuses, setLiveBuses] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [sosBusId, setSosBusId] = useState(null);
  const mapRef = useRef();
  const hasFitted = useRef(false);

  const [driverForm, setDriverForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [busForm, setBusForm] = useState({
    busId: "",
    routeId: "",
  });
  const [routeForm, setRouteForm] = useState({
    name: "",
    stopsJson: "[]",
    scheduleJson: "[]",
  });

  async function callApi(url, options = {}) {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }
    return data;
  }

  const loadAll = useCallback(async () => {
    try {
      const [driversData, busesData, routesData] = await Promise.all([
        callApi("/api/admin/drivers"),
        callApi("/api/admin/buses"),
        callApi("/api/admin/routes"),
      ]);
      setDrivers(driversData.drivers || []);
      setBuses(busesData.buses || []);
      setRoutes(routesData.routes || []);
      setStatus("Data refreshed");
    } catch (error) {
      setStatus(error.message);
    }
  }, []);

  async function fetchRouteSchedule(routeId) {
    if (!routeId) return;
    try {
      const data = await callApi(`/api/admin/routes/${routeId}/schedule`);
      setRouteSchedule(data.stops || []);
      setStatus(`Loaded schedule for ${data.routeName}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const socket = io("http://localhost:5000");

    socket.on("busLocationUpdate", (bus) => {
      console.log("📡 BUS UPDATE:", bus);

      setLiveBuses((prev) => {
        const filtered = prev.filter((b) => b.busId !== bus.busId);
        return [...filtered, bus];
      });
    });

    socket.on("busETAUpdate", (data) => {
      setLiveBuses((prev) =>
        prev.map((b) =>
          b.busId === data.busId ? { ...b, nextStop: data.nextStop, eta: data.eta } : b
        )
      );
    });

    socket.on("sosAlert", (data) => {
      console.log("🚨 SOS:", data);
      setAlerts((prev) => [data, ...prev.slice(0, 4)]);
      setSosBusId(data.busId);
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (!mapRef.current || liveBuses.length === 0) return;

    const bounds = liveBuses.map((b) => [b.lat, b.lng]);

    if (!hasFitted.current) {
      mapRef.current.fitBounds(bounds);
      hasFitted.current = true;
    } else {
      // only pan, not zoom (smooth)
      mapRef.current.panTo(bounds[0]);
    }
  }, [liveBuses]);

  const busIcon = new L.Icon({
    iconUrl: "https://cdn-icons-png.flaticon.com/512/61/61231.png",
    iconSize: [32, 32],
  });

  async function createDriver() {
    try {
      await callApi("/api/admin/drivers", {
        method: "POST",
        body: JSON.stringify(driverForm),
      });
      setDriverForm({ name: "", email: "", password: "" });
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteDriver(id) {
    try {
      await callApi(`/api/admin/drivers/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function createBus() {
    try {
      await callApi("/api/admin/buses", {
        method: "POST",
        body: JSON.stringify({
          busId: busForm.busId,
          routeId: busForm.routeId || null,
        }),
      });
      setBusForm({ busId: "", routeId: "" });
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteBus(id) {
    try {
      await callApi(`/api/admin/buses/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function createRoute() {
    try {
      await callApi("/api/admin/routes", {
        method: "POST",
        body: JSON.stringify({
          name: routeForm.name,
          stops: JSON.parse(routeForm.stopsJson || "[]"),
          schedule: JSON.parse(routeForm.scheduleJson || "[]"),
        }),
      });
      setRouteForm({ name: "", stopsJson: "[]", scheduleJson: "[]" });
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteRoute(id) {
    try {
      await callApi(`/api/admin/routes/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function uploadSchedule() {
    if (!uploadFile) {
      setStatus("Please choose an .xlsx file first");
      return;
    }
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      if (uploadRouteName.trim()) {
        form.append("routeName", uploadRouteName.trim());
      }

      const response = await fetch(`${API_BASE_URL}/api/admin/upload-schedule`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Upload failed");
      }

      setStatus(`Uploaded schedule: ${data.stopsCreated} stops`);
      setUploadFile(null);
      setUploadRouteName("");
      await loadAll();
      if (data.routeId) {
        setSelectedRouteId(String(data.routeId));
        await fetchRouteSchedule(String(data.routeId));
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <div style={{ backgroundColor: "#121212", color: "#fff", height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "#fff",
          padding: 10,
          borderRadius: 10,
          color: "#000",
          zIndex: 1000,
        }}
      >
        <h4>🚨 SOS Alerts</h4>
        {alerts.map((a, i) => (
          <div key={i}>Bus {a.busId}</div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          background: "#fff",
          padding: 10,
          borderRadius: 10,
          color: "#000",
          zIndex: 1000,
        }}
      >
        Active Buses: {liveBuses.length}
      </div>

      <div className="page">
        <MapContainer
          whenCreated={(map) => (mapRef.current = map)}
          center={[12.87, 79.12]}
          zoom={13}
          style={{ height: "300px", width: "100%", marginBottom: "20px" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {liveBuses.map((bus) => (
            <Marker
              key={bus.busId}
              position={[bus.lat, bus.lng]}
              icon={
                new L.Icon({
                  iconUrl:
                    bus.busId === sosBusId
                      ? "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png"
                      : "https://cdn-icons-png.flaticon.com/512/61/61231.png",
                  iconSize: [32, 32],
                })
              }
            >
              <Popup>
                <b>{bus.busId}</b>
                <br />
                Next Stop: {bus.nextStop || "N/A"}
                <br />
                ETA: {bus.eta || "--"} mins
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        <h1>Admin Panel MVP</h1>
        <p className="status">{status}</p>
        <button onClick={loadAll}>Refresh</button>

        <section className="card">
        <h2>Drivers</h2>
        <div className="grid">
          <input
            placeholder="Name"
            value={driverForm.name}
            onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })}
          />
          <input
            placeholder="Email"
            value={driverForm.email}
            onChange={(e) => setDriverForm({ ...driverForm, email: e.target.value })}
          />
          <input
            placeholder="Password"
            type="password"
            value={driverForm.password}
            onChange={(e) => setDriverForm({ ...driverForm, password: e.target.value })}
          />
          <button onClick={createDriver}>Add Driver</button>
        </div>
        {drivers.map((driver) => (
          <div className="item" key={driver._id}>
            <span>
              {driver.name} ({driver.email})
            </span>
            <button onClick={() => deleteDriver(driver._id)}>Delete</button>
          </div>
        ))}
        </section>

        <section className="card">
        <h2>Buses</h2>
        <div className="grid">
          <input
            placeholder="Bus ID"
            value={busForm.busId}
            onChange={(e) => setBusForm({ ...busForm, busId: e.target.value })}
          />
          <input
            placeholder="Route ID (optional)"
            value={busForm.routeId}
            onChange={(e) => setBusForm({ ...busForm, routeId: e.target.value })}
          />
          <button onClick={createBus}>Add Bus</button>
        </div>
        {buses.map((bus) => (
          <div className="item" key={bus._id}>
            <span>
              {bus.busId} | Route: {bus.routeId?.name || bus.routeId || "-"}
            </span>
            <button onClick={() => deleteBus(bus._id)}>Delete</button>
          </div>
        ))}
        </section>

        <section className="card">
        <h2>Routes</h2>
        <div className="grid">
          <input
            placeholder="Route Name"
            value={routeForm.name}
            onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })}
          />
          <textarea
            placeholder='Stops JSON (e.g. [{"name":"Stop A","lat":12.9,"lng":77.5}])'
            value={routeForm.stopsJson}
            onChange={(e) => setRouteForm({ ...routeForm, stopsJson: e.target.value })}
          />
          <textarea
            placeholder='Schedule JSON (e.g. [{"stopName":"Stop A","time":"08:30"}])'
            value={routeForm.scheduleJson}
            onChange={(e) => setRouteForm({ ...routeForm, scheduleJson: e.target.value })}
          />
          <button onClick={createRoute}>Add Route</button>
        </div>
        {routes.map((route) => (
          <div className="item" key={route._id}>
            <span>
              {route.name} | Stops: {route.stops?.length || 0} | Schedules: {route.schedule?.length || 0}
            </span>
            <button onClick={() => deleteRoute(route._id)}>Delete</button>
          </div>
        ))}
        </section>

        <section className="card">
        <h2>Upload Route Schedule (.xlsx)</h2>
        <div className="grid">
          <input
            placeholder="Route Name (optional)"
            value={uploadRouteName}
            onChange={(e) => setUploadRouteName(e.target.value)}
          />
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
          />
          <button onClick={uploadSchedule}>Upload Schedule</button>
        </div>
        </section>

        <section className="card">
        <h2>Route Stops & Timings</h2>
        <div className="grid">
          <select
            value={selectedRouteId}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedRouteId(nextId);
              fetchRouteSchedule(nextId);
            }}
          >
            <option value="">Select route</option>
            {routes.map((route) => (
              <option key={route._id} value={route._id}>
                {route.name}
              </option>
            ))}
          </select>
        </div>
        {routeSchedule.map((stop, index) => (
          <div className="item" key={stop.stopId || index}>
            <span>
              #{stop.order} {stop.name} | {stop.time || "N/A"} | {stop.latitude}, {stop.longitude}
            </span>
          </div>
        ))}
        </section>
      </div>
    </div>
  );
}

export default App;
