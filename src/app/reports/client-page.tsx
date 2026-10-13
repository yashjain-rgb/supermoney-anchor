"use client";

import { useMemo, useState } from 'react';
import * as xlsx from 'xlsx';
import { subDays, startOfDay, format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Legend, Bar, PieChart, Pie, Cell, TooltipProps } from 'recharts';
import type { Invoice, Dealer, Program, User, MomentumDealerLead } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import StatusBadge from '@/components/status-badge';
import type { NameValue } from 'recharts/types/component/DefaultTooltipContent';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const formatCompactCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 2 }).format(amount);

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#ff4d4d'];

type ReportsClientPageProps = {
    initialInvoices: Invoice[];
    initialDealers: Dealer[];
    initialPrograms: Program[];
    initialLeads: MomentumDealerLead[];
    users: User[];
    isAdmin: boolean;
    totalOverdueAmount: number;
};

export default function ReportsClientPage({ initialInvoices, initialDealers, initialPrograms, initialLeads, users, isAdmin, totalOverdueAmount }: ReportsClientPageProps) {
    const [dateRange, setDateRange] = useState<string>('all');

    const formatDateDash = (dateString?: string) => {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;
            return format(date, 'dd-MM-yyyy');
        } catch (e) {
            return dateString;
        }
    };

    const getRemarksString = (lead: MomentumDealerLead) => {
        const remarks = lead.remarks;
        let remarksArray: any[] = [];
        
        if (Array.isArray(remarks)) {
          remarksArray = remarks;
        } else if (remarks && typeof remarks === 'object') {
          remarksArray = Object.values(remarks);
        }

        if (remarksArray.length === 0) return '';
        
        return remarksArray
            .sort((a, b) => {
                const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return timeB - timeA;
            })
            .map(r => `${r.user || r.userName || 'System'}: ${r.remark || r.text || r.comment || ''} (${formatDateDash(r.timestamp)})`)
            .join(" | ");
    };

    const filteredInvoices = useMemo(() => {
        if (dateRange === 'all') {
            return initialInvoices;
        }
        const days = parseInt(dateRange, 10);
        const startDate = startOfDay(subDays(new Date(), days));
        return initialInvoices.filter(inv => new Date(inv.date) >= startDate);
    }, [initialInvoices, dateRange]);

    const summaryStats = useMemo(() => {
        const totalInvoiceValue = filteredInvoices.reduce((sum, inv) => sum + inv.amount, 0);
        const activeDealers = initialDealers.filter(d => d.status === 'Active').length;
        const activePrograms = initialPrograms.length;
        
        return { totalInvoiceValue, activeDealers, activePrograms };
    }, [filteredInvoices, initialDealers, initialPrograms]);
    
    const invoiceStatusData = useMemo(() => {
        const statusCounts = filteredInvoices.reduce((acc, inv) => {
            acc[inv.status] = (acc[inv.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        return Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
    }, [filteredInvoices]);

    const programInvoiceData = useMemo(() => {
        const programAmounts = filteredInvoices.reduce((acc, inv) => {
            const programName = initialPrograms.find(p => p.id === inv.programId)?.lenderName || 'Unknown';
            acc[programName] = (acc[programName] || 0) + inv.amount;
            return acc;
        }, {} as Record<string, number>);

        return Object.entries(programAmounts).map(([name, value]) => ({ name, value }));
    }, [filteredInvoices, initialPrograms]);
    
    const programLimitData = useMemo(() => {
        return initialPrograms.map(p => {
            const name = p.lenderName || 'Unknown Program';
            return {
                name: name.substring(0, 15) + (name.length > 15 ? '...' : ''), // Truncate name for chart
                Utilized: p.usedLimit || 0,
                Available: (p.totalLimit || 0) - (p.usedLimit || 0),
            }
        });
    }, [initialPrograms]);

    const topOverdueDealers = useMemo(() => {
        // This is not time-sensitive, it's based on current overdue status
        return initialDealers
            .filter(d => d.overdueAmount > 0)
            .sort((a, b) => b.overdueAmount - a.overdueAmount)
            .slice(0, 5)
            .map(d => ({ name: d.name, Overdue: d.overdueAmount }));
    }, [initialDealers]);

    const dealersWithNoRecentUtilization = useMemo(() => {
        if (dateRange === 'all') {
             // For "All Time", show dealers who have never had an invoice
            const dealersWithAnyInvoice = new Set(initialInvoices.map(inv => inv.dealerId));
            return initialDealers
                .filter(d => !dealersWithAnyInvoice.has(d.id) && d.availableLimit > 0)
                .sort((a, b) => b.availableLimit - a.availableLimit)
                .slice(0, 5)
                .map(d => ({ name: d.name, "Available Limit": d.availableLimit }));
        }

        const days = parseInt(dateRange, 10);
        const startDate = startOfDay(subDays(new Date(), days));
        const dealersWithRecentInvoices = new Set(
            initialInvoices
                .filter(inv => new Date(inv.date) >= startDate)
                .map(inv => inv.dealerId)
        );

        return initialDealers
            .filter(d => !dealersWithRecentInvoices.has(d.id) && d.availableLimit > 0)
            .sort((a, b) => b.availableLimit - a.availableLimit)
            .slice(0, 5) // Show top 5
            .map(d => ({ name: d.name, "Available Limit": d.availableLimit }));
    }, [initialInvoices, initialDealers, dateRange]);

    const noUtilizationCardTitle = useMemo(() => {
        if (dateRange === 'all') return "Dealers with No Utilization (All Time)";
        return `Dealers with No Utilization (Last ${dateRange} Days)`;
    }, [dateRange]);

    const noUtilizationCardDescription = useMemo(() => {
        if (dateRange === 'all') return "Top 5 dealers who have never submitted an invoice.";
        return `Top 5 dealers with no invoices in the past ${dateRange} days, sorted by available limit.`;
    }, [dateRange]);
    
    const downloadExcel = (data: any[], sheetName: string, fileName: string) => {
        const worksheet = xlsx.utils.json_to_sheet(data);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
        xlsx.writeFile(workbook, fileName);
    };

    const downloadFullReport = () => {
        const workbook = xlsx.utils.book_new();

        // Sheet 1: Summary
        const summaryData = [
            { Metric: "Total Invoice Value", Value: formatCurrency(summaryStats.totalInvoiceValue) },
            { Metric: "Total Overdue", Value: formatCurrency(totalOverdueAmount) },
            { Metric: "Active Dealers", Value: summaryStats.activeDealers },
            { Metric: "Active Programs", Value: summaryStats.activePrograms },
        ];
        const summarySheet = xlsx.utils.json_to_sheet(summaryData);
        xlsx.utils.book_append_sheet(workbook, summarySheet, "Summary");

        // Sheet 2: Filtered Invoices
        const invoiceData = filteredInvoices.map(inv => ({
            "Invoice #": inv.invoiceNumber,
            "Dealer Name": inv.dealerName,
            "Anchor Name": inv.anchorName,
            "Lender": inv.lender,
            "Date": inv.date,
            "Due Date": inv.dueDate,
            "Amount": inv.amount,
            "Overdue Amount": inv.overdueAmount,
            "Status": inv.status,
        }));
        const invoiceSheet = xlsx.utils.json_to_sheet(invoiceData);
        xlsx.utils.book_append_sheet(workbook, invoiceSheet, "Filtered Invoices");

        // Sheet 3: All Dealers
        const dealerData = initialDealers.map(d => ({
            "Dealer ID": d.id,
            "Dealer Name": d.name,
            "Lender Name": d.lenderName || 'N/A',
            "Status": d.status,
            "Total Limit": d.totalLimit,
            "Amount Disbursed": d.amountDisbursed,
            "Available Limit": d.availableLimit,
            "Overdue Amount": d.overdueAmount,
        }));
        const dealerSheet = xlsx.utils.json_to_sheet(dealerData);
        xlsx.utils.book_append_sheet(workbook, dealerSheet, "All Dealers");
        
        // Sheet 4: All Programs
        const programData = initialPrograms.map(p => ({
            "Program Name": p.lenderName,
            "Lender Type": p.lenderType,
            "Total Limit": p.totalLimit,
            "Used Limit": p.usedLimit,
            "Total Dealers": p.totalDealers,
        }));
        const programSheet = xlsx.utils.json_to_sheet(programData);
        xlsx.utils.book_append_sheet(workbook, programSheet, "All Programs");

        // Sheet 5: All Leads
        const leadData = initialLeads.map(l => ({
            "leadCategory": l.leadCategory,
            "createdAt": formatDateDash(l.createdAt),
            "leadDate": formatDateDash(l.leadDate),
            "name": l.name,
            "customerName": l.name,
            "dealValue": l.dealValue,
            "status": l.status,
            "statusUpdatedAt": formatDateDash(l.updatedAt),
            "remarks": getRemarksString(l),
        }));
        const leadSheet = xlsx.utils.json_to_sheet(leadData);
        xlsx.utils.book_append_sheet(workbook, leadSheet, "All Leads");

        xlsx.writeFile(workbook, "full_report.xlsx");
    };

    const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
        if (active && payload && payload.length) {
            return (
            <div className="p-2 text-xs bg-background/90 backdrop-blur-sm border rounded-md shadow-lg">
                <p className="font-bold mb-1">{label}</p>
                {payload.map((entry: NameValue<number,string>, index: number) => {
                    const isCurrency = entry.name?.toLowerCase().includes("limit") || 
                                       entry.name?.toLowerCase().includes("overdue") || 
                                       entry.name?.toLowerCase().includes("value") ||
                                       entry.name?.toLowerCase().includes("utilized") ||
                                       entry.name?.toLowerCase().includes("available");
                    return (
                        <p key={`item-${index}`} style={{ color: entry.color }}>
                            {`${entry.name}: ${isCurrency ? formatCurrency(entry.value ?? 0) : entry.value}`}
                        </p>
                    )
                })}
            </div>
            );
        }
        return null;
    };
    
    return (
        <div className="space-y-6">
             <div className="flex justify-between items-center">
                 <Button onClick={downloadFullReport}>
                    <Download className="mr-2 h-4 w-4" />
                    Download Full Report
                </Button>
                <Select value={dateRange} onValueChange={setDateRange}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select date range" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="7">Last 7 Days</SelectItem>
                        <SelectItem value="14">Last 14 Days</SelectItem>
                        <SelectItem value="21">Last 21 Days</SelectItem>
                        <SelectItem value="28">Last 28 Days</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader><CardTitle className='text-sm font-medium'>Total Invoice Value</CardTitle></CardHeader>
                    <CardContent><p className='text-2xl font-bold'>{formatCurrency(summaryStats.totalInvoiceValue)}</p></CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle className='text-sm font-medium'>Total Overdue</CardTitle></CardHeader>
                    <CardContent><p className='text-2xl font-bold text-destructive'>{formatCurrency(totalOverdueAmount)}</p></CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle className='text-sm font-medium'>Active Dealers</CardTitle></CardHeader>
                    <CardContent><p className='text-2xl font-bold'>{summaryStats.activeDealers}</p></CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle className='text-sm font-medium'>Active Programs</CardTitle></CardHeader>
                    <CardContent><p className='text-2xl font-bold'>{summaryStats.activePrograms}</p></CardContent>
                </Card>
            </div>
            
            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Invoice Status Distribution</CardTitle>
                        <CardDescription>A breakdown of invoices by status for the selected period.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[20rem]">
                         <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={invoiceStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} labelLine={false} label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                                    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                    const x = cx + radius * Math.cos(-midAngle * (Math.PI / 180));
                                    const y = cy + radius * Math.sin(-midAngle * (Math.PI / 180));
                                    return (
                                        <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-xs font-medium">
                                        {`${(percent * 100).toFixed(0)}%`}
                                        </text>
                                    );
                                }}>
                                    {invoiceStatusData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} />
                                <Legend iconSize={10} iconType="circle" />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Top 5 Overdue Dealers</CardTitle>
                         <CardDescription>Dealers with the highest outstanding overdue amounts (all time).</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[20rem]">
                        <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={topOverdueDealers} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <XAxis type="number" tickFormatter={(val) => formatCompactCurrency(val as number)} axisLine={false} tickLine={false} />
                                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} axisLine={false} tickLine={false}/>
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                                <Legend />
                                <Bar dataKey="Overdue" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
             <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Invoice Value by Program</CardTitle>
                        <CardDescription>Total value of invoices processed under each program for the selected period.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[20rem]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={programInvoiceData}>
                                <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={(val) => formatCompactCurrency(val as number)} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                                <Legend />
                                <Bar dataKey="value" name="Invoice Value" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} barSize={30} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader>
                        <CardTitle>Limit Utilization by Program</CardTitle>
                        <CardDescription>Comparison of utilized vs. available credit limits (all time).</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[20rem]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={programLimitData} layout="vertical">
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                                <Legend />
                                <Bar dataKey="Utilized" stackId="a" fill="hsl(var(--chart-2))" radius={[4, 0, 0, 4]} barSize={20} />
                                <Bar dataKey="Available" stackId="a" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

             <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>{noUtilizationCardTitle}</CardTitle>
                        <CardDescription>{noUtilizationCardDescription}</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[20rem]">
                        {dealersWithNoRecentUtilization.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dealersWithNoRecentUtilization}>
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <YAxis tickFormatter={(val) => formatCompactCurrency(val as number)} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                                    <Legend />
                                    <Bar dataKey="Available Limit" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} barSize={30} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                                All dealers have had recent activity.
                            </div>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <div className="flex flex-wrap justify-between items-center gap-2">
                            <div>
                                <CardTitle>Data Export</CardTitle>
                                <CardDescription>Download raw data for further analysis.</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => downloadExcel(initialInvoices, 'Invoices', 'invoice_report.xlsx')}>
                                <Download className="mr-2 h-4 w-4" /> Download Invoices
                            </Button>
                             <Button variant="outline" onClick={() => downloadExcel(initialDealers, 'Dealers', 'dealer_report.xlsx')}>
                                <Download className="mr-2 h-4 w-4" /> Download Dealers
                            </Button>
                             <Button variant="outline" onClick={() => downloadExcel(initialPrograms, 'Programs', 'program_report.xlsx')}>
                                <Download className="mr-2 h-4 w-4" /> Download Programs
                            </Button>
                            <Button variant="outline" onClick={() => {
                                const data = initialLeads.map(l => ({
                                    "leadCategory": l.leadCategory,
                                    "createdAt": formatDateDash(l.createdAt),
                                    "leadDate": formatDateDash(l.leadDate),
                                    "name": l.name,
                                    "customerName": l.name,
                                    "dealValue": l.dealValue,
                                    "status": l.status,
                                    "statusUpdatedAt": formatDateDash(l.updatedAt),
                                    "remarks": getRemarksString(l),
                                }));
                                downloadExcel(data, 'Leads', 'leads_report.xlsx');
                            }}>
                                <Download className="mr-2 h-4 w-4" /> Download Leads
                            </Button>
                        </div>
                        <div className="relative w-full overflow-auto border rounded-md max-h-60 mt-4">
                            <Table>
                                <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
                                    <TableRow>
                                        <TableHead>Invoice #</TableHead>
                                        <TableHead>Dealer</TableHead>
                                        <TableHead>Amount</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                 <TableBody>
                                    {filteredInvoices.slice(0, 20).map(invoice => (
                                        <TableRow key={invoice.id}>
                                            <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                                            <TableCell>{invoice.dealerName}</TableCell>
                                            <TableCell>{formatCurrency(invoice.amount)}</TableCell>
                                            <TableCell><StatusBadge status={invoice.status}/></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                         <p className="text-xs text-muted-foreground text-center mt-2">Showing first 20 invoices from selection. Use download for full report.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
