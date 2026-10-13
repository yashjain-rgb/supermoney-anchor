
"use server";

import { getLeadScope, leadsDb } from "@/lib/leads-data";
import * as xlsx from 'xlsx';

type ActionResult = {
  message?: string;
  error?: string;
};

// Helper function to map Excel columns to Firestore fields
const mapLeadData = (lead: any, sessionAnchorId: string, isAnchorUser: boolean) => {
  const leadCategory = (lead['Lead Category'] || '').toLowerCase();

  // If the user is an Anchor, always use their session leadExternalId.
  // Otherwise, use the anchorId from the Excel file, or an empty string if not present.
  const anchorId = isAnchorUser ? sessionAnchorId : (lead.anchorId || '');

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
    remarks: lead['Remarks'] ? [{ remark: lead['Remarks'], timestamp: new Date().toISOString() }] : [],
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
    let skippedCount = 0;

    leadsArray.forEach((row: any) => {
        const leadData = mapLeadData(row, sessionAnchorId, isAnchorUser);

        if (leadData.leadCategory.toLowerCase() === 'dealer') {
            dealerBatch.set(leadsDb.collection("dealers").doc(), leadData);
            dealerCount++;
        } else if (leadData.leadCategory.toLowerCase() === 'vendor') {
            vendorBatch.set(leadsDb.collection("vendors").doc(), leadData);
            vendorCount++;
        } else {
            skippedCount++;
        }
    });

    if (dealerCount > 0) {
        await dealerBatch.commit();
    }
    if (vendorCount > 0) {
        await vendorBatch.commit();
    }

    let message = `${dealerCount} Dealer lead(s) and ${vendorCount} Vendor lead(s) added successfully.`;
    if (skippedCount > 0) {
        message += ` ${skippedCount} rows were skipped due to an invalid 'Lead Category'.`;
    }

    return { message };
  } catch (error) {
    console.error("Error processing Excel file or writing to Firestore:", error);
    // Never surface the raw error to the client (R11).
    return { error: "Failed to process file. Please check the file and try again." };
  }
}
