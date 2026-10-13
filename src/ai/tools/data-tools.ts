
'use server';

import { ai } from '@/ai/genkit';
import { getDealers, getInvoices, getPrograms } from '@/lib/data';
import { getMomentumDealerLeads } from '@/lib/leads-data';
import { z } from 'zod';

const ToolInputSchema = z.object({
    anchorId: z.string().optional().describe("The anchor ID to filter the data for. If not provided, data for all anchors will be fetched."),
});

// --- FULL DATA TOOLS (for detailed, specific questions) ---

export const getFullProgramDataTool = ai.defineTool(
    {
        name: 'getFullProgramData',
        description: 'Get the full list of all financing programs to answer any questions about them.',
        inputSchema: ToolInputSchema,
        outputSchema: z.any() 
    },
    async ({ anchorId }) => {
        const { programs } = await getPrograms(anchorId);
        return programs;
    }
);

export const getFullInvoiceDataTool = ai.defineTool(
    {
        name: 'getFullInvoiceData',
        description: 'Get the full list of all invoices to answer any questions about them, including counts, amounts, dealers, or statuses.',
        inputSchema: ToolInputSchema,
        outputSchema: z.any()
    },
    async ({ anchorId }) => {
        return await getInvoices(anchorId);
    }
);

export const getFullDealerDataTool = ai.defineTool(
    {
        name: 'getFullDealerData',
        description: 'Get the full list of all dealers and their details to answer any questions about them, including counts, limits, or statuses.',
        inputSchema: ToolInputSchema,
        outputSchema: z.any()
    },
    async ({ anchorId }) => {
        return await getDealers(anchorId);
    }
);

export const getFullLeadDataTool = ai.defineTool(
    {
        name: 'getFullLeadData',
        description: 'Get the full list of all leads. Use this to answer any questions related to leads, such as counts, statuses, or details about specific leads.',
        inputSchema: z.object({
            leadAnchorId: z.string().optional().describe("The anchor ID to filter leads for. This is different from the main anchorId."),
        }),
        outputSchema: z.any()
    },
    async ({ leadAnchorId }) => {
        return await getMomentumDealerLeads(leadAnchorId);
    }
);
