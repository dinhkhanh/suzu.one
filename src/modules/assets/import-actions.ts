"use server";
import { assetImport } from "./import";

export async function stageAssetImportAction(input: unknown) {
  return assetImport.stage(input);
}

export async function commitAssetImportAction(input: unknown) {
  return assetImport.commit(input);
}
