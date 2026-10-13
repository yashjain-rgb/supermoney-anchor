
"use server";

import { getLeadScope, leadsDb } from "@/lib/leads-data";
import * as xlsx from 'xlsx';

type ActionResult = {
  message?: string;
  error?: string;
};

const REQUIRED_LEAD_COLUMNS = ['Email', 'SPOC', 'City'];

/**
 * Builds the remark in the shape the CRM stores: a map of id -> { text, timestamp,
 * userName }, where all three value fields are required. Returns null for a blank
 * cell so the caller can omit the field entirely — Firestore rejects `undefined`,
 * and the array this used to produce is what the CRM could not read.
 */
const buildRemarks = (rawRemarks: unknown, userName: string) => {
  const text = String(rawRemarks ?? '').trim();
  if (!text) {
    return null;
  }

  return {
    [`remark_${Date.now()}`]: { text, timestamp: new Date().toISOString(), userName },
  };
};

// Helper function to map Excel columns to Firestore fields
const mapLeadData = (lead: any, sessionAnchorId: string, isAnchorUser: boolean, userName: string) => {
  const leadCategory = (lead['Lead Category'] || '').toLowerCase();

  // If the user is an Anchor, always use their session leadExternalId.
  // Otherwise, use the anchorId from the Excel file, or an empty string if not present.
  const anchorId = isAnchorUser ? sessionAnchorId : (lead.anchorId || '');

  const remarks = buildRemarks(lead['Remarks'], userName);

  return {
    name: lead['Name'] || '',
    leadCategory: lead['Lead Category'] || 'Dealer',
    contactNumber: (lead['Contact Number'] || '').toString(),
    email: lead['Email'] || '',
    city: lead['City'] || '',
    state: lead['State'] || '',
    zone: lead['Zone'] || '',
    anchorName: lead['Anchor Name'] || '',
    product: lead['Product'] || '',
    leadSource: lead['Lead Source'] || '',
    leadType: lead['Lead Type'] || '',
    priority: lead['Priority'] || '',
    dealValue: lead['Deal Value (Lacs)'] ? Number(lead['Deal Value (Lacs)']) : 0,
    lender: lead['Lender'] || '',
    // Omitted rather than written empty: the CRM reads this as a map, so an
    // absent field is fine while an array is not.
    ...(remarks ? { remarks } : {}),
    spoc: lead['SPOC'] || '',

    // System-generated fields
    anchorId: anchorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    leadDate: new Date().toISOString(),
    status: "New",
    initialLeadDate: new Date().toISOString(),
  };
};


export async function addMomentumLeads(formData: FormData): Promise<ActionResult> {
  const file = formData.get('excel-file') as File;
  if (!file) {
    return { error: "No file uploaded." };
  }

  // Firestore rules no longer guard the leads database, so the session is the only
  // authorization layer here — an Anchor may only create leads under its own id.
  const scope = await getLeadScope();
  if (!scope) {
    return { error: "You must be logged in to upload leads." };
  }

  const isAnchorUser = scope.session.roleType === 'Anchor';
  const sessionAnchorId = scope.anchorId || '';
  const sessionUserName = scope.session.userName || 'System';

  try {
    const bytes = await file.arrayBuffer();
    const workbook = xlsx.read(bytes, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const leadsArray = xlsx.utils.sheet_to_json(sheet, { raw: false });

    if (!Array.isArray(leadsArray) || leadsArray.length === 0) {
      return { error: "The Excel file is empty or not in the correct format." };
    }

    const dealerBatch = leadsDb.batch();
    const vendorBatch = leadsDb.batch();
    let dealerCount = 0;
    let vendorCount = 0;
    let skippedCategoryCount = 0;
    let skippedMissingFieldsCount = 0;

    leadsArray.forEach((row: any) => {
        // The CRM rejects a null, so a row missing any of these cannot become a
        // lead the CRM is able to save.
        const hasBlankRequiredField = REQUIRED_LEAD_COLUMNS.some(
            (column) => !String(row[column] ?? '').trim()
        );
        if (hasBlankRequiredField) {
            skippedMissingFieldsCount++;
            return;
        }

        const leadData = mapLeadData(row, sessionAnchorId, isAnchorUser, sessionUserName);

        if (leadData.leadCategory.toLowerCase() === 'dealer') {
            dealerBatch.set(leadsDb.collection("dealers").doc(), leadData);
            dealerCount++;
        } else if (leadData.leadCategory.toLowerCase() === 'vendor') {
            vendorBatch.set(leadsDb.collection("vendors").doc(), leadData);
            vendorCount++;
        } else {
            skippedCategoryCount++;
        }
    });

    if (dealerCount > 0) {
        await dealerBatch.commit();
    }
    if (vendorCount > 0) {
        await vendorBatch.commit();
    }

    let message = `${dealerCount} Dealer lead(s) and ${vendorCount} Vendor lead(s) added successfully.`;
    if (skippedCategoryCount > 0) {
        message += ` ${skippedCategoryCount} rows were skipped due to an invalid 'Lead Category'.`;
    }
    if (skippedMissingFieldsCount > 0) {
        message += ` ${skippedMissingFieldsCount} rows were skipped because Email, SPOC or City was blank.`;
    }

    return { message };
  } catch (error) {
    console.error("Error processing Excel file or writing to Firestore:", error);
    // Never surface the raw error to the client (R11).
    return { error: "Failed to process file. Please check the file and try again." };
  }
}
