
"use server";

import { getLeadScope, leadCollection, leadsDb } from "@/lib/leads-data";
import { z } from "zod";

const leadFormSchema = z.object({
  name: z.string().min(1, "Name is required."),
  leadCategory: z.enum(["Dealer", "Vendor"], { required_error: "Lead Category is required."}),
  contactNumber: z.string().regex(/^\d{10}$/, "Contact number must be exactly 10 digits."),
  spoc: z.string().min(1, "SPOC is required."),
  // Required: the CRM stores these as non-nullable strings and rejects a null,
  // so a lead must never be created without them.
  email: z.string().email("Invalid email address."),
  city: z.string().min(1, "City is required."),
  // Optional fields
  state: z.string().optional(),
  zone: z.string().optional(),
  dealValue: z.string().optional(),
});


type LeadFormValues = z.infer<typeof leadFormSchema>;

type ActionResult = {
  message?: string;
  error?: string;
};

export async function addSingleLead(data: LeadFormValues): Promise<ActionResult> {
  const validatedFields = leadFormSchema.safeParse(data);

  if (!validatedFields.success) {
    console.error("Form validation failed:", validatedFields.error.flatten().fieldErrors);
    return { error: "Invalid data provided. Please check the form." };
  }

  // Firestore rules no longer guard the leads database, so the session is the only
  // authorization layer here — an Anchor may only create leads under its own id.
  const scope = await getLeadScope();
  if (!scope) {
    return { error: "You must be logged in to add a lead." };
  }

  const anchorId = scope.anchorId || '';
  const anchorName = scope.session.userName || 'Supermoney Admin';

  const { leadCategory, dealValue, contactNumber, state, zone, ...rest } = validatedFields.data;

  const leadData = {
    ...rest,
    // Optional strings still land as "" rather than being absent, because the
    // CRM's schemas are non-nullable and reject a null on its write path.
    state: state ?? '',
    zone: zone ?? '',
    anchorId: anchorId,
    anchorName: anchorName,
    dealValue: dealValue ? Number(dealValue) : 0,
    // `remarks` is deliberately not written here. The CRM stores it as a map of
    // { text, timestamp, userName }, and seeding `[]` used to leave a document
    // the CRM could not save. leads/[id]/actions.ts creates the map on the first
    // remark instead.
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "New",
    leadDate: new Date().toISOString(),
    initialLeadDate: new Date().toISOString(),
    assignedTo: null,
    contactNumbers: [{ value: contactNumber }], // New format
  };

  try {
    const collectionName = leadCollection(leadCategory);
    await leadsDb.collection(collectionName).add(leadData);

    return { message: `Lead "${leadData.name}" added successfully to ${collectionName}.` };
  } catch (error) {
    console.error("Error writing to Firestore:", error);
    // Never surface the raw error to the client (R11).
    return { error: "Failed to add lead. Please try again." };
  }
}
