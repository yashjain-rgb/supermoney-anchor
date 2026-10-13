'use client';

import * as React from 'react';
import PageHeader from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { notFound, useRouter } from 'next/navigation';
import { ArrowLeft, Check, Download, FileText, Send, Upload, FilePlus2, MessageSquare, SendHorizonal, Mail, Phone, X, ThumbsUp, ThumbsDown, Eye, ShieldCheck, Save, Edit } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { MomentumDealerLead, User } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from "@/components/ui/textarea";
import { DataTablePagination } from '@/components/ui/data-table-pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { spokeStatuses } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { addComment, updateLeadStatus } from './actions';
import StatusBadge from '@/components/status-badge';

type LeadDetailClientPageProps = {
    initialLead: MomentumDealerLead;
    user: User | null;
};

export default function LeadDetailClientPage({ initialLead, user }: LeadDetailClientPageProps) {
    const { toast } = useToast();
    const router = useRouter();

    const [lead, setLead] = React.useState<MomentumDealerLead>(initialLead);
    const [newComment, setNewComment] = React.useState("");
    const [isEditingStatus, setIsEditingStatus] = React.useState(false);
    const [selectedStatus, setSelectedStatus] = React.useState(lead.status);

    const [pageIndex, setPageIndex] = React.useState(0);
    const pageSize = 5;

    const sortedRemarks = React.useMemo(() => {
        const remarks = lead?.remarks;
        let remarksArray: any[] = [];
        
        if (Array.isArray(remarks)) {
          remarksArray = remarks;
        } else if (remarks && typeof remarks === 'object') {
          remarksArray = Object.values(remarks);
        }

        if (remarksArray.length === 0) return [];
        
        return [...remarksArray].sort((a, b) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return timeB - timeA;
        });
    }, [lead?.remarks]);

    const pageCount = sortedRemarks.length > 0 ? Math.ceil(sortedRemarks.length / pageSize) : 0;
    const paginatedRemarks = React.useMemo(() => {
        const start = pageIndex * pageSize;
        const end = start + pageSize;
        return sortedRemarks.slice(start, end);
    }, [sortedRemarks, pageIndex, pageSize]);

    if (!lead) {
        notFound();
    }
    
    const handleAddComment = async () => {
        if (newComment.trim() && user) {
            const result = await addComment(lead.id, lead.leadCategory, newComment);
            if(result.error) {
                toast({
                    variant: 'destructive',
                    title: 'Error adding comment',
                    description: result.error,
                });
            } else {
                toast({
                    title: 'Comment Added',
                    description: 'Your comment has been successfully added.',
                });
                setLead(prev => ({ ...prev, remarks: result.updatedRemarks || prev.remarks }));
                setNewComment("");
                router.refresh(); // To get latest data from server
            }
        }
    };

    const handleUpdateStatus = async () => {
        const result = await updateLeadStatus(lead.id, lead.leadCategory, selectedStatus);
        if(result.error) {
            toast({
                variant: 'destructive',
                title: 'Error updating status',
                description: result.error,
            });
        } else {
            toast({
                title: 'Status Updated',
                description: `Lead status has been updated to ${selectedStatus}.`,
            });
            setLead(prev => ({ ...prev, status: selectedStatus }));
            setIsEditingStatus(false);
            router.refresh();
        }
    };
    
    const formatCurrency = (amount?: number) => {
        if (typeof amount !== 'number') return "N/A";
        return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount * 100000);
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    };

    return (
        <>
            <PageHeader title={lead.name}>
                <Button variant="outline" asChild>
                    <Link href="/leads">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to All Leads
                    </Link>
                </Button>
            </PageHeader>
            <div className="grid md:grid-cols-3 gap-6 mt-6">
                <div className="md:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className='flex items-center gap-2'>
                                <MessageSquare className='h-5 w-5 text-primary' />
                                Remarks & History
                            </CardTitle>
                             <CardDescription>View and add remarks to this lead's progress.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className='border rounded-md'>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className='w-[180px]'>User</TableHead>
                                            <TableHead>Remark</TableHead>
                                            <TableHead className='text-right w-[200px]'>Timestamp</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedRemarks && paginatedRemarks.length > 0 ? (
                                            paginatedRemarks.map((remark, index) => (
                                                <TableRow key={index}>
                                                    <TableCell className='font-medium'>{remark.user || remark.userName || 'System'}</TableCell>
                                                    <TableCell className='text-muted-foreground'>{remark.remark || remark.text || remark.comment}</TableCell>
                                                    <TableCell className='text-right'>{formatDate(remark.timestamp)}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={3} className='text-center text-muted-foreground'>No remarks yet.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                                </div>
                                {pageCount > 1 && (
                                     <DataTablePagination
                                        pageIndex={pageIndex}
                                        pageCount={pageCount}
                                        setPageIndex={setPageIndex}
                                        hasNextPage={pageIndex < pageCount - 1}
                                        hasPreviousPage={pageIndex > 0}
                                    />
                                )}
                                <div className='space-y-2'>
                                    <Textarea 
                                        placeholder="Add your remark..." 
                                        value={newComment} 
                                        onChange={(e) => setNewComment(e.target.value)}
                                        rows={3}
                                    />
                                    <div className='flex justify-end'>
                                        <Button onClick={handleAddComment} disabled={!newComment.trim()}>
                                            <SendHorizonal className="mr-2 h-4 w-4"/>
                                            Add Remark
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <div className="md:col-span-1 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Lead Information</CardTitle>
                            <div>
                                <Badge variant={lead.leadCategory === 'Dealer' ? 'default' : 'secondary'}>{lead.leadCategory}</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                             <div className="flex justify-between items-center">
                                <span className="text-muted-foreground">Status</span>
                                {isEditingStatus ? (
                                    <div className='flex items-center gap-2'>
                                        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                                            <SelectTrigger className="h-8 w-[150px]">
                                                <SelectValue placeholder="Select status" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {spokeStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <Button size="icon" className='h-8 w-8' onClick={handleUpdateStatus}><Save className='h-4 w-4'/></Button>
                                        <Button size="icon" variant="ghost" className='h-8 w-8' onClick={() => setIsEditingStatus(false)}><X className='h-4 w-4'/></Button>
                                    </div>
                                ) : (
                                    <div className='flex items-center gap-2'>
                                        <StatusBadge status={lead.status} />
                                        <Button variant="ghost" size="icon" className='h-6 w-6' onClick={() => setIsEditingStatus(true)}>
                                            <Edit className="h-3 w-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">SPOC</span>
                                <span className="font-medium">{lead.spoc}</span>
                            </div>
                            <Separator />
                             <div className="flex justify-between items-center">
                                <span className="text-muted-foreground flex items-center gap-2"><Mail className="h-3 w-3"/> Email</span>
                                <span className="font-medium">{lead.email}</span>
                            </div>
                             <Separator />
                             <div className="flex justify-between items-center">
                                <span className="text-muted-foreground flex items-center gap-2"><Phone className="h-3 w-3"/> Phone</span>
                                <span className="font-medium">{lead.contactNumber}</span>
                            </div>
                             <Separator />
                             <div className="flex justify-between">
                                <span className="text-muted-foreground">Deal Value</span>
                                <span className="font-medium">{formatCurrency(lead.dealValue)}</span>
                            </div>
                             <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Location</span>
                                <span className="font-medium">{lead.city}, {lead.state}</span>
                            </div>
                             <Separator />
                             <div className="flex justify-between">
                                <span className="text-muted-foreground">Created At</span>
                                <span className="font-medium">{formatDate(lead.createdAt)}</span>
                            </div>
                             <Separator />
                             <div className="flex justify-between">
                                <span className="text-muted-foreground">Last Updated</span>
                                <span className="font-medium">{formatDate(lead.updatedAt)}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}
