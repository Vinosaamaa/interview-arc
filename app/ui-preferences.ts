export type MasterPaneSurface = "library" | "banks";

export const MASTER_PANE_PREFERENCE_KEY: Record<MasterPaneSurface, string> = {
  library: "interview-arc-master-pane-library-v1",
  banks: "interview-arc-master-pane-banks-v1",
};

export function readMasterPanePreference(storage: Pick<Storage, "getItem">, surface: MasterPaneSurface): boolean | null {
  try {
    const value = storage.getItem(MASTER_PANE_PREFERENCE_KEY[surface]);
    return value === "open" ? true : value === "closed" ? false : null;
  } catch {
    return null;
  }
}

export function writeMasterPanePreference(storage: Pick<Storage, "setItem">, surface: MasterPaneSurface, open: boolean) {
  try {
    storage.setItem(MASTER_PANE_PREFERENCE_KEY[surface], open ? "open" : "closed");
  } catch {
    // Storage can be denied by the browser. The in-memory preference still works.
  }
}
