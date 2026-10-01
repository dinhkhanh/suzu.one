// The person page's sections above the directory tier. A server component: each section is loaded
// through the records service with the viewer's principal and simply is not there when the tier is
// not enough. Forms appear only for those who may write that tier; the actions re-check.
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import type { Principal } from "@/modules/platform/rbac/policy";
import { DOCUMENT_TIERS } from "../document-tiers";
import { DOCUMENT_CATEGORIES } from "../enums";
import { canManageRecords } from "../policy";
import { getSensitiveSummary, listContracts, listDependents, listDocuments, listEmergencyContacts } from "../records";
import { deleteContractAction, deleteDependentAction, deleteDocumentAction, deleteAttachmentAction, removeEmergencyContactAction } from "../records-actions";
import { getPersonTarget } from "../service";
import { AttachmentUpload, ContractForm, ContractTerms, DependentForm, DocumentUploadForm, EmergencyContactForm, EndDeductionForm, RecordFileLink, RowAction, SensitivePanel, TerminateContractForm } from "./records-forms";

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
        <TableCard>
          <TableCardHeader title={t("sections.contracts")} count={contracts.length || null} />
          <List>
            {contracts.length === 0 ? <ListEmpty>{t("contracts.empty")}</ListEmpty> : null}
            {contracts.map((contract) => {
              const lastDay = contract.terminatedOn ?? contract.endDate;
              const state = contract.startDate > today ? "upcoming" : lastDay && lastDay < today ? "ended" : "active";
              return (
                <ListItem key={contract.id} className="flex-col items-stretch gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t(`contracts.types.${contract.type}`)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{contract.number}</span>
                    <Badge dot variant={statusTone(state)}>{t(`contracts.state.${state}`)}</Badge>
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
                </ListItem>
              );
            })}
          </List>
          {manages.personal ? <ContractForm personId={personId} parents={contracts.filter((row) => row.type !== "appendix").map(({ id, number }) => ({ id, number }))} canWritePay={manages.compensation} today={today} /> : null}
        </TableCard>
      ) : null}

      {contacts ? (
        <TableCard>
          <TableCardHeader title={t("sections.emergencyContacts")} count={contacts.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("contacts.fullName")}</TableHead>
                <TableHead kind="select">{t("contacts.relationship")}</TableHead>
                <TableHead kind="phone">{t("contacts.phone")}</TableHead>
                <TableHead kind="text">{t("contacts.note")}</TableHead>
                {manages.personal ? <TableHead kind="actions" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.length === 0 ? <TableEmpty>{t("contacts.empty")}</TableEmpty> : null}
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">{contact.fullName}</TableCell>
                  <TableCell>{contact.relationship || "—"}</TableCell>
                  <TableCell kind="phone">{contact.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{contact.note || "—"}</TableCell>
                  {manages.personal ? (
                    <TableCell kind="actions">
                      <RowAction action={removeEmergencyContactAction} input={{ contactId: contact.id }} label={t("delete")} confirm={t("confirmDelete")} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {manages.personal ? <EmergencyContactForm personId={personId} /> : null}
        </TableCard>
      ) : null}

      {documents.length > 0 || uploadable.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("sections.documents")} count={documents.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("documents.category")}</TableHead>
                <TableHead kind="text">{t("documents.title")}</TableHead>
                <TableHead kind="file">{t("documents.file")}</TableHead>
                <TableHead kind="date">{t("documents.expiresOn")}</TableHead>
                <TableHead kind="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length === 0 ? <TableEmpty>{t("documents.empty")}</TableEmpty> : null}
              {documents.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    <Badge variant="outline">{t(`documents.categories.${document.category}`)}</Badge>
                  </TableCell>
                  <TableCell>{document.title}</TableCell>
                  <TableCell kind="file">
                    <RecordFileLink fileId={document.fileId} fileName={document.fileName} />
                  </TableCell>
                  <TableCell>
                    {day(document.expiresOn) ?? "—"}
                    {document.expiresOn && document.expiresOn < today ? (
                      <Badge variant="outline" className="ml-2">
                        {t("documents.expired")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell kind="actions">{manages[document.tier as keyof typeof manages] ? <RowAction action={deleteDocumentAction} input={{ documentId: document.id }} label={t("delete")} confirm={t("confirmDelete")} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {uploadable.length > 0 ? <DocumentUploadForm personId={personId} categories={uploadable} /> : null}
        </TableCard>
      ) : null}

      {dependents ? (
        <TableCard>
          <TableCardHeader title={t("sections.dependents")} count={dependents.length || null} description={t("tierNote.restricted")} />
          <List>
            {dependents.length === 0 ? <ListEmpty>{t("dependents.empty")}</ListEmpty> : null}
            {dependents.map((dependent) => (
              <ListItem key={dependent.id} className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{dependent.fullName}</span>
                  <Badge variant="outline">{t(`dependents.relationships.${dependent.relationship}`)}</Badge>
                  <span className="text-muted-foreground">
                    {[day(dependent.dateOfBirth), t("dependents.months", { from: month(dependent.deductionFrom) ?? "", to: month(dependent.deductionTo) ?? t("dependents.open") }), dependent.note].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 empty:hidden">
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
              </ListItem>
            ))}
          </List>
          {manages.restricted ? <DependentForm personId={personId} thisMonth={today.slice(0, 7)} /> : null}
        </TableCard>
      ) : null}

      {sensitive ? (
        <Section title={t("sections.sensitive")} description={t("tierNote.restricted")}>
          <SensitivePanel personId={personId} summary={sensitive} canManage={manages.restricted} dependentNames={Object.fromEntries((dependents ?? []).map((row) => [row.id, row.fullName]))} />
        </Section>
      ) : null}
    </>
  );
}
