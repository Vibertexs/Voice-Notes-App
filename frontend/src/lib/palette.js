const PALETTE = ['blue', 'violet', 'rose', 'coral', 'amber', 'lime', 'mint', 'sky'];

/**
 * A lecture wears the colour of the class it belongs to.
 *
 * Unfiled lectures have no class to inherit from. Rather than turning them
 * all grey, they get a stable colour derived from their own id, so the
 * library still reads as a shelf of distinct covers — and so a lecture looks
 * the same on the shelf as it does on its own screen.
 */
export function colorForWorkspace(workspace, folders = [], currentFolder = null) {
  const owned = currentFolder?.color
    ?? folders.find((folder) => folder.id === workspace?.folder_id)?.color;
  if (owned) return owned;

  const id = String(workspace?.id ?? '');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export { PALETTE };
