// The person page's sections above the directory tier. A server component: each section is loaded
// through the records service with the viewer's principal and simply is not there when the tier is
// not enough. Forms appear only for those who may write that tier; the actions re-check.
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import type { Principal } from "@/modules/platform/rbac/policy";
import { DOCUMENT_TIERS } from "../document-tiers";
import { DOCUMENT_CATEGORIES } from "../enums";
import { canManageRecords } from "../policy";
import { getSensitiveSummary, listContracts, listDependents, listDocuments, listEmergencyContacts } from "../records";
import { deleteContractAction, deleteDependentAction, deleteDocumentAction, deleteAttachmentAction, removeEmergencyContactAction } from "../records-actions";
import { getPersonTarget } from "../service";
import { AttachmentUpload, ContractForm, ContractTerms, DependentForm, DocumentUploadForm, EmergencyContactForm, EndDeductionForm, RecordFileLink, RowAction, SensitivePanel, TerminateContractForm } from "./records-forms";

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export async function RecordSections({ principal, personId }: { principal: Principal; personId: string }) {
  const target = await getPersonTarget(personId);
  if (!target) return null;
  const [contracts, contacts, documents, dependents, sensitive] = await Promise.all([
    listContracts(principal, personId),
    listEmergencyContacts(principal, personId),
    listDocuments(principal, personId),
    listDependents(principal, personId),
    getSensitiveSummary(principal, personId),
  ]);
  const manages = { personal: canManageRecords(principal, target, "personal"), restricted: canManageRecords(principal, target, "restricted"), compensation: canManageRecords(principal, target, "compensation") };
  const uploadable = DOCUMENT_CATEGORIES.filter((category) => manages[DOCUMENT_TIERS[category] as keyof typeof manages]);

  const t = await getTranslations("records");
  const format = await getFormatter();
  const today = todayInVietnam();
  const day = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : null);
  const month = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { year: "numeric", month: "2-digit" }) : null);

  return (
    <>
      {contracts ? (
        <Section title={t("sections.contracts")}>
          {contracts.length === 0 ? <p className="text-sm text-muted-foreground">{t("contracts.empty")}</p> : null}
          <ul className="flex flex-col gap-3">
            {contracts.map((contract) => {
              const lastDay = contract.terminatedOn ?? contract.endDate;
              const state = contract.startDate > today ? "upcoming" : lastDay && lastDay < today ? "ended" : "active";
              return (
                <li key={contract.id} className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t(`contracts.types.${contract.type}`)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{contract.number}</span>
                    <Badge variant={state === "active" ? "secondary" : "outline"}>{t(`contracts.state.${state}`)}</Badge>
                    {contract.terminatedOn ? <Badge variant="outline">{t("contracts.terminated", { date: day(contract.terminatedOn) ?? "" })}</Badge> : null}
                  </div>
                  <p className="text-muted-foreground">
                    {day(contract.startDate)} → {day(contract.endDate) ?? t("contracts.openEnded")}
                    {contract.signDate ? ` · ${t("contracts.signedOn", { date: day(contract.signDate) ?? "" })}` : ""}
                    {contract.jobCategory ? ` · ${t(`contracts.jobCategories.${contract.jobCategory}`)}` : ""}
                    {contract.note ? ` · ${contract.note}` : ""}
                  </p>
                  {contract.files ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {contract.hasSalaryTerms ? <ContractTerms contractId={contract.id} /> : null}
                      {contract.files.map((file) => (
                        <span key={file.id} className="inline-flex items-center gap-1">
                          <RecordFileLink fileId={file.id} fileName={file.fileName} />
                          {manages.compensation ? <RowAction action={deleteAttachmentAction} input={{ fileId: file.id }} label="×" confirm={t("confirmDelete")} /> : null}
                        </span>
                      ))}
                      {manages.compensation ? <AttachmentUpload ownerType="contract" ownerId={contract.id} label={t("contracts.attach")} /> : null}
                    </div>
                  ) : null}
                  {manages.personal ? (
                    <div className="flex flex-wrap items-center gap-3 border-t pt-2">
                      {contract.terminatedOn || state === "ended" ? null : <TerminateContractForm contractId={contract.id} today={today} />}
                      <RowAction action={deleteContractAction} input={{ contractId: contract.id }} label={t("delete")} confirm={t("confirmDelete")} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {manages.personal ? <ContractForm personId={personId} parents={contracts.filter((row) => row.type !== "appendix").map(({ id, number }) => ({ id, number }))} canWritePay={manages.compensation} today={today} /> : null}
        </Section>
      ) : null}

      {contacts ? (
        <Section title={t("sections.emergencyContacts")}>
          {contacts.length === 0 ? <p className="text-sm text-muted-foreground">{t("contacts.empty")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{contact.fullName}</span>
                <span className="text-muted-foreground">{[contact.relationship, contact.phone, contact.note].filter(Boolean).join(" · ")}</span>
                {manages.personal ? <RowAction action={removeEmergencyContactAction} input={{ contactId: contact.id }} label={t("delete")} confirm={t("confirmDelete")} /> : null}
              </li>
            ))}
          </ul>
          {manages.personal ? <EmergencyContactForm personId={personId} /> : null}
        </Section>
      ) : null}

      {documents.length > 0 || uploadable.length > 0 ? (
        <Section title={t("sections.documents")}>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("documents.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("documents.category")}</TableHead>
                  <TableHead>{t("documents.title")}</TableHead>
                  <TableHead>{t("documents.file")}</TableHead>
                  <TableHead>{t("documents.expiresOn")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell>{t(`documents.categories.${document.category}`)}</TableCell>
                    <TableCell>{document.title}</TableCell>
                    <TableCell>
                      <RecordFileLink fileId={document.fileId} fileName={document.fileName} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {day(document.expiresOn) ?? "—"}
                      {document.expiresOn && document.expiresOn < today ? (
                        <Badge variant="outline" className="ml-2">
                          {t("documents.expired")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{manages[document.tier as keyof typeof manages] ? <RowAction action={deleteDocumentAction} input={{ documentId: document.id }} label={t("delete")} confirm={t("confirmDelete")} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {uploadable.length > 0 ? <DocumentUploadForm personId={personId} categories={uploadable} /> : null}
        </Section>
      ) : null}

      {dependents ? (
        <Section title={t("sections.dependents")} note={t("tierNote.restricted")}>
          {dependents.length === 0 ? <p className="text-sm text-muted-foreground">{t("dependents.empty")}</p> : null}
          <ul className="flex flex-col gap-3">
            {dependents.map((dependent) => (
              <li key={dependent.id} className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{dependent.fullName}</span>
                  <Badge variant="outline">{t(`dependents.relationships.${dependent.relationship}`)}</Badge>
                  <span className="text-muted-foreground">
                    {[day(dependent.dateOfBirth), t("dependents.months", { from: month(dependent.deductionFrom) ?? "", to: month(dependent.deductionTo) ?? t("dependents.open") }), dependent.note].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {dependent.files.map((file) => (
                    <span key={file.id} className="inline-flex items-center gap-1">
                      <RecordFileLink fileId={file.id} fileName={file.fileName} />
                      {manages.restricted ? <RowAction action={deleteAttachmentAction} input={{ fileId: file.id }} label="×" confirm={t("confirmDelete")} /> : null}
                    </span>
                  ))}
                  {manages.restricted ? <AttachmentUpload ownerType="dependent" ownerId={dependent.id} label={t("dependents.attach")} /> : null}
                </div>
                {manages.restricted ? (
                  <div className="flex flex-wrap items-center gap-3 border-t pt-2">
                    <EndDeductionForm dependentId={dependent.id} current={dependent.deductionTo} />
                    <RowAction action={deleteDependentAction} input={{ dependentId: dependent.id }} label={t("delete")} confirm={t("confirmDelete")} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {manages.restricted ? <DependentForm personId={personId} thisMonth={today.slice(0, 7)} /> : null}
        </Section>
      ) : null}

      {sensitive ? (
        <Section title={t("sections.sensitive")} note={t("tierNote.restricted")}>
          <SensitivePanel personId={personId} summary={sensitive} canManage={manages.restricted} dependentNames={Object.fromEntries((dependents ?? []).map((row) => [row.id, row.fullName]))} />
        </Section>
      ) : null}
    </>
  );
}
