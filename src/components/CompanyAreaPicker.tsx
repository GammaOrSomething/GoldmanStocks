import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PlaceSearch } from "@/components/PlaceSearch";
import { dataKeys } from "@/hooks/use-data";
import { saveCompanyArea } from "@/lib/api/company";
import { placeName, type Place } from "@/lib/api/geocode";
import { VIEWER_KEY } from "@/lib/auth/viewer-query";

/**
 * Find a town and make it where the company is based: the dashboard's forecast and the maps
 * use it until the company has sites.
 */
export function CompanyAreaPicker({
  onSaved,
}: {
  onSaved?: (() => void) | undefined;
}) {
  const [value, setValue] = useState("");
  const queryClient = useQueryClient();
  const router = useRouter();
  const save = useMutation({
    mutationFn: (place: Place) =>
      saveCompanyArea({
        data: { city: placeName(place), lat: place.lat, lng: place.lng },
      }),
    onSuccess: async (_, place) => {
      // The viewer carries the area (for the maps); the forecast depends on it too.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: VIEWER_KEY }),
        queryClient.invalidateQueries({ queryKey: dataKeys.weekWeather }),
      ]);
      await router.invalidate();
      toast.success(`Showing the forecast for ${placeName(place)}`);
      onSaved?.();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <PlaceSearch
      label="Town the company is based in"
      value={value}
      onValueChange={setValue}
      onPick={(place) => save.mutate(place)}
      placeholder="Your town, e.g. Tallinn"
      disabled={save.isPending}
    />
  );
}
