/**
 * Server-only lead data access.
 *
 * Leads live in the `supermoney-sales-hub` project's "prod" database. Its Firestore
 * rules deny all client access (`allow read, write: if false`) to block direct
 * client reads of lead PII, so the portal reaches this data through the Admin SDK,
 * which bypasses rules entirely. Authorization is therefore enforced in this
 * module and in the calling Server Actions — there is no rules layer to fall back
 * on.
 *
 * Never import this from a client component: firebase-admin cannot run in the
 * browser. Components that need lead constants (e.g. `spokeStatuses`) should keep
 * importing from `@/lib/data`, which stays client-safe.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentReference, type Firestore, type Query } from 'firebase-admin/firestore';

import { getSession } from '@/lib/session';
import type { MomentumDealerLead, User } from '@/types';

/** Named database holding lead data; the project's "(default)" database was migrated away. */
const LEADS_DATABASE_ID = 'prod';

/** Own Admin app, so this never collides with other Admin apps in the same process. */
const LEADS_APP_NAME = 'leads-admin';

function getLeadsApp() {
    const existing = getApps().find((app) => app.name === LEADS_APP_NAME);
    if (existing) {
        return existing;
    }

    // No credential passed: the Admin SDK picks up the runtime's ambient
    // credentials, the same way src/app/sendDailyReports/route.ts already does.
    return initializeApp(
        { projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID_2 },
        LEADS_APP_NAME
    );
}

export const leadsDb: Firestore = getFirestore(getLeadsApp(), LEADS_DATABASE_ID);

export type LeadCategory = 'Dealer' | 'Vendor';

/** Dealer and Vendor leads are stored in their own collection. */
export function leadCollection(category: LeadCategory): 'dealers' | 'vendors' {
    return category.toLowerCase() === 'dealer' ? 'dealers' : 'vendors';
}

export type LeadScope = {
    session: User;
    /** Set for Anchor users only — the anchor they are confined to. */
    anchorId?: string;
};

/**
 * Resolves what the signed-in user may access. Anchors are confined to their own
 * `leadExternalId`; every other portal role sees the full pipeline. Returns null
 * when the caller is not signed in.
 *
 * Firestore rules no longer protect this data, so every entry point must call
 * this before touching a lead.
 */
export async function getLeadScope(): Promise<LeadScope | null> {
    const session = await getSession();
    if (!session?.id) {
        return null;
    }

    if (session.roleType === 'Anchor') {
        // An Anchor without a leadExternalId cannot be scoped, so deny rather
        // than fall through to an unscoped query.
        return session.leadExternalId ? { session, anchorId: session.leadExternalId } : null;
    }

    return { session };
}

// Helper to convert Firestore Timestamps to ISO strings recursively
const processDocumentDates = (data: any): any => {
    if (data === null || typeof data !== 'object') {
        return data;
    }

    // Check for Firestore Timestamp
    if (typeof data.toDate === 'function') {
        const date = (data as { toDate: () => Date }).toDate();
        return !isNaN(date.getTime()) ? date.toISOString() : null;
    }

    if (Array.isArray(data)) {
        return data.map(processDocumentDates);
    }

    const processedData: Record<string, any> = {};
    for (const key in data) {
        processedData[key] = processDocumentDates(data[key]);
    }
    return processedData;
};

export async function getMomentumDealerLeads(anchorId?: string): Promise<MomentumDealerLead[]> {
    const scope = await getLeadScope();
    if (!scope) {
        return [];
    }

    // An Anchor is always confined to their own id, whatever the caller passed.
    const effectiveAnchorId = scope.anchorId ?? anchorId;

    const fetchLeads = async (collectionName: 'dealers' | 'vendors', category: LeadCategory) => {
        try {
            let leadsQuery = leadsDb.collection(collectionName) as Query;
            if (effectiveAnchorId) {
                leadsQuery = leadsQuery.where('anchorId', '==', effectiveAnchorId);
            }
            const snapshot = await leadsQuery.get();
            if (snapshot.empty) {
                return [];
            }
            return snapshot.docs.map((doc) => {
                const processedData = processDocumentDates(doc.data());
                return { id: doc.id, ...processedData, leadCategory: category } as MomentumDealerLead;
            });
        } catch (error) {
            console.error(`Error fetching from ${collectionName}:`, error);
            // If a collection doesn't exist, it will throw. We can ignore it and return an empty array.
            return [];
        }
    };

    const [dealerLeads, vendorLeads] = await Promise.all([
        fetchLeads('dealers', 'Dealer'),
        fetchLeads('vendors', 'Vendor')
    ]);

    const allLeads = [...dealerLeads, ...vendorLeads];

    // Sort all leads by leadDate date in descending order (newest first)
    allLeads.sort((a, b) => new Date(b.leadDate).getTime() - new Date(a.leadDate).getTime());

    return allLeads;
}

export async function getMomentumDealerLeadById(id: string): Promise<MomentumDealerLead | null> {
    const scope = await getLeadScope();
    if (!scope) {
        return null;
    }

    const fetchLead = async (collectionName: 'dealers' | 'vendors', category: LeadCategory): Promise<MomentumDealerLead | null> => {
        try {
            const docSnap = await leadsDb.collection(collectionName).doc(id).get();
            if (!docSnap.exists) {
                return null;
            }

            const data = docSnap.data() ?? {};

            // Rules no longer guard this read, so ownership is checked here.
            if (scope.anchorId && data.anchorId !== scope.anchorId) {
                return null;
            }

            const processedData = processDocumentDates(data);
            return { id: docSnap.id, ...processedData, leadCategory: category } as MomentumDealerLead;
        } catch (error) {
            console.error(`Error fetching from ${collectionName} with id ${id}:`, error);
            return null;
        }
    };

    // Try fetching from 'dealers' first, then 'vendors'
    const dealerLead = await fetchLead('dealers', 'Dealer');
    if (dealerLead) {
        return dealerLead;
    }

    const vendorLead = await fetchLead('vendors', 'Vendor');
    return vendorLead;
}

/**
 * Loads a lead for mutation, returning null unless the caller may act on it.
 * Anchors may only touch leads carrying their own anchorId.
 */
export async function getMutableLead(
    leadId: string,
    leadCategory: LeadCategory,
    scope: LeadScope
): Promise<DocumentReference | null> {
    const collectionName = leadCollection(leadCategory);
    const ref = leadsDb.collection(collectionName).doc(leadId);

    const snapshot = await ref.get();
    if (!snapshot.exists) {
        return null;
    }

    if (scope.anchorId && snapshot.data()?.anchorId !== scope.anchorId) {
        return null;
    }

    return ref;
}
