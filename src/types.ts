export interface CableFeature {
  id: string;
  name: string;
  color: string;
  paths: [number, number][][]; // array of paths, each [lat, lng][]
}

export interface LandingPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface LandDC {
  id: number;
  name: string;
  org: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  netCount: number;
}

export interface SubseaDC {
  id: string;
  name: string;
  operator: string;
  status: "operational" | "decommissioned" | "planned" | "pilot";
  status_note: string;
  lat: number;
  lng: number;
  depth_m: number;
  capacity_mw: number | null;
  capacity_note: string;
  coordinate_precision: "exact" | "approximate" | "unverified";
  coordinate_note: string;
  sources: string[];
  nearestLandingPoint: LandingPoint | null;
  nearestLandingPointDistanceKm: number | null;
}

export interface LayerToggles {
  cables: boolean;
  landDCs: boolean;
  subseaDCs: boolean;
  connectors: boolean;
  /** Real cable landing points -- explore mode only (see Globe.tsx's explorePointsData). */
  landingPoints: boolean;
}

export type Selection = { kind: "land"; data: LandDC } | { kind: "subsea"; data: SubseaDC };
