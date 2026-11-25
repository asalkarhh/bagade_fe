export interface LabelPrintProfile {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  paddingMm: number;
  barcodeHeightMm: number;
  barcodeFormat: 'Code 128';
}

export const LABEL_PRINT_PROFILES: readonly LabelPrintProfile[] = [
  {
    id: '50x30',
    label: '50 × 30 mm (Standard clothing tag)',
    widthMm: 50,
    heightMm: 30,
    paddingMm: 2,
    barcodeHeightMm: 10,
    barcodeFormat: 'Code 128',
  },
  {
    id: '50x25',
    label: '50 × 25 mm (Compact tag)',
    widthMm: 50,
    heightMm: 25,
    paddingMm: 1.75,
    barcodeHeightMm: 8,
    barcodeFormat: 'Code 128',
  },
  {
    id: '38x25',
    label: '38 × 25 mm (Small garment tag)',
    widthMm: 38,
    heightMm: 25,
    paddingMm: 1.5,
    barcodeHeightMm: 7.5,
    barcodeFormat: 'Code 128',
  },
];

export function getDefaultLabelProfileId(): string {
  const configured = import.meta.env.VITE_LABEL_PROFILE?.trim();
  if (configured && LABEL_PRINT_PROFILES.some((p) => p.id === configured)) {
    return configured;
  }
  return '50x30';
}

export function findLabelProfile(profileId: string): LabelPrintProfile {
  return (
    LABEL_PRINT_PROFILES.find((p) => p.id === profileId) ?? LABEL_PRINT_PROFILES[0]!
  );
}
