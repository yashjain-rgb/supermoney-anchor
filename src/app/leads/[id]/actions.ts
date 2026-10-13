
'use server';

import { getLeadScope, getMutableLead, type LeadCategory } from "@/lib/leads-data";
import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

type ActionResult = {
  message?: string;
  error?: string;
};

type CommentActionResult = ActionResult & {
    updatedRemarks?: any[];
}

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

        const newRemark = {
            remark: comment,
            timestamp: new Date().toISOString(),
            user: scope.session.userName,
        };

        await leadRef.update({
            remarks: FieldValue.arrayUnion(newRemark),
            updatedAt: new Date().toISOString(),
        });

        // Fetch the updated remarks to return
        const updatedDoc = await leadRef.get();
        const updatedData = updatedDoc.data();

        revalidatePath(`/leads/${leadId}`);
        return { message: 'Comment added successfully.', updatedRemarks: updatedData?.remarks };

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

        const newRemark = {
            remark: `Status changed to "${status}"`,
            timestamp: new Date().toISOString(),
            user: scope.session.userName,
        };

        await leadRef.update({
            status: status,
            updatedAt: new Date().toISOString(),
            remarks: FieldValue.arrayUnion(newRemark),
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
