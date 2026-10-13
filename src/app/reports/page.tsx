
import { unstable_noStore as noStore } from 'next/cache';
import PageHeader from "@/components/page-header";
import { getSession } from '@/lib/session';
import { getInvoices, getDealers, getPrograms, getUsers, getDealerLimits } from '@/lib/data';
import { getMomentumDealerLeads } from '@/lib/leads-data';
import ReportsClientPage from './client-page';

export default async function ReportsPage() {
  noStore();
  const session = await getSession();
  const anchorId = session?.roleType === 'Admin' ? undefined : session?.externalId;
  const leadAnchorId = session?.roleType === 'Admin' ? undefined : session?.leadExternalId;
  const region = session?.roleType === 'Admin' ? undefined : session?.region;
  const isAdmin = session?.roleType === 'Admin';
  
  // Fetch all necessary data.
  const [invoices, dealers, { programs }, users, leads] = await Promise.all([
    getInvoices(anchorId, region),
    getDealers(anchorId, region),
    getPrograms(anchorId, region),
    isAdmin ? getUsers() : Promise.resolve([]),
    (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID_2) ? getMomentumDealerLeads(leadAnchorId) : Promise.resolve([]),
  ]);

  const dealerIds = dealers.map(d => d.id);
  const dealerLimits = await getDealerLimits(dealerIds);
  
  const totalOverdueAmount = dealerLimits.reduce((acc, limit) => acc + limit.principalOverdue, 0);

  return (
    <>
      <PageHeader title="Reports & Analytics" />
      <div className="mt-4">
        <ReportsClientPage
            initialInvoices={invoices}
            initialDealers={dealers}
            initialPrograms={programs}
            initialLeads={leads}
            users={users}
            isAdmin={isAdmin}
            totalOverdueAmount={totalOverdueAmount}
        />
      </div>
    </>
  );
}
