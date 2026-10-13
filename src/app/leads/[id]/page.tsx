
'use server';

import { unstable_noStore as noStore } from 'next/cache';
import { getMomentumDealerLeadById } from '@/lib/leads-data';
import { notFound } from 'next/navigation';
import LeadDetailClientPage from './client-page';
import { getSession } from '@/lib/session';

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  noStore();
  const session = await getSession();
  const lead = await getMomentumDealerLeadById(params.id);

  if (!lead) {
    notFound();
  }

  // Security check: an anchor user should only see their own leads
  if (session?.roleType === 'Anchor' && lead.anchorId !== session.leadExternalId) {
      notFound();
  }

  return <LeadDetailClientPage initialLead={lead} user={session} />;
}
