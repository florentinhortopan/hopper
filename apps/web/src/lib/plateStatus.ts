import { isPlateReady, plateStatusLabel, type PlateStatusLabel } from "@attatta/shared";

export { isPlateReady, plateStatusLabel };
export type { PlateStatusLabel };

export function plateStatusTone(label: PlateStatusLabel): string {
  switch (label) {
    case "Uploaded":
    case "Generated":
      return "bg-emerald-100 text-emerald-800";
    case "Generating":
      return "bg-amber-100 text-amber-900";
    case "Failed":
      return "bg-red-100 text-red-800";
    default:
      return "bg-ink-100 text-ink-600";
  }
}
