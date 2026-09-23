import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Camera, Check, Crosshair, Loader2, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useRefreshData } from "@/hooks/use-data";
import { savePlant, type PlantInput } from "@/lib/api/plants";
import { getPref } from "@/lib/phone-prefs";
import { setCaptureHandler } from "@/lib/photo-store";
import { createPlantPhotoUpload } from "@/lib/plants.functions";
import { supabase } from "@/lib/supabase/client";
import { useActiveWorker, useWorkerProjects } from "@/lib/worker-store";

export const Route = createFileRoute("/mobile/new-plant")({
  component: NewPlant,
});

const kinds: PlantInput["kind"][] = [
  "Tree",
  "Hedge",
  "Lawn",
  "Flower bed",
  "Shrub",
];
const PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

/**
 * Register a plant where it stands: photo, what it is, which site and area, and the phone's GPS
 * pin. Saved to the database with its picture; it shows on the site map straight away.
 */
function NewPlant() {
  const navigate = useNavigate();
  const refresh = useRefreshData();
  const fileRef = useRef<HTMLInputElement>(null);
  const worker = useActiveWorker();
  const projects = useWorkerProjects(worker?.id);

  const [preview, setPreview] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<PlantInput["kind"]>("Shrub");
  const [common, setCommon] = useState("");
  const [species, setSpecies] = useState("");
  const [pickedProject, setProjectId] = useState("");
  const projectId = pickedProject || projects[0]?.id || "";
  const [zone, setZone] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);

  const project = projects.find((p) => p.id === projectId);

  // The big camera button in the tab bar opens the plant photo while on this screen.
  useEffect(() => {
    setCaptureHandler(() => fileRef.current?.click());
    return () => setCaptureHandler(null);
  }, []);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function locate() {
    if (!navigator.geolocation) {
      toast.error("This phone can't share its location");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error(
          "Location not shared — the plant will be placed at the site's centre",
        );
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // Upload straight away, so saving is quick and the photo never goes through the app server.
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const contentType = (file.type ||
      "image/jpeg") as (typeof PHOTO_TYPES)[number];
    if (!PHOTO_TYPES.includes(contentType)) {
      toast.error("Use a JPEG, PNG, WebP or HEIC photo");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setPhotoPath(null);
    setUploading(true);
    try {
      const upload = await createPlantPhotoUpload({ data: { contentType } });
      const { error } = await supabase.storage
        .from(upload.bucket)
        .uploadToSignedUrl(upload.path, upload.token, file);
      if (error) throw error;
      setPhotoPath(upload.path);
    } catch {
      toast.error("Couldn't upload the photo — try taking it again");
    } finally {
      setUploading(false);
    }
    if (!coords && getPref("geotag")) locate();
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!photoPath) throw new Error("Take a photo of the plant first");
      if (!common.trim()) throw new Error("Give the plant a name");
      if (!projectId) throw new Error("Pick the site it's on");
      const { code } = await savePlant({
        data: {
          projectId,
          common: common.trim(),
          species: species.trim(),
          kind,
          site: zone,
          status: "healthy",
          nextTask: "",
          nextCareDate: "",
          ...(coords ?? {}),
          photoPath,
        },
      });
      return code;
    },
    onSuccess: async (code) => {
      await refresh();
      toast.success(
        `${common.trim()} registered as ${code} on ${project?.name ?? "the site"}`,
      );
      void navigate({ to: "/mobile/plants" });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPhoto}
      />

      <div>
        <h1 className="font-display text-xl">Register new plant</h1>
        <p className="text-sm text-muted-foreground">
          Photo it where it stands — the spot is saved with it.
        </p>
      </div>

      {preview ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <img
            src={preview}
            alt="New plant"
            className="h-48 w-full object-cover"
          />
          <div className="flex items-center gap-2 p-3 text-sm">
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin text-muted-foreground" />{" "}
                Uploading…
              </>
            ) : photoPath ? (
              <>
                <Check className="size-4 text-status-healthy" /> Photo saved
              </>
            ) : (
              <span className="text-status-critical">Upload failed</span>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="ml-auto rounded-lg border px-3 py-2 text-xs"
            >
              Retake
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl bg-primary py-10 text-primary-foreground"
        >
          <Camera className="size-8" />
          <span className="text-sm font-semibold">Take photo of the plant</span>
        </button>
      )}

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What is it?
        </p>
        <input
          value={common}
          onChange={(e) => setCommon(e.target.value)}
          placeholder="Name, e.g. Lilac by the gate"
          className="w-full rounded-xl border bg-card p-3 text-sm"
        />
        <input
          value={species}
          onChange={(e) => setSpecies(e.target.value)}
          placeholder="Species if you know it, e.g. Syringa vulgaris"
          className="w-full rounded-xl border bg-card p-3 text-sm italic"
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                k === kind
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Site
        </p>
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setZone("");
          }}
          className="w-full rounded-xl border bg-card p-3 text-sm"
        >
          {projects.length === 0 ? (
            <option value="">No sites assigned to you</option>
          ) : null}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.city}
            </option>
          ))}
        </select>
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="w-full rounded-xl border bg-card p-3 text-sm"
        >
          <option value="">Area (optional)</option>
          {(project?.zones ?? []).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Location
        </p>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <MapPin className="size-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm">
            {coords
              ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
              : "Not pinned — it'll go to the site's centre"}
          </p>
          <button
            type="button"
            onClick={locate}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs"
          >
            {locating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Crosshair className="size-3.5" />
            )}
            {coords ? "Update" : "Use my spot"}
          </button>
        </div>
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => navigate({ to: "/mobile" })}
          className="rounded-xl border px-4 py-3.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || uploading}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {save.isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Check className="size-5" />
          )}
          Save plant
        </button>
      </div>
    </div>
  );
}
