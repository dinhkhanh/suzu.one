"use client";
// Contracts (FR-CRM-25), invoices and payments (FR-CRM-30..32). The signed scan goes straight to
// storage through a signed URL; the invoice form picks ready billing items and adds up what it will
// say — the server works the figures out again.
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Field } from "@/components/forms/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action";
import { FileLink, uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { CONTRACT_KINDS, PAYMENT_METHODS } from "../enums";
import { beginContractScanAction, completeContractScanAction, linkProjectContractAction, openContractScanAction, recordInvoiceAction, recordPaymentAction, removePaymentAction, saveContractAction, signContractAction, terminateContractAction, writeOffInvoiceAction } from "../money-actions";
import { CrmButton, CrmForm, type Named } from "./common";

type ContractValues = { id: string; number: string; title: string; kind: string; entityId: string | null; parentContractId: string | null; dealId: string | null; startDate: string | null; endDate: string | null; valueVnd?: number | null; paymentTermsDays: number | null; autoRenew: boolean; noticeDays: number | null; note: string | null };

export function ContractForm({ clientId, contract, entities, parents, deals, seesValue }: { clientId: string; contract?: ContractValues; entities: Named[]; parents: Named[]; deals: Named[]; seesValue: boolean }) {
  const t = useTranslations("crm.contract");
  const id = contract?.id ?? "new";
  return (
    <CrmForm action={saveContractAction} extra={{ clientId, contractId: contract?.id ?? "" }} submit={contract ? t("save") : t("create")} navigateTo={contract ? undefined : (data) => `/crm/contracts/${(data as { id: string }).id}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="number" label={t("fields.number")}>
          <Input id={`c-number-${id}`} name="number" required maxLength={80} defaultValue={contract?.number ?? ""} placeholder="15/2026/HĐDV-SZM" />
        </Field>
        <div className="sm:col-span-2">
          <Field name="title" label={t("fields.title")}>
            <Input id={`c-title-${id}`} name="title" required maxLength={200} defaultValue={contract?.title ?? ""} />
          </Field>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="kind" label={t("fields.kind")}>
          <Select id={`c-kind-${id}`} name="kind" defaultValue={contract?.kind ?? "service"}>
            {CONTRACT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="entityId" label={t("fields.entity")}>
          <Select id={`c-entity-${id}`} name="entityId" defaultValue={contract?.entityId ?? entities[0]?.id ?? ""}>
            <option value="">—</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="parentContractId" label={t("fields.parent")}>
          <Select id={`c-parent-${id}`} name="parentContractId" defaultValue={contract?.parentContractId ?? ""}>
            <option value="">—</option>
            {parents
              .filter((parent) => parent.id !== contract?.id)
              .map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field name="dealId" label={t("fields.deal")}>
          <Select id={`c-deal-${id}`} name="dealId" defaultValue={contract?.dealId ?? ""}>
            <option value="">—</option>
            {deals.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="startDate" label={t("fields.startDate")}>
          <DatePicker id={`c-start-${id}`} name="startDate" defaultValue={contract?.startDate ?? ""} />
        </Field>
        <Field name="endDate" label={t("fields.endDate")}>
          <DatePicker id={`c-end-${id}`} name="endDate" defaultValue={contract?.endDate ?? ""} />
        </Field>
        <Field name="paymentTermsDays" label={t("fields.paymentTerms")}>
          <Input id={`c-terms-${id}`} name="paymentTermsDays" type="number" min={0} max={365} defaultValue={contract?.paymentTermsDays ?? ""} />
        </Field>
        <Field name="noticeDays" label={t("fields.noticeDays")}>
          <Input id={`c-notice-${id}`} name="noticeDays" type="number" min={0} max={365} defaultValue={contract?.noticeDays ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {seesValue ? (
          <Field name="valueVnd" label={t("fields.value")}>
            <MoneyInput id={`c-value-${id}`} name="valueVnd" defaultValue={contract?.valueVnd ?? ""} />
          </Field>
        ) : null}
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" name="autoRenew" defaultChecked={contract?.autoRenew} /> {t("fields.autoRenew")}
        </label>
      </div>
      <Field name="note" label={t("fields.note")}>
        <NoteEditor id={`c-note-${id}`} name="note" rows={2} maxLength={2000} defaultValue={contract?.note ?? ""} />
      </Field>
    </CrmForm>
  );
}

type Stored = { fileId: string; fileName: string };

/** Signed: the day, and the scan uploaded first. */
export function SignContractForm({ contractId, today }: { contractId: string; today: string }) {
  const t = useTranslations("crm.contract");
  const tErrors = useTranslations("crm.errors");
  const [pending, startTransition] = useTransition();
  const [stored, setStored] = useState<Stored | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <CrmForm action={signContractAction} extra={{ contractId, fileId: stored?.fileId ?? "" }} submit={t("sign")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="signedOn" label={t("fields.signedOn")}>
          <DatePicker id={`sign-date-${contractId}`} name="signedOn" required max={today} defaultValue={today} />
        </Field>
        <Field name="fileId" label={t("fields.scan")}>
          <input
            id="fileId"
            type="file"
            required={!stored}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
            disabled={pending}
            className="text-sm"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              startTransition(async () => {
                const result = await uploadThroughSignedUrl(file, (meta) => beginContractScanAction({ contractId, ...meta }) as Promise<ActionResult<{ fileId: string; uploadUrl: string; contentType: string }>>, (fileId) => completeContractScanAction({ fileId }) as Promise<ActionResult<Stored>>);
                setError(result.ok ? null : result.errorKey);
                setStored(result.ok ? result.data : null);
              });
            }}
          />
          {stored ? <span className="text-xs text-muted-foreground">{t("uploaded", { name: stored.fileName })}</span> : null}
          {error ? (
            <span role="alert" className="text-xs text-destructive">
              {tErrors.has(error) ? tErrors(error) : tErrors("generic")}
            </span>
          ) : null}
        </Field>
      </div>
    </CrmForm>
  );
}

export function ContractScanLink({ contractId, fileName }: { contractId: string; fileName: string }) {
  return <FileLink fileId="" fileName={fileName} download={() => openContractScanAction({ contractId }) as Promise<ActionResult<{ url: string }>>} />;
}

export function TerminateContractForm({ contractId, today }: { contractId: string; today: string }) {
  const t = useTranslations("crm.contract");
  return (
    <CrmForm action={terminateContractAction} extra={{ contractId }} submit={t("terminate")} className="flex flex-wrap items-end gap-3">
      <Field name="terminatedOn" label={t("fields.terminatedOn")}>
        <DatePicker id={`term-date-${contractId}`} name="terminatedOn" required defaultValue={today} />
      </Field>
      <Field name="note" label={t("fields.terminationReason")}>
        <Input id={`term-note-${contractId}`} name="note" required maxLength={1000} />
      </Field>
    </CrmForm>
  );
}

export function LinkProjectForm({ clientId, contractId, projects }: { clientId: string; contractId: string; projects: Named[] }) {
  const t = useTranslations("crm.contract");
  return (
    <CrmForm action={linkProjectContractAction} extra={{ clientId, contractId }} submit={t("linkProject")} className="flex flex-wrap items-end gap-3">
      <Field name="projectId" label={t("fields.project")}>
        <Select id={`link-project-${contractId}`} name="projectId" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </Field>
    </CrmForm>
  );
}

export function UnlinkProjectButton({ clientId, projectId }: { clientId: string; projectId: string }) {
  const t = useTranslations("crm.contract");
  return <CrmButton action={linkProjectContractAction} input={{ clientId, projectId, contractId: "" }} label={t("unlinkProject")} variant="ghost" />;
}

export type ReadyItem = { id: string; projectName: string; jobNumber: string | null; description: string; amountVnd: number | null; reference: string | null };

/** An invoice over ready items of one client and entity: pick them, number and date it, choose the VAT. */
export function RecordInvoiceForm({ items, vatRates, defaultVat, today }: { items: ReadyItem[]; vatRates: number[]; defaultVat: number; today: string }) {
  const t = useTranslations("crm.invoice");
  const tCrm = useTranslations("crm");
  const tProjects = useTranslations("projects");
  const format = useFormatter();
  const [picked, setPicked] = useState<Set<string>>(new Set(items.length === 1 ? [items[0].id] : []));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [vat, setVat] = useState(defaultVat);
  const subtotal = useMemo(() => items.filter((item) => picked.has(item.id)).reduce((sum, item) => sum + (item.amountVnd ?? (Number((typed[item.id] ?? "").replace(/[.,\s]/g, "")) || 0)), 0), [items, picked, typed]);
  const money = (value: number) => format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
  const vatAmount = Math.round((subtotal * vat) / 10_000);
  return (
    <CrmForm action={recordInvoiceAction} extra={{ itemIds: [...picked] }} submit={t("record")} navigateTo={(data) => `/crm/invoices/${(data as { id: string }).id}`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="id">{tProjects("fields.jobNumber")}</TableHead>
            <TableHead kind="text">{tCrm("contract.fields.project")}</TableHead>
            <TableHead kind="text">{tCrm("quote.description")}</TableHead>
            <TableHead kind="id">{t("fields.reference")}</TableHead>
            <TableHead kind="money">{t("amount")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} data-state={picked.has(item.id) ? "selected" : undefined}>
              <TableCell kind="id">
                <span className="flex items-center gap-3">
                  <Checkbox
                    aria-label={item.description}
                    checked={picked.has(item.id)}
                    onCheckedChange={(checked) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                  />
                  {item.jobNumber ?? "—"}
                </span>
              </TableCell>
              <TableCell>{item.projectName}</TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">{item.description}</TableCell>
              <TableCell kind="id">{item.reference ?? "—"}</TableCell>
              <TableCell kind="money">
                {item.amountVnd !== null ? (
                  money(item.amountVnd)
                ) : (
                  <MoneyInput name={`amounts.${item.id}`} required={picked.has(item.id)} value={typed[item.id] ?? ""} onChange={(event) => setTyped((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={t("amount")} aria-label={t("amount")} className="ml-auto w-36" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="number" label={t("fields.number")}>
          <Input id="invoice-number" name="number" required maxLength={60} />
        </Field>
        <Field name="issuedOn" label={t("fields.issuedOn")}>
          <DatePicker id="invoice-date" name="issuedOn" required max={today} defaultValue={today} />
        </Field>
        <Field name="vatRateBp" label={t("fields.vat")}>
          <Select id="invoice-vat" name="vatRateBp" value={String(vat)} onChange={(event) => setVat(Number(event.target.value))}>
            {vatRates.map((rate) => (
              <option key={rate} value={rate}>
                {rate / 100}%
              </option>
            ))}
          </Select>
        </Field>
        <dl className="grid grid-cols-2 gap-x-2 self-end text-sm">
          <dt className="text-muted-foreground">{t("subtotal")}</dt>
          <dd className="text-right tabular-nums">{money(subtotal)}</dd>
          <dt className="text-muted-foreground">{t("vatAmount")}</dt>
          <dd className="text-right tabular-nums">{money(vatAmount)}</dd>
          <dt className="font-medium">{t("total")}</dt>
          <dd className="text-right font-medium tabular-nums">{money(subtotal + vatAmount)}</dd>
        </dl>
      </div>
      <Field name="note" label={t("fields.note")}>
        <Input id="invoice-note" name="note" maxLength={1000} />
      </Field>
    </CrmForm>
  );
}

export function PaymentForm({ invoiceId, outstanding, today }: { invoiceId: string; outstanding: number; today: string }) {
  const t = useTranslations("crm.invoice");
  return (
    <CrmForm action={recordPaymentAction} extra={{ invoiceId }} submit={t("recordPayment")}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="receivedOn" label={t("fields.receivedOn")}>
          <DatePicker id="pay-date" name="receivedOn" required max={today} defaultValue={today} />
        </Field>
        <Field name="amountVnd" label={t("fields.amount")}>
          <MoneyInput id="pay-amount" name="amountVnd" required defaultValue={outstanding} />
        </Field>
        <Field name="method" label={t("fields.method")}>
          <Select id="pay-method" name="method" defaultValue="transfer">
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`methods.${method}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="reference" label={t("fields.reference")}>
          <Input id="pay-reference" name="reference" maxLength={120} />
        </Field>
      </div>
    </CrmForm>
  );
}

export function RemovePaymentButton({ invoiceId, paymentId }: { invoiceId: string; paymentId: string }) {
  const t = useTranslations("crm.invoice");
  return <CrmButton action={removePaymentAction} input={{ invoiceId, paymentId }} label={t("removePayment")} variant="ghost" confirm={t("removePaymentConfirm")} />;
}

export function WriteOffForm({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("crm.invoice");
  return (
    <CrmForm action={writeOffInvoiceAction} extra={{ invoiceId }} submit={t("writeOff")} className="flex flex-wrap items-end gap-3">
      <Field name="reason" label={t("fields.writeOffReason")}>
        <Input id="write-off-reason" name="reason" required maxLength={1000} />
      </Field>
    </CrmForm>
  );
}
