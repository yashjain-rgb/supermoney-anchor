import type { User, DealerLead, DealerOnboardingStatus, DealerLimit } from '@/types';
import { db1 } from './firebase';
import { collection, getDocs, query, where, documentId, updateDoc, doc, getDoc } from 'firebase/firestore';
import type { Dealer, Invoice, Program } from '@/types';

// --- API FUNCTIONS ---

export async function getUsers(): Promise<User[]> {
  const usersCol = collection(db1, 'users');
  const userSnapshot = await getDocs(query(usersCol));
  return userSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as User));
}

export async function getInvoices(anchorId?: string, region?: string): Promise<Invoice[]> {
  let invoiceQuery;
  const invoicesCol = collection(db1, 'invoices');

  if (anchorId) {
    invoiceQuery = query(invoicesCol, where('anchorId', '==', anchorId));
  } else {
    // Admin case: fetch all invoices
    invoiceQuery = query(invoicesCol);
  }
  
  const [invoiceSnapshot, allDealersSnapshot, programSnapshot] = await Promise.all([
    getDocs(invoiceQuery),
    getDocs(collection(db1, 'dealers')),
    getDocs(collection(db1, 'programs')),
  ]);

  let dealers = allDealersSnapshot.docs.map(d => d.data() as Dealer);

  // Apply region filtering for dealers if a region is specified and it's not 'all'
  if (region && region !== 'all') {
      dealers = dealers.filter(dealer => dealer.region === region);
  }
  const visibleDealerIds = new Set(dealers.map(d => d.dealerId));

  const dealerMap = new Map(dealers.map(d => [d.dealerId, {name: d.dealerName, anchorId: d.anchorId}]));
  const programMap = new Map(programSnapshot.docs.map(p => [p.data().programId, p.data().lenderName]));
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to the beginning of today

  const invoices = invoiceSnapshot.docs
    .map(doc => {
      const data = doc.data() as Omit<Invoice, 'id' | 'dealerName'>;
      const dealerInfo = dealerMap.get(data.dealerId);
      
      const dueDate = new Date(data.dueDate);
      const isOverdue = data.status === 'Disbursed' && dueDate < today;
      const overdueAmount = isOverdue ? data.disbursementSentAmount : 0;
      
      return { 
          id: doc.id, 
          ...data,
          dealerName: dealerInfo?.name || 'Unknown Dealer',
          anchorId: dealerInfo?.anchorId || data.anchorId || '',
          lender: programMap.get(data.programId) || 'Unknown Lender',
          overdueAmount: overdueAmount,
          invoiceImage: data.invoiceImage || '',
          disbursementSentDate: data.disbursementSentDate || '',
          disburseDate: data.disburseDate || '',
      } as Invoice;
    })
    .filter(invoice => {
        // If anchorId is provided, filter invoices to only those whose dealers are in the visible list
        if (anchorId) {
            return visibleDealerIds.has(invoice.dealerId);
        }
        // Admins see all invoices
        return true;
    });

  // Sort invoices by date in descending order (newest first)
  invoices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return invoices;
}

export async function getDealers(anchorId?: string, region?: string): Promise<Dealer[]> {
    const dealersCol = collection(db1, 'dealers');
    let dealerQuery = query(dealersCol);

    if (anchorId) {
        dealerQuery = query(dealersCol, where('anchorId', '==', anchorId));
    }
    
    const [dealerSnapshot, limitsSnapshot, allInvoices, programSnapshot, usersSnapshot] = await Promise.all([
        getDocs(dealerQuery),
        getDocs(collection(db1, 'dealerLimits')),
        getInvoices(anchorId, region), // Pass region to get filtered invoices for accurate counts
        getDocs(collection(db1, 'programs')),
        getDocs(collection(db1, 'users')),
    ]);

    let dealersDocs = dealerSnapshot.docs;

    // Further filter by region if provided and not 'all'
    if (anchorId && region && region !== 'all') {
        dealersDocs = dealersDocs.filter(doc => doc.data().region === region);
    }
    
    if (dealersDocs.length === 0) {
        return [];
    }
    
    const limitsMap = new Map(limitsSnapshot.docs.map(doc => [doc.id, doc.data() as DealerLimit]));
    const programMap = new Map(programSnapshot.docs.map(p => [p.id, p.data().lenderName]));
    const userMap = new Map(usersSnapshot.docs.map(u => [u.id, u.data()]));

    const dealerList = dealersDocs.map(doc => {
        const dealerData = doc.data();
        const dealerId = dealerData.dealerId;
        const limitData = limitsMap.get(dealerId);
        
        const dealerInvoices = allInvoices.filter(i => i.dealerId === dealerId);
        
        // Match user by externalId which corresponds to dealerId
        const dealerUser = Array.from(userMap.values()).find(u => u.externalId === dealerId);

        const limitAmount = limitData?.limitAmount || 0;
        const utilisationAmount = limitData?.utilisationAmount || 0;
        
        return {
            id: dealerId,
            name: dealerData.dealerName,
            emailAddress: dealerData.emailAddress || dealerUser?.emailAddress || '',
            phoneNumber: dealerUser?.phoneNumber || '',
            anchorId: dealerData.anchorId,
            programId: dealerData.programId,
            applicationId: dealerData.applicationId,
            customerId: dealerData.customerId,
            invoicesSubmitted: dealerInvoices.length,
            amountDisbursed: utilisationAmount,
            overdueCount: dealerInvoices.filter(i => (i.overdueAmount ?? 0) > 0).length,
            overdueAmount: limitData?.principalOverdue || 0,
            principalDPD: limitData?.principalDPD || 0,
            lenderName: programMap.get(dealerData.programId) || 'N/A',
            status: dealerData.status, 
            totalLimit: limitAmount,
            availableLimit: limitAmount - utilisationAmount,
            GST: dealerData?.GST,
            region: dealerData?.region,
            branchName: dealerData?.branchName || '',
            branchEmailId: dealerData?.branchEmailId || '',
        } as Dealer;
    });

    return dealerList;
}


export async function getDealerLimits(dealerIds?: string[]): Promise<DealerLimit[]> {
    if (!dealerIds || dealerIds.length === 0) {
        return [];
    }

    const limitsCol = collection(db1, 'dealerLimits');
    const allLimits: DealerLimit[] = [];
    
    // Firestore 'in' query can handle up to 30 items.
    const CHUNK_SIZE = 30; 

    for (let i = 0; i < dealerIds.length; i += CHUNK_SIZE) {
        const chunk = dealerIds.slice(i, i + CHUNK_SIZE);
        if (chunk.length > 0) {
            const q = query(limitsCol, where(documentId(), 'in', chunk));
            const limitsSnapshot = await getDocs(q);
            const chunkLimits = limitsSnapshot.docs.map(doc => doc.data() as DealerLimit);
            allLimits.push(...chunkLimits);
        }
    }
    
    return allLimits;
}


export async function getPrograms(anchorId?: string, region?: string): Promise<{programs: Program[], invoices: Invoice[], totalOverdueAmount: number}> {
    const [programSnapshot, dealerSnapshot, limitsSnapshot, allInvoicesSnapshot] = await Promise.all([
        getDocs(collection(db1, 'programs')),
        getDocs(collection(db1, 'dealers')),
        getDocs(collection(db1, 'dealerLimits')),
        getInvoices(anchorId, region) // Pass region to get filtered invoices
    ]);

    const programMap = new Map(programSnapshot.docs.map(p => [p.id, { id: p.id, ...p.data() } as Program]));
    const limitsMap = new Map(limitsSnapshot.docs.map(l => [l.id, l.data() as DealerLimit]));
    
    let allDealers = dealerSnapshot.docs.map(d => d.data() as { dealerId: string, anchorId: string, programId: string, region?: string, status: Dealer['status'] });
    
    // Filter dealers based on anchor and region
    let relevantDealers = allDealers;
    if (anchorId) {
        relevantDealers = relevantDealers.filter(d => d.anchorId === anchorId);
        if (region && region !== 'all') {
            relevantDealers = relevantDealers.filter(d => d.region === region);
        }
    }
    
    const programAggregates: Record<string, Program> = {};

    // Initialize all programs from the program map to ensure they appear even if they have no activity
    programMap.forEach(baseProgram => {
        programAggregates[baseProgram.id] = {
            ...baseProgram,
            totalLimit: 0,
            usedLimit: 0,
            totalDealers: 0,
            invoicesCount: 0,
            disbursedAmount: 0,
            overdueCount: 0,
            pendingInvoicesCount: 0,
            disbursedInvoicesCount: 0,
            initiatedInvoicesCount: 0,
        };
    });

    // Aggregate limits and dealer counts from relevant dealers
    const dealerCountPerProgram: Record<string, Set<string>> = {};
    let totalOverdueAmount = 0;
    const processedDealersForOverdue = new Set<string>();

    relevantDealers.forEach(dealer => {
        const programId = dealer.programId;
        const limit = limitsMap.get(dealer.dealerId);

        // Aggregate limits and usage for all dealers to maintain accuracy of aggregate lifetime sanction limits
        if (programId && programAggregates[programId] && limit) {
            programAggregates[programId].totalLimit! += limit.limitAmount;
            programAggregates[programId].usedLimit! += limit.utilisationAmount;
        }

        if (programId) {
            if (!dealerCountPerProgram[programId]) {
                dealerCountPerProgram[programId] = new Set();
            }
            dealerCountPerProgram[programId].add(dealer.dealerId);
        }
        
        // Sum total overdue amount across all relevant dealers, ensuring each dealer is only counted once.
        if (!processedDealersForOverdue.has(dealer.dealerId)) {
            totalOverdueAmount += limit?.principalOverdue || 0;
            processedDealersForOverdue.add(dealer.dealerId);
        }
    });

    // Set the final dealer counts for each program
    Object.keys(programAggregates).forEach(programId => {
        programAggregates[programId].totalDealers = dealerCountPerProgram[programId]?.size || 0;
    });
    
    // Aggregate invoice data using the pre-filtered invoices
    allInvoicesSnapshot.forEach(invoice => {
        if (programAggregates[invoice.programId]) {
            const prog = programAggregates[invoice.programId];
            prog.invoicesCount!++; // Total invoices for the program
            if ((invoice.overdueAmount ?? 0) > 0) {
                prog.overdueCount!++;
            }
            if (invoice.status === 'Disbursed') {
                prog.disbursedAmount! += invoice.amount;
                prog.disbursedInvoicesCount!++;
            }
            if (['Initiated', 'Approved', 'Sent to Lender', 'Consent Approved'].includes(invoice.status)) {
                prog.pendingInvoicesCount!++;
            }
            if (invoice.status === 'Initiated') {
                prog.initiatedInvoicesCount!++;
            }
        }
    });

    const finalProgramList = Object.values(programAggregates)
        // Filter out programs that have no dealers associated with the current anchor
        .filter(p => p.totalDealers! > 0 || !anchorId);

    return { programs: finalProgramList, invoices: allInvoicesSnapshot, totalOverdueAmount };
}


export async function getUserByEmail(email: string): Promise<User | null> {
  const usersRef = collection(db1, 'users');
  const q = query(usersRef, where('emailAddress', '==', email));
  const querySnapshot = await getDocs(q);
  
  if (querySnapshot.empty) {
    return null;
  }
  
  const userDoc = querySnapshot.docs[0];
  const userData = userDoc.data();
  // Ensure the final object's 'id' is the Firestore document ID,
  // overwriting any 'id' field that might exist in the document data.
  return { ...userData, id: userDoc.id } as User;
}

export async function clearUserAuthToken(userId: string): Promise<void> {
    const userRef = doc(db1, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        await updateDoc(userRef, {
            authToken: '',
            expiryTime: 0,
        });
    } else {
        console.warn(`Attempted to clear auth token for non-existent user: ${userId}`);
    }
}


// --- STATIC DATA ---

export const spokeStatuses = [
    'New', 'Partial Docs', 'Follow Up', 'Already Onboarded', 'Disbursed', 
    'Not reachable', 'Active', 'Unassigned Lead', 'Rejected', 'Not Interested', 
    'Onboarding', 'Approved PF Collected', 'Awaiting Sanction', 'Closed', 
    'Limit Live', 'On Hold', 'Queries Raised', 'Relook'
] as const;

export const invoiceStatuses: ['Initiated', 'Approved', 'Sent to Lender', 'Disbursed', 'Rejected', 'Repaid', 'Consent Approved'] = ['Initiated', 'Approved', 'Sent to Lender', 'Disbursed', 'Rejected', 'Repaid', 'Consent Approved'];

// --- DEALER ONBOARDING STATIC DATA ---
export const dealerOnboardingStatuses: DealerOnboardingStatus[] = [
  'Lead Created',
  'Lead Verified',
  'Documents Collected',
  'Documents Verified',
  'Site Visit Done',
  'Business Limit Approved',
  'Dealer Activated'
];

export const dealerLeads: DealerLead[] = [
  {
    id: 'DL001',
    dealerName: 'Future Gadgets',
    contactPerson: 'Emmett Brown',
    contactEmail: 'emmett@futuregadgets.com',
    contactPhone: '9876543210',
    businessType: 'Electronics Retailer',
    location: 'Hill Valley, CA',
    region: 'West',
    status: 'Lead Created',
    createdBy: 'Sales Person',
    createdAt: '2024-07-20',
    requestedLimit: 500000,
    comments: [
        { user: 'Sales Person', comment: 'Initial contact made. Seems interested.', timestamp: '2024-07-20 10:00 AM'}
    ]
  },
  {
    id: 'DL002',
    dealerName: 'Cyberdyne Systems',
    contactPerson: 'Miles Dyson',
    contactEmail: 'miles.dyson@cyberdyne.com',
    contactPhone: '9876543211',
    businessType: 'Tech Manufacturer',
    location: 'Sunnyvale, CA',
    region: 'West',
    status: 'Lead Verified',
    createdBy: 'Sales Person',
    createdAt: '2024-07-19',
     requestedLimit: 2500000,
  },
   {
    id: 'DL003',
    dealerName: 'Kwik-E-Mart',
    contactPerson: 'Apu Nahasapeemapetilon',
    contactEmail: 'apu@kwikemart.com',
    contactPhone: '9876543212',
    businessType: 'Convenience Store',
    location: 'Springfield',
    region: 'Central',
    status: 'Documents Collected',
    createdBy: 'Sales Person',
    createdAt: '2024-07-18',
    documents: [
        { name: 'GST Certificate', url: '#', status: 'Pending' },
        { name: 'PAN Card', url: '#', status: 'Pending' },
    ],
    requestedLimit: 200000,
  },
  {
    id: 'DL004',
    dealerName: 'Gekko & Co',
    contactPerson: 'Gordon Gekko',
    contactEmail: 'gordon@gekko.com',
    contactPhone: '9876543213',
    businessType: 'Financial Services',
    location: 'New York, NY',
    region: 'East',
    status: 'Documents Verified',
    createdBy: 'Sales Person',
    createdAt: '2024-07-17',
     documents: [
        { name: 'GST Certificate', url: '#', status: 'Verified' },
        { name: 'PAN Card', url: '#', status: 'Verified' },
        { name: 'Business Registration', url: '#', status: 'Verified' },
    ],
    requestedLimit: 10000000,
  },
   {
    id: 'DL005',
    dealerName: 'Stark Expo',
    contactPerson: 'Pepper Potts',
    contactEmail: 'pepper@stark.com',
    contactPhone: '9876543214',
    businessType: 'Event Management',
    location: 'New York, NY',
    region: 'East',
    status: 'Site Visit Done',
    createdBy: 'Sales Person',
    createdAt: '2024-07-16',
    siteVisitReport: {
        notes: 'Large scale operation. High potential for business. Premises are well-maintained.',
        images: ['/placeholder.svg', '/placeholder.svg']
    },
    requestedLimit: 5000000,
    creditCheckScore: 8,
  },
  {
    id: 'DL006',
    dealerName: 'InGen',
    contactPerson: 'John Hammond',
    contactEmail: 'hammond@ingen.com',
    contactPhone: '9876543215',
    businessType: 'Biotechnology',
    location: 'Isla Nublar',
    region: 'West',
    status: 'Business Limit Approved',
    createdBy: 'Sales Person',
    createdAt: '2024-07-15',
     requestedLimit: 20000000,
     approvedLimit: 15000000,
     businessLimit: 15000000,
     creditCheckScore: 7
  },
   {
    id: 'DL007',
    dealerName: 'Buy n Large',
    contactPerson: 'Shelby Forthright',
    contactEmail: 'ceo@bnl.com',
    contactPhone: '9876543216',
    businessType: 'Mega Corporation',
    location: 'Global',
    region: 'Global',
    status: 'Dealer Activated',
    createdBy: 'Sales Person',
    createdAt: '2024-07-14',
    dealerCode: 'BNL-ACTIVE-001',
    requestedLimit: 100000000,
    approvedLimit: 100000000,
    businessLimit: 100000000,
  }
];
