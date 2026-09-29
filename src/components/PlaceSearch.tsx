import { useMutation } from "@tanstack/react-query";
import { Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchAddress, type Place } from "@/lib/api/geocode";

/**
 * A text field that looks itself up: type an address or a town, press Enter or Find, pick a
 * match. Searches only on request, never as you type: Nominatim's usage policy forbids
 * autocomplete, and every search spends the company's `geocode` allowance.
 */
export function PlaceSearch({
  id,
  label,
  value,
  onValueChange,
  query = value,
  onPick,
  placeholder,
  required,
  disabled,
}: {
  id?: string | undefined;
  /** the field's accessible name, when no <label> points at it */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** what to look up; defaults to the typed value (a site adds its city) */
  query?: string | undefined;
  onPick: (place: Place) => void;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const search = useMutation({
    mutationFn: (q: string) => searchAddress({ data: q }),
    onError: (error) => toast.error(error.message),
  });
  const q = query.trim();
  // Matches belong to the text they were found for: once it changes (the address or, for a
  // site, the city), they're hidden, and searching the same text again spends nothing.
  const results = search.variables === q ? search.data : undefined;
  const canSearch = q.length >= 3 && !search.isPending && !disabled;
  const find = () => {
    if (canSearch && !results) search.mutate(q);
  };

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input
          id={id}
          aria-label={label}
          value={value}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault(); // search, don't submit the surrounding form
            find();
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!canSearch}
          onClick={find}
        >
          {search.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Find
        </Button>
      </div>
      {results ? (
        <div className="rounded-lg border">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No matches. Try adding the town or country.
            </p>
          ) : (
            results.map((place) => (
              <button
                key={`${place.lat},${place.lng}`}
                type="button"
                onClick={() => {
                  onPick(place);
                  search.reset();
                }}
                className="flex w-full items-start gap-2 border-b p-2.5 text-left text-sm last:border-b-0 hover:bg-muted"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="line-clamp-2">{place.label}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
