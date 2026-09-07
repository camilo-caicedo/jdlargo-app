import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function SelectOrganizationLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="mb-6 flex flex-col items-center">
        <Skeleton className="h-6 w-28 rounded-md mb-2" />
        <Skeleton className="h-4 w-48 rounded-md" />
      </div>
      <div className="w-full max-w-[440px]">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-col items-center pb-4">
            <Skeleton className="h-6 w-48 rounded-md mb-2" />
            <Skeleton className="h-4 w-64 rounded-md" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}