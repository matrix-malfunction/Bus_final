import { createContext, useContext, useMemo, useState } from "react";

const MapPreviewContext = createContext(null);

export function MapPreviewProvider({ children }) {
  const [mapPreviewData, setMapPreviewData] = useState({
    buses: [],
    center: { latitude: 12.8795, longitude: 77.1217 },
    userLocation: null,
  });

  const value = useMemo(
    () => ({
      mapPreviewData,
      setMapPreviewData,
    }),
    [mapPreviewData]
  );

  return <MapPreviewContext.Provider value={value}>{children}</MapPreviewContext.Provider>;
}

export function useMapPreview() {
  const context = useContext(MapPreviewContext);
  if (!context) {
    throw new Error("useMapPreview must be used within MapPreviewProvider");
  }
  return context;
}
