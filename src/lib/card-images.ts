const BUCKET = "card-images";

/**
 * Turn a public storage URL back into the object path inside the bucket.
 * Returns null for anything that isn't a URL from our own bucket, so an
 * unexpected value can never make us try to delete something else.
 */
export function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split("?")[0];
  return path && path.length > 0 ? decodeURIComponent(path) : null;
}

/**
 * Delete images from storage, but only those no card references anymore.
 *
 * Image occlusion creates one card per masked area, all sharing a single
 * uploaded image, so an image may only be removed once its LAST remaining
 * card is gone. Call this AFTER the cards themselves have been deleted,
 * passing the image URLs those cards used.
 *
 * Failures here are deliberately swallowed: an orphaned file wastes a bit
 * of quota, but a storage hiccup should never make a card deletion — which
 * already succeeded — look like it failed to the user.
 */
export async function cleanupOrphanedCardImages(
  supabase: { from: (t: string) => any; storage: { from: (b: string) => { remove: (paths: string[]) => Promise<unknown> } } }
  imageUrls: (string | null | undefined)[],
): Promise<void> {
  const uniqueUrls = [...new Set(imageUrls.filter((u): u is string => !!u))];
  if (uniqueUrls.length === 0) return;

  try {
    // Which of these images are still referenced by a surviving card?
    const { data: stillUsed, error } = await supabase
      .from("cards")
      .select("image_url")
      .in("image_url", uniqueUrls);
    if (error) return;

    const inUse = new Set((stillUsed ?? []).map((r: { image_url: string | null }) => r.image_url));
    const paths = uniqueUrls
      .filter((url) => !inUse.has(url))
      .map(storagePathFromPublicUrl)
      .filter((p): p is string => !!p);

    if (paths.length === 0) return;
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // Non-fatal — see note above.
  }
}