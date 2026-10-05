// The CRM as other modules and the routes see it (SRS §4.15). Other modules reach it only through
// this file; HR and PJM never import it — where their screens show CRM items, the routes ask here,
// or the CRM registers with a platform registry.
export * from "./enums";
export { accountChoices, accountFacts, accountsById, accountWorkOf, accountSignals, type AccountFilters, type AccountListItem, type AccountProfileRow, type AccountRef, type AccountSignals, findAccount, listAccountProfiles, listAccounts, listAccountTeam, type TeamMemberView } from "./accounts";
export { type AccountAbilities, accountAbilities, type AccountPage, accountsManagedBy, getAccountPage, visibleAccountProjectIds } from "./account-view";
export { activityLink, type ActivityView, countOpenFollowUps, listActivities, listAllFollowUpsOf, listDoneBy, listFollowUpsOf, listOpenFollowUps } from "./activities";
export { contactChoicesFor, type ContactName, type ContactView, findContact, listContacts } from "./contacts";
export { contractChoices, contractNumbersOfProjects, type ContractView, expiringContracts, findContract, listContracts } from "./contracts";
export { type DealFilters, type DealView, dealContext, gateFacts, getDeal, listDealBoard, listDealContacts, listDealPage, listDeals, listStageChanges, openDealsOf, ownsAnyDeal, pipelineTotals } from "./deals";
export { dealOfProject, type DealProjectView, listDealProjects, listSalesHandoffsFor, type SalesHandoffWaiting } from "./delivery";
export { agingSummary, collectedByAccount, getInvoice, heldBillingItemIds, type InvoiceDetail, type InvoiceView, listInvoices } from "./invoices";
export { crmMorningJob, crmNightlyJob } from "./jobs";
export { getLead, leadFacts, type LeadView, listLeads, listOpenLeadsOf } from "./leads";
export * from "./policy";
export { dealValue, isStale as isStaleDeal, weightedValue } from "./engine/deal";
export { dealValueReach, forecast, revenueOutlook, salesDashboard, type SalesTile, salesTile } from "./pipeline";
export { getQuote, listQuotes, quoteOfRequest, type QuotePayload, quoteReaderView, quoteRequestType } from "./quotes";
export { getRateCard, priceOn, rateCardView, type ServiceView } from "./rate-card";
export { crmSettings, firstStageOf, listStages, stageName, type StageRow, vatRates } from "./stages";
export { accountTimeline, TIMELINE_KINDS, type TimelineItem } from "./timeline";
export { type CrmContext, loadCrm } from "./viewer";
export { managesAnAccount } from "./pages";
export { salesFactsOf, type SalesFacts } from "./sales-facts";
export { canDecideCommissionScheme, canProposeCommissionScheme, canRunCommission, commissionMonths, type CommissionSchemeRow, computeCommission, confirmStatement, listCommissionSchemes, listCommissionStatements, postConfirmedCommissions, type StatementView } from "./commission";
