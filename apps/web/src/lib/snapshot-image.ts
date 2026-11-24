export function snapshotImageSrc(ownerType: "trade" | "missed", ownerId: string, version: string) {
  return `/api/snapshots/${ownerType}/${encodeURIComponent(ownerId)}?v=${encodeURIComponent(version)}`;
}
