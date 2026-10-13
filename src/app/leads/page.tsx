
import { unstable_noStore as noStore } from 'next/cache';
import { getMomentumDealerLeads } from "@/lib/leads-data";
import LeadsClientPage from './client-page';

export default async function LeadsPage() {
  noStore();

  // Scoping is derived from the session inside getMomentumDealerLeads: Anchors see
  // only their own leads, other portal roles see the full pipeline.
  const momentumLeads = await getMomentumDealerLeads();
  
  return (
    <>
      <LeadsClientPage initialLeads={momentumLeads} />
    </>
  );
}

    