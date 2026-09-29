
"use server"

import PageHeader from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUsers } from "@/lib/data";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import ViewUsersTable from "./view-users-table";
import TriggerMisButton from "@/components/trigger-mis-button";

export default async function ViewUsersPage() {
  const session = await getSession();

  if (session?.roleType !== 'Admin') {
    redirect('/dashboard');
  }

  const users = await getUsers();

  return (
    <>
      <PageHeader title="View All Users">
        <TriggerMisButton />
      </PageHeader>
      <Card className="mt-4">
        <CardHeader>
            <CardTitle>User Accounts</CardTitle>
            <CardDescription>A list of all users in the system.</CardDescription>
        </CardHeader>
        <CardContent>
          <ViewUsersTable users={users} />
        </CardContent>
      </Card>
    </>
  );
}
