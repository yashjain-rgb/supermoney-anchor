
'use server';

import { getLeadScope, getMutableLead, type LeadCategory } from "@/lib/leads-data";
import { revalidatePath } from "next/cache";

type ActionResult = {
  message?: string;
  error?: string;
};

/** A remark in the shape the CRM stores; its schema requires all three fields. */
type LeadRemark = {
    text: string;
    timestamp: string;
    userName: string;
};

/** Remarks written by an older version of this portal used `remark` and `user`. */
type StoredRemark = Partial<LeadRemark> & { remark?: string; user?: string };

type CommentActionResult = ActionResult & {
    updatedRemarks?: Record<string, LeadRemark>;
}

const normalizeRemark = (raw: unknown): LeadRemark => {
    const value = (raw ?? {}) as StoredRemark;
    return {
        text: value.text ?? value.remark ?? '',
        timestamp: value.timestamp ?? '',
        userName: value.userName ?? value.user ?? 'System',
    };
};

/**
 * Returns the lead's `remarks` rebuilt as the map the CRM expects, with `remark` added.
 *
 * The CRM stores remarks as a map (`Record<string, Remark>`) and rejects the array
 * this portal used to write, so appending can no longer use FieldValue.arrayUnion —
 * that recreates an array even on a lead with no remarks field at all. A document
 * still holding the old array is converted rather than dropped.
 */
const buildRemarksWith = (existing: unknown, remark: LeadRemark): Record<string, LeadRemark> => {
    const entries: Array<[string, unknown]> = Array.isArray(existing)
        ? existing.map((entry, index) => [`remark_${index}`, entry])
        : Object.entries((existing ?? {}) as Record<string, unknown>);

    const remarks: Record<string, LeadRemark> = Object.fromEntries(
        entries.map(([key, entry]): [string, LeadRemark] => [key, normalizeRemark(entry)])
    );
    remarks[`remark_${Date.now()}`] = remark;

    return remarks;
};

export async function addComment(leadId: string, leadCategory: LeadCategory, comment: string): Promise<CommentActionResult> {
    const scope = await getLeadScope();
    if (!scope) {
        return { error: 'You must be logged in to add a comment.' };
    }

    try {
        // Confirms the lead exists *and* that this user may act on it.
        const leadRef = await getMutableLead(leadId, leadCategory, scope);
        if (!leadRef) {
            // Deliberately the same message whether the lead is missing or belongs
            // to another anchor, so this cannot be used to probe for lead ids.
            return { error: 'Lead not found.' };
        }

        const snapshot = await leadRef.get();
        const remarks = buildRemarksWith(snapshot.data()?.remarks, {
            text: comment,
            timestamp: new Date().toISOString(),
            userName: scope.session.userName || 'System',
        });

        await leadRef.update({
            remarks,
            updatedAt: new Date().toISOString(),
        });

        revalidatePath(`/leads/${leadId}`);
        return { message: 'Comment added successfully.', updatedRemarks: remarks };

    } catch (e) {
        console.error('Error adding comment:', e);
        // Never surface the raw error to the client (R11).
        return { error: 'Failed to add comment. Please try again.' };
    }
}

export async function updateLeadStatus(leadId: string, leadCategory: LeadCategory, status: string): Promise<ActionResult> {
    const scope = await getLeadScope();
    if (!scope) {
        return { error: 'You must be logged in to update status.' };
    }

    try {
        // Confirms the lead exists *and* that this user may act on it.
        const leadRef = await getMutableLead(leadId, leadCategory, scope);
        if (!leadRef) {
            return { error: 'Lead not found.' };
        }

        const snapshot = await leadRef.get();
        const remarks = buildRemarksWith(snapshot.data()?.remarks, {
            text: `Status changed to "${status}"`,
            timestamp: new Date().toISOString(),
            userName: scope.session.userName || 'System',
        });

        await leadRef.update({
            status: status,
            updatedAt: new Date().toISOString(),
            remarks,
        });

        revalidatePath(`/leads/${leadId}`);
        revalidatePath('/leads');
        return { message: 'Status updated successfully.' };

    } catch (e) {
        console.error('Error updating status:', e);
        // Never surface the raw error to the client (R11).
        return { error: 'Failed to update status. Please try again.' };
    }
}
