"use server";
import { historyImport } from "./history-import";
import { employeeImport } from "./import";

export async function stageEmployeeImportAction(input: unknown) {
  return employeeImport.stage(input);
}

export async function commitEmployeeImportAction(input: unknown) {
  return employeeImport.commit(input);
}

export async function stageHistoryImportAction(input: unknown) {
  return historyImport.stage(input);
}

export async function commitHistoryImportAction(input: unknown) {
  return historyImport.commit(input);
}
