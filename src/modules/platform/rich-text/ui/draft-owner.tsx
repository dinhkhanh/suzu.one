"use client";
// Whose drafts the note editors keep: the signed-in person, set once by the app's layout. Outside it
// (public pages, previews) there is nobody to keep them for, and the editors keep none.
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { sweepDrafts } from "./drafts";

const DraftOwner = createContext<string | null>(null);

export function DraftOwnerProvider({ personId, children }: { personId: string; children: ReactNode }) {
  useEffect(() => sweepDrafts(), []);
  return <DraftOwner.Provider value={personId}>{children}</DraftOwner.Provider>;
}

export const useDraftOwner = () => useContext(DraftOwner);
