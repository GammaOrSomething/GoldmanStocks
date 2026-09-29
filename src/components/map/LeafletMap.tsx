import "leaflet/dist/leaflet.css";

import { Link } from "@tanstack/react-router";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import {
  LayersControl,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { plantPosition, type LatLng } from "@/lib/geo";
import { statusLabel } from "@/lib/labels";
import type { Plant, PlantStatus, Project } from "@/lib/types";

/**
 * The real map, browser-only: Leaflet touches `window` when it loads, so this module is only
 * ever imported lazily through ./index.tsx.
 *
 * Street tiles: OpenStreetMap. Satellite: Esri World Imagery. Both free with attribution.
 */

const STREET = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
const SATELLITE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution:
    "Imagery &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
};

/** Tallinn old town — where an empty map starts when the company hasn't said where it's based. */
const DEFAULT_CENTER: LatLng = { lat: 59.437, lng: 24.7536 };

const STATUS_VAR: Record<PlantStatus, string> = {
  healthy: "var(--status-healthy)",
  attention: "var(--status-attention)",
  critical: "var(--status-critical)",
};

// HTML markers (not Leaflet's image pins, which break under bundlers), coloured with the
// theme's CSS variables so they follow light and dark mode.
function sitePin(color: string, active = false) {
  const size = active ? 34 : 28;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid var(--background);box-shadow:0 2px 6px rgb(0 0 0 / .35)"></div>`,
  });
}

function plantDot(status: PlantStatus) {
  return L.divIcon({
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${STATUS_VAR[status]};border:2px solid var(--background);box-shadow:0 1px 4px rgb(0 0 0 / .4)"></div>`,
  });
}

function BaseLayers() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Street">
        <TileLayer
          url={STREET.url}
          attribution={STREET.attribution}
          maxZoom={20}
          maxNativeZoom={19}
        />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite">
        <TileLayer
          url={SATELLITE.url}
          attribution={SATELLITE.attribution}
          maxZoom={20}
          maxNativeZoom={19}
        />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

/** Fit the view to a set of points once they're known (and whenever the set changes). */
function FitTo({ points, zoom }: { points: LatLng[]; zoom: number }) {
  const map = useMap();
  const key = points
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join("|");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0]!, zoom);
    else
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
        padding: [40, 40],
        maxZoom: zoom,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the points change
  }, [key]);
  return null;
}

function ClickTo({ onClick }: { onClick: ((at: LatLng) => void) | undefined }) {
  useMapEvents({
    click(e) {
      onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

type Frame = { className?: string | undefined; height?: number | undefined };

function Shell({
  className,
  height = 420,
  children,
  center,
}: Frame & { children: React.ReactNode; center: LatLng }) {
  return (
    // `isolate` keeps Leaflet's high z-indexes inside the map, under dialogs and menus.
    <div
      className={`isolate overflow-hidden rounded-xl border ${className ?? ""}`}
      style={{ height }}
    >
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        className="size-full"
      >
        <BaseLayers />
        {children}
      </MapContainer>
    </div>
  );
}

// ─── All sites ──────────────────────────────────────────────────────────────

export type SitesMapProps = Frame & {
  projects: Project[];
  /** drag sites to move them */
  editable?: boolean | undefined;
  onMove?: ((projectId: string, to: LatLng) => void) | undefined;
  /** when set, clicking the map picks a spot (e.g. for a new site) */
  onPick?: ((at: LatLng) => void) | undefined;
  /** where to start with no sites, e.g. where the company is based */
  fallbackCenter?: LatLng | null | undefined;
};

export function SitesMap({
  projects,
  editable,
  onMove,
  onPick,
  fallbackCenter,
  ...frame
}: SitesMapProps) {
  const points = useMemo(
    () => projects.map((p) => ({ lat: p.lat, lng: p.lng })),
    [projects],
  );
  return (
    <Shell {...frame} center={points[0] ?? fallbackCenter ?? DEFAULT_CENTER}>
      <FitTo points={points} zoom={15} />
      <ClickTo onClick={onPick} />
      {projects.map((p) => (
        <Marker
          key={`${p.id}-${p.lat}-${p.lng}`}
          position={[p.lat, p.lng]}
          icon={sitePin(STATUS_VAR[p.status], editable)}
          draggable={Boolean(editable)}
          eventHandlers={{
            dragend(e) {
              const at = (e.target as L.Marker).getLatLng();
              onMove?.(p.id, { lat: at.lat, lng: at.lng });
            },
          }}
        >
          <Popup>
            <p className="text-sm font-semibold">{p.name}</p>
            <p className="text-xs text-muted-foreground">{p.address}</p>
            <Link
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="mt-1 block text-xs font-medium text-primary"
            >
              Open site →
            </Link>
          </Popup>
        </Marker>
      ))}
    </Shell>
  );
}

// ─── One site with its plants ───────────────────────────────────────────────

export type SiteMapProps = Frame & { project: Project; plants: Plant[] };

export function SiteMap({ project, plants, ...frame }: SiteMapProps) {
  const site = { lat: project.lat, lng: project.lng };
  const placed = useMemo(
    () =>
      plants.flatMap((p) => {
        const at = plantPosition(p, site);
        return at ? [{ plant: p, at }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- site is derived from project
    [plants, project.lat, project.lng],
  );
  const points = placed.length ? placed.map((p) => p.at) : [site];
  return (
    <Shell {...frame} center={site}>
      <FitTo points={points} zoom={18} />
      <Marker position={[site.lat, site.lng]} icon={sitePin("var(--primary)")}>
        <Popup>
          <p className="text-sm font-semibold">{project.name}</p>
          <p className="text-xs text-muted-foreground">{project.address}</p>
        </Popup>
      </Marker>
      {placed.map(({ plant, at }) => (
        <Marker
          key={plant.id}
          position={[at.lat, at.lng]}
          icon={plantDot(plant.status)}
        >
          <Popup>
            <p className="font-mono text-[11px] text-muted-foreground">
              {plant.code}
            </p>
            <p className="text-sm font-semibold">{plant.common}</p>
            <p className="text-xs italic text-muted-foreground">
              {plant.species}
            </p>
            <p className="mt-1 text-xs">
              {statusLabel[plant.status]} · {plant.site}
            </p>
            {plant.nextTask ? (
              <p className="text-xs">
                Next: {plant.nextTask} · {plant.nextCare}
              </p>
            ) : null}
          </Popup>
        </Marker>
      ))}
    </Shell>
  );
}

// ─── Pick one location ──────────────────────────────────────────────────────

export type LocationPickerProps = Frame & {
  value: LatLng | null;
  onChange: (at: LatLng) => void;
  /** where to start before anything is picked, e.g. where the company is based */
  fallbackCenter?: LatLng | null | undefined;
};

/** Follow `value` when it's changed from outside (e.g. an address search). */
function FollowValue({ value }: { value: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) map.setView(value, Math.max(map.getZoom(), 16));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow coordinate changes only
  }, [value?.lat, value?.lng]);
  return null;
}

export function LocationPicker({
  value,
  onChange,
  fallbackCenter,
  ...frame
}: LocationPickerProps) {
  return (
    <Shell {...frame} center={value ?? fallbackCenter ?? DEFAULT_CENTER}>
      <FollowValue value={value} />
      <ClickTo onClick={onChange} />
      {value ? (
        <Marker
          position={[value.lat, value.lng]}
          icon={sitePin("var(--primary)", true)}
          draggable
          eventHandlers={{
            dragend(e) {
              const at = (e.target as L.Marker).getLatLng();
              onChange({ lat: at.lat, lng: at.lng });
            },
          }}
        />
      ) : null}
    </Shell>
  );
}
