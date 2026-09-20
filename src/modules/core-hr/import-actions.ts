"use server";
import { employeeImport } from "./import";

export async function stageEmployeeImportAction(input: unknown) {
  return employeeImport.stage(input);
}

export async function commitEmployeeImportAction(input: unknown) {
  return employeeImport.commit(input);
}
