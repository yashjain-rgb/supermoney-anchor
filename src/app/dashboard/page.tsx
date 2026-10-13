import { unstable_noStore as noStore } from 'next/cache';
import DashboardClient from './client-page';
import { getPrograms, getDealers } from '@/lib/data';
import { getMomentumDealerLeads } from '@/lib/leads-data';
import { getSession } from '@/lib/session';
import { db1 } from '@/lib/firebase';
import { collection, getDocs, query, where, collectionGroup } from 'firebase/firestore';
import type { UpcomingPayment, UpcomingPaymentLoan, UpcomingPaymentItem } from '@/types';


async function getUpcomingPayments(anchorId?: string, region?: string): Promise<UpcomingPaymentItem[]> {
    noStore();
    
    // 1. Get the list of dealers this user is allowed to see.
    const allDealersForScope = await getDealers(anchorId, region);
    const dealerMap = new Map(allDealersForScope.map(d => [d.id, { name: d.name, lender: d.lenderName }]));
    
    const dealerIdsForQuery = Array.from(dealerMap.keys());
    
    // If a non-admin user has no dealers, they have no payments to see.
    if (anchorId && dealerIdsForQuery.length === 0) {
        return [];
    }

    const flattenedPayments: UpcomingPaymentItem[] = [];
    
    // 2. Query the 'loans' subcollection across all documents.
    const loansQuery = collectionGroup(db1, 'loans');
    const loansSnapshot = await getDocs(loansQuery);

    loansSnapshot.forEach(loanDoc => {
        const loanData = loanDoc.data() as UpcomingPaymentLoan;
        
        // The parent document's ID is the dealerId.
        const dealerId = loanDoc.ref.parent.parent?.id;

        // 3. Check if the current user has access to this dealer.
        // dealerMap will only contain dealers visible to the current user.
        if (dealerId && dealerMap.has(dealerId)) {
            const dealerInfo = dealerMap.get(dealerId)!;
            flattenedPayments.push({
                id: loanDoc.id, // The loan document ID
                dealerId: dealerId,
                dealerName: dealerInfo.name || 'Unknown Dealer',
                outstandingAmount: loanData.outstandingAmount,
                dueDate: loanData.dueDate,
                lender: dealerInfo.lender || 'N/A'
            });
        }
    });

    // Sort by due date
    flattenedPayments.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    return flattenedPayments;
}


export default async function Dashboard() {
  noStore();
  const session = await getSession();
  
  // ID for programs, dealers, invoices
  const isAdmin = session?.roleType === 'Admin' || session?.roleType === 'SuperMoney User';
  const anchorId = isAdmin ? undefined : session?.externalId;
  const region = isAdmin ? undefined : session?.region;
  
  // Separate ID specifically for leads, as per recent changes
  const leadAnchorId = isAdmin ? undefined : session?.leadExternalId;

  // Fetch all data
  const { programs, invoices, totalOverdueAmount } = await getPrograms(anchorId, region);
  const [dealers, momentumLeads, upcomingPaymentsData] = await Promise.all([
    getDealers(anchorId, region),
    (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID_2) ? getMomentumDealerLeads(leadAnchorId) : Promise.resolve([]),
    getUpcomingPayments(anchorId, region)
  ]);
  
  // Lifetime Sanction Limit includes all dealers regardless of status to reflect total platform exposure
  const lifetimeSanctionLimit = dealers.reduce((sum, dealer) => sum + dealer.totalLimit, 0);
  
  return (
    <DashboardClient 
      initialPrograms={programs} 
      initialInvoices={invoices}
      initialDealers={dealers}
      momentumLeads={momentumLeads}
      upcomingPaymentsData={upcomingPaymentsData}
      totalOverdueAmount={totalOverdueAmount}
      lifetimeSanctionLimit={lifetimeSanctionLimit}
    />
  );
}
