import { createContext, useContext } from "react";

export const BusContext = createContext({
  buses: [],
  sosAlerts: [],
  userLocation: null
});

export const useBusContext = () => useContext(BusContext);
